import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  DatabaseConnectionService,
  DatabaseMonitoringService,
  STORAGE_SNAPSHOT_LIMIT,
  recordDbEvent,
  type DbDigestStat,
  type DbLockWait,
  type DbSession,
  type DbTable,
  type DbTransaction,
} from '@packages/database/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { gaugeWindow } from '@modules/performance/index.js';
import { DatabaseMetricsService } from './database-metrics.service.js';
import { DatabaseStoreService, type StorageSnapshot } from './database-store.service.js';
import {
  diffAlerts,
  evaluateDbRules,
  type DbRuleInput,
  type DbViolation,
} from './database-rules.js';

const TICK_MS = 30_000;
const STORAGE_EVERY_MS = 60 * 60_000;
const DIGEST_LIMIT = 50;
const TABLE_IO_TTL_SEC = 300;
const RULE_WINDOW_MS = 5 * 60_000;
const SLOW_WINDOW_MS = 15 * 60_000;
const STORAGE_TOP_TABLES = 20;

/** Tên metric lịch sử của một digest (dùng cho biểu đồ Performance History của query). */
export const digestMetric = (id: string, kind: 'calls' | 'ms') => `dbq.${id}.${kind}`;

interface Snapshot {
  sessions: DbSession[] | null;
  transactions: DbTransaction[] | null;
  lockWaits: DbLockWait[] | null;
  digests: DbDigestStat[] | null;
  tables: DbTable[] | null;
}

/**
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): chụp số liệu database định kỳ để có lịch sử
 * (query theo digest, đọc/ghi theo bảng, dung lượng theo giờ) và đánh giá cảnh báo → sự kiện bắt đầu/hồi phục.
 */
@Injectable()
export class DatabaseMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('DatabaseMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private prevDigests = new Map<string, { calls: number; totalMs: number | null }>();
  private prevIo = new Map<string, { reads: number; writes: number; at: number }>();

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly monitoring: DatabaseMonitoringService,
    private readonly metrics: DatabaseMetricsService,
    private readonly store: DatabaseStoreService,
    private readonly config: CoreConfigService,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() private readonly redis?: RedisService,
  ) {}

  public onApplicationBootstrap(): void {
    if (!this.config.database.enabled || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Một chu kỳ (public để test). */
  public async tick(now = Date.now()): Promise<void> {
    if (this.running || !this.store.isAvailable()) return;
    this.running = true;
    try {
      const locked = await this.store.client.set(
        this.store.keys.collectLock(),
        String(now),
        'PX',
        TICK_MS - 1000,
        'NX',
      );
      if (locked !== 'OK') return;
      const snapshot = this.connection.connected() ? await this.collect(now) : null;
      await this.evaluate(snapshot, now);
    } catch (err) {
      this.logger.warn(
        `Database monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async collect(now: number): Promise<Snapshot> {
    const p = this.monitoring.provider;
    const safe = async <T>(
      cap: Parameters<DatabaseMonitoringService['supports']>[0],
      fn: () => Promise<T>,
    ) => (this.monitoring.supports(cap) ? fn().catch(() => null) : null);

    return this.monitoring.withContext(async (ctx) => {
      const snapshot: Snapshot = {
        sessions: await safe('sessions', () => p.sessions(ctx)),
        transactions: await safe('transactions', () => p.transactions(ctx)),
        lockWaits: await safe('locks', () => p.lockWaits(ctx)),
        digests: await safe('digestStats', () => p.digestStats(ctx, DIGEST_LIMIT)),
        tables: await safe('tables', () => p.tables(ctx)),
      };

      if (snapshot.sessions) {
        const own = snapshot.sessions.filter((s) => !s.isSelf);
        this.recorder?.gauge('db.sessions', own.length);
        this.recorder?.gauge(
          'db.sessions.active',
          own.filter((s) => s.state === 'active' || s.state === 'blocked').length,
        );
      }
      if (snapshot.digests) this.recordDigests(snapshot.digests);
      if (snapshot.tables) await this.recordTableIo(snapshot.tables, now);
      if (snapshot.tables && this.monitoring.supports('storage')) {
        const storage = await p.storage(ctx).catch(() => null);
        if (storage?.totalBytes !== null && storage)
          await this.snapshotStorage(storage.totalBytes ?? 0, snapshot.tables, now);
      }
      return snapshot;
    });
  }

  /** Delta của bộ đếm digest (cộng dồn từ lúc DB khởi động) → số lần chạy & tổng thời gian theo bucket. */
  private recordDigests(digests: DbDigestStat[]): void {
    const next = new Map<string, { calls: number; totalMs: number | null }>();
    for (const d of digests) {
      next.set(d.id, { calls: d.calls, totalMs: d.totalMs });
      const prev = this.prevDigests.get(d.id);
      if (!prev) continue;
      const calls = d.calls - prev.calls;
      // Bộ đếm bị reset (DB restart / truncate) → bỏ qua lần này.
      if (calls <= 0) continue;
      this.recorder?.count(digestMetric(d.id, 'calls'), calls);
      const ms = d.totalMs !== null && prev.totalMs !== null ? d.totalMs - prev.totalMs : null;
      if (ms !== null && ms >= 0) this.recorder?.count(digestMetric(d.id, 'ms'), ms);
    }
    this.prevDigests = next;
  }

  private async recordTableIo(tables: DbTable[], now: number): Promise<void> {
    const key = this.store.tableIoKey();
    const pipe = this.store.client.pipeline();
    let wrote = false;
    for (const t of tables) {
      if (t.reads === null || t.writes === null) continue;
      const prev = this.prevIo.get(t.name);
      this.prevIo.set(t.name, { reads: t.reads, writes: t.writes, at: now });
      if (!prev || t.reads < prev.reads || t.writes < prev.writes) continue;
      const sec = Math.max(1, (now - prev.at) / 1000);
      pipe.hset(
        key,
        t.name,
        JSON.stringify({
          readsPerSec: (t.reads - prev.reads) / sec,
          writesPerSec: (t.writes - prev.writes) / sec,
          at: now,
        }),
      );
      wrote = true;
    }
    if (!wrote) return;
    pipe.expire(key, TABLE_IO_TTL_SEC);
    await pipe.exec();
  }

  private async snapshotStorage(totalBytes: number, tables: DbTable[], now: number): Promise<void> {
    const [latest] = await this.store
      .storageSnapshots()
      .then((s) => s.slice(0, 1))
      .catch(() => [] as StorageSnapshot[]);
    if (latest && now - latest.at < STORAGE_EVERY_MS) return;
    const snapshot: StorageSnapshot = {
      at: now,
      totalBytes,
      tables: tables
        .slice(0, STORAGE_TOP_TABLES)
        .map((t) => ({ name: t.name, bytes: t.totalBytes ?? 0, rows: t.rows })),
    };
    await this.store.client
      .multi()
      .lpush(this.store.keys.storage(), JSON.stringify(snapshot))
      .ltrim(this.store.keys.storage(), 0, STORAGE_SNAPSHOT_LIMIT - 1)
      .exec();
  }

  private async evaluate(snapshot: Snapshot | null, now: number): Promise<void> {
    const [win, slowWin, active] = await Promise.all([
      this.metrics.window(now - RULE_WINDOW_MS, now, now, 's10'),
      this.metrics.window(now - SLOW_WINDOW_MS, now, now, 's10'),
      this.store.activeAlerts(),
    ]);
    const stats = this.metrics.stats(win);
    const pool = win?.buckets.length ? win.buckets : [];
    const [storageLatest] = await this.store
      .storageSnapshots()
      .catch(() => [] as StorageSnapshot[]);
    const limitGb = this.config.database.storageLimitGb;
    const longest = snapshot?.transactions?.reduce((m, t) => Math.max(m, t.ageSec), 0) ?? null;

    const input: DbRuleInput = {
      connection: this.connection.getStatus().state,
      pool: {
        used: gaugeWindow(pool, 'db.pool.used').current,
        limit: this.config.database.maxConnections,
        waiting: gaugeWindow(pool, 'db.pool.waiting').current,
      },
      queries: stats.queries,
      p95Ms: stats.p95Ms,
      errorRatePercent: stats.errorRatePercent,
      slowQueries15m: this.metrics.stats(slowWin).slow,
      longestTransactionSec: snapshot?.transactions ? longest : null,
      lockWaits: snapshot?.lockWaits
        ? {
            count: snapshot.lockWaits.length,
            maxWaitMs: Math.max(0, ...snapshot.lockWaits.map((w) => w.waitMs ?? 0)),
          }
        : null,
      storage: {
        bytes: storageLatest?.totalBytes ?? null,
        limitBytes: limitGb > 0 ? limitGb * 1024 ** 3 : null,
      },
    };
    const violations = evaluateDbRules(input, {
      db: this.config.database,
      dbP95Ms: this.config.performance.rules.dbP95Ms,
      dbPoolPercent: this.config.performance.rules.dbPoolPercent,
      errorRatePercent: this.config.performance.rules.errorRatePercent,
      minQueries: this.config.performance.rules.minQueries,
    });
    await this.applyAlerts(violations, active, now);
  }

  private async applyAlerts(
    violations: DbViolation[],
    active: Awaited<ReturnType<DatabaseStoreService['activeAlerts']>>,
    now: number,
  ): Promise<void> {
    const { started, set, recovered } = diffAlerts(violations, active, now);
    const key = this.store.keys.activeAlerts();
    const pipe = this.store.client.pipeline();
    for (const [id, state] of set) pipe.hset(key, id, JSON.stringify(state));
    if (recovered.length) pipe.hdel(key, ...recovered.map((r) => r.id));
    await pipe.exec();
    for (const v of started) {
      await recordDbEvent(this.redis, {
        type: 'alert_started',
        severity: v.severity,
        params: { rule: v.id, value: v.value, threshold: v.threshold, unit: v.unit },
        runtime: null,
        at: now,
      });
    }
    for (const r of recovered) {
      await recordDbEvent(this.redis, {
        type: 'alert_recovered',
        severity: 'success',
        params: { rule: r.id, minutes: Math.max(1, Math.round(r.durationMs / 60_000)) },
        runtime: null,
        at: now,
      });
    }
  }
}
