import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  DatabaseConnectionService,
  DatabaseMonitoringService,
  DatabaseOperationError,
  DatabaseOperationsService,
  type DbErrorKind,
  type DbErrorRecord,
  type DbEventRecord,
  type DbLockWait,
  type DbDigestStat,
  type DbTable,
  type MonitoringCapability,
  type MonitoringContext,
  type SessionAction,
  readPoolStats,
} from '@packages/database/index.js';
import { LONG_RUNNING_RUNTIMES } from '@packages/runtime/index.js';
import { round } from '@modules/performance/index.js';
import {
  DB_PROM,
  DatabaseMetricsService,
  type DbSeriesDef,
  type DbWindowStats,
} from './database-metrics.service.js';
import { DatabaseStoreService, type StorageSnapshot } from './database-store.service.js';
import { RULE_TAB, type DbRule } from './database-rules.js';
import {
  DatabaseActionRejectedException,
  DatabaseNotConnectedException,
  DatabaseNotFoundException,
} from '../exceptions/database-ops.exceptions.js';
import type {
  BlockingNodeDto,
  DbAlertDto,
  DbConfigDto,
  DbConnectionDetailDto,
  DbConnectionsDto,
  DbErrorRecordDto,
  DbErrorsDto,
  DbEventDto,
  DbExplainDto,
  DbHealthStatus,
  DbLiveQueriesDto,
  DbMetric,
  DbMetricsDto,
  DbMigrationsDto,
  DbOverviewDto,
  DbPoolDto,
  DbQueryDetailDto,
  DbQueryStatDto,
  DbQueryStatsDto,
  DbRange,
  DbReasonDto,
  DbReportDto,
  DbStorageDto,
  DbTableDetailDto,
  DbTableRowDto,
  DbTablesDto,
  DbTransactionsDto,
  SectionDto,
} from '../responses/database-ops.response.js';

export const DB_RANGES: Record<DbRange, number> = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 };
export const DB_METRICS: DbMetric[] = ['queries', 'latency', 'connections', 'errors'];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LIVE_QUERY_LIMIT = 8;
const LARGEST_TABLES = 5;
const OVERVIEW_EVENTS = 8;
const QUERY_STATS_LIMIT = 100;
const ERROR_LIST_LIMIT = 200;
const ERROR_KINDS: DbErrorKind[] = [
  'query',
  'timeout',
  'connection',
  'deadlock',
  'lock_timeout',
  'cancelled',
];
const TABLE_NAME = /^[\w$]{1,64}$/;

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Database Monitor: health, hiệu năng query, session, transaction/lock, bảng/dung lượng, migration, lỗi & sự kiện.
 * Mỗi phần có thể không có (driver không hỗ trợ / lỗi riêng) mà không làm hỏng các phần khác.
 */
@Injectable()
export class DatabaseOpsService {
  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly monitoring: DatabaseMonitoringService,
    private readonly operations: DatabaseOperationsService,
    private readonly metrics: DatabaseMetricsService,
    private readonly store: DatabaseStoreService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get db() {
    return this.config.database;
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: DbRange): Promise<DbOverviewDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const status = this.connection.getStatus();

    const sinceToday = Math.max(1, (now - today) / MINUTE);
    const [stats, todayStats, yesterdayStats, snapshot, events, alerts, runtimes, storage, errors] =
      await Promise.all([
        this.metrics.stats(DB_RANGES[range]),
        this.metrics.stats(sinceToday),
        this.metrics.stats(24 * 60, sinceToday),
        this.snapshot(),
        this.eventsSince(now - DAY),
        this.alerts(),
        this.runtimeConnections(),
        this.store.storageSnapshots().catch(() => [] as StorageSnapshot[]),
        this.errorsSince(today - DAY),
      ]);
    const pool = this.pool(todayStats);
    const sessions = snapshot.sessions;
    const tx = snapshot.transactions.available ? snapshot.transactions.data : null;
    const deadlocks = (from: number, to = now) =>
      errors.filter((e) => e.kind === 'deadlock' && e.at >= from && e.at < to).length;
    const deadlocks24h = deadlocks(now - DAY);
    const sizeBytes = snapshot.storage.available
      ? snapshot.storage.data.totalBytes
      : (storage[0]?.totalBytes ?? null);

    return {
      generatedAt: new Date(now).toISOString(),
      range,
      driver: this.connection.driver,
      environment: this.config.app.env,
      database: this.db.database,
      capabilities: [...this.monitoring.provider.capabilities],
      health: {
        status: this.healthStatus(status.state, alerts),
        reasons: this.healthReasons(status, alerts),
        since: status.since,
        lastSuccessAt: status.lastSuccessAt,
        pingMs: status.lastPingMs,
        lastError: status.lastError,
      },
      server: snapshot.server,
      runtimes,
      kpis: {
        connections: { used: pool.used, limit: pool.limit, percent: pool.percent },
        sessions: sessions.available ? sessions.data.filter((s) => !s.isSelf).length : null,
        avgMs: stats.avgMs,
        queriesPerSec: stats.queriesPerSec,
        errorRatePercent: stats.errorRatePercent,
        failedQueries: stats.failed,
        activeTransactions: tx ? tx.length : null,
        lockWaits: snapshot.locks.available ? snapshot.locks.data.length : null,
        deadlocks24h,
        sizeBytes,
      },
      pool,
      alerts,
      liveQueries: this.mapSection(sessions, (list) =>
        list
          .filter((s) => !s.isSelf && (s.state === 'active' || s.state === 'blocked'))
          .sort((a, b) => (b.queryMs ?? 0) - (a.queryMs ?? 0))
          .slice(0, LIVE_QUERY_LIMIT),
      ),
      transactions: {
        active: tx ? tx.length : null,
        longestSec: tx && tx.length ? Math.max(...tx.map((t) => t.ageSec)) : null,
      },
      largestTables: this.mapSection(snapshot.tables, (list) =>
        list
          .slice(0, LARGEST_TABLES)
          .map((t) => ({ ...t, growthPercent: this.growthPercent(t, storage, now) })),
      ),
      report: {
        today: this.report(todayStats, deadlocks(today), storage, today, now),
        yesterday: this.report(
          yesterdayStats,
          deadlocks(today - DAY, today),
          storage,
          today - DAY,
          today,
        ),
      },
      events: events.slice(0, OVERVIEW_EVENTS).map((e) => this.eventDto(e)),
      settings: {
        slowQueryMs: this.db.slowQueryMs,
        longTransactionSec: this.db.longTransactionSec,
        actionsEnabled: this.db.actionsEnabled,
        migrationsEnabled: this.db.migrationsEnabled,
      },
    };
  }

  /** Đọc một lần các phần dùng chung trên cùng một connection (tuần tự). */
  private snapshot() {
    const p = this.monitoring.provider;
    return this.monitoring.batch(async (part) => ({
      server: await part('serverInfo', (ctx) => p.serverInfo(ctx)),
      sessions: await part('sessions', (ctx) => p.sessions(ctx)),
      transactions: await part('transactions', (ctx) => p.transactions(ctx)),
      locks: await part('locks', (ctx) => p.lockWaits(ctx)),
      tables: await part('tables', (ctx) => p.tables(ctx)),
      storage: await part('storage', (ctx) => p.storage(ctx)),
    }));
  }

  private section<T>(
    cap: MonitoringCapability,
    fn: (ctx: MonitoringContext) => Promise<T>,
  ): Promise<SectionDto<T>> {
    return this.monitoring.section(cap, fn);
  }

  private mapSection<T, R>(s: SectionDto<T>, fn: (data: T) => R): SectionDto<R> {
    return s.available ? { available: true, data: fn(s.data) } : s;
  }

  private healthStatus(state: string, alerts: DbAlertDto[]): DbHealthStatus {
    switch (state) {
      case 'connected':
        return alerts.length ? 'degraded' : 'healthy';
      case 'reconnecting':
        return 'reconnecting';
      case 'unavailable':
        return 'unavailable';
      case 'disabled':
        return 'disabled';
      default:
        return 'unknown';
    }
  }

  private healthReasons(
    status: ReturnType<DatabaseConnectionService['getStatus']>,
    alerts: DbAlertDto[],
  ) {
    if (status.state !== 'connected') {
      const reasons: DbReasonDto[] = [
        { code: status.state, message: this.i18n.t(`database.health.${status.state}`) },
      ];
      if (status.lastError)
        reasons.push({
          code: status.lastError.code ?? 'ERROR',
          message: `${status.lastError.code ?? ''} ${status.lastError.message}`.trim(),
        });
      return reasons;
    }
    return alerts.map((a) => ({ code: a.rule, message: a.message }));
  }

  private async alerts(): Promise<DbAlertDto[]> {
    const active = await this.store.activeAlerts().catch(() => new Map());
    return [...active.entries()]
      .map(([rule, s]) => ({
        id: rule,
        rule,
        severity: s.severity,
        title: this.i18n.t(`database.alert.${rule}.title`),
        message: this.i18n.t(`database.alert.${rule}.message`, {
          value: s.value,
          threshold: s.threshold,
          limit: this.db.maxConnections,
        }),
        value: s.value,
        threshold: s.threshold,
        unit: s.unit,
        since: new Date(s.since).toISOString(),
        tab: RULE_TAB[rule as DbRule] ?? 'overview',
      }))
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
  }

  /** Trạng thái kết nối database mà từng runtime tự báo (key TTL — runtime đã tắt tự biến mất). */
  private async runtimeConnections() {
    const statuses = await this.store
      .connections([...LONG_RUNNING_RUNTIMES])
      .catch(() => new Map());
    return [...statuses.entries()].map(([runtime, s]) => ({
      instance: runtime,
      runtime,
      state: s.state,
      lastPingMs: s.lastPingMs,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
    }));
  }

  /** Pool TypeORM của runtime API (đọc trực tiếp từ driver); `peakToday` từ lịch sử Prometheus. */
  private pool(todayStats: DbWindowStats): DbPoolDto {
    const stats = readPoolStats(this.connection.connected()?.driver);
    const limit = this.db.maxConnections;
    return {
      used: stats?.used ?? null,
      idle: stats?.idle ?? null,
      waiting: stats?.waiting ?? null,
      limit,
      percent: stats && limit ? round((stats.used / limit) * 100, 1) : null,
      peakToday: todayStats.poolPeak,
    };
  }

  private report(
    stats: DbWindowStats,
    deadlocks: number,
    storage: StorageSnapshot[],
    from: number,
    to: number,
  ): DbReportDto {
    return {
      queries: stats.queries,
      avgMs: stats.avgMs,
      failedQueries: stats.failed,
      peakConnections: stats.poolPeak,
      deadlocks,
      growthBytes: this.growthBetween(storage, from, to),
    };
  }

  /** Chênh lệch dung lượng giữa snapshot đầu tiên và cuối cùng trong [from, to]. */
  private growthBetween(storage: StorageSnapshot[], from: number, to: number): number | null {
    const inRange = storage.filter((s) => s.at >= from && s.at <= to);
    if (inRange.length < 2) return null;
    return inRange[0]!.totalBytes - inRange[inRange.length - 1]!.totalBytes;
  }

  private growthPercent(t: DbTable, storage: StorageSnapshot[], now: number): number | null {
    const old = storage.find((s) => s.at <= now - DAY + MINUTE * 60);
    const before = old?.tables.find((x) => x.name === t.name)?.bytes;
    if (!before || t.totalBytes === null) return null;
    return round(((t.totalBytes - before) / before) * 100, 1);
  }

  // ─── Metrics chart ────────────────────────────────────────────────────────

  /** Biểu đồ đọc từ Prometheus (counter/gauge do monitor ghi); không có dữ liệu → series rỗng. */
  public async getMetrics(range: DbRange, metric: DbMetric): Promise<DbMetricsDto> {
    const p = DB_PROM;
    const defs: Record<DbMetric, DbSeriesDef[]> = {
      queries: [{ id: 'queriesPerSec', unit: '/s', expr: `sum(rate(${p.statements}[$w]))` }],
      latency: [
        {
          id: 'avgMs',
          unit: 'ms',
          expr: `1000 * sum(rate(${p.seconds}[$w])) / sum(rate(${p.statements}[$w]))`,
        },
      ],
      connections: [
        { id: 'poolUsed', unit: '', expr: `max(${p.pool}{state="used"})` },
        { id: 'sessions', unit: '', expr: `max(${p.sessions})` },
        { id: 'poolWaiting', unit: '', expr: `max(${p.pool}{state="waiting"})` },
      ],
      errors: [{ id: 'failedPerMin', unit: '/min', expr: `sum(rate(${p.errors}[$w])) * 60` }],
    };
    const { series, resolutionSec } = await this.metrics.series(DB_RANGES[range], defs[metric]);
    const list = series.map((s) => ({
      id: s.id,
      label: this.i18n.t(`database.series.${s.id}`),
      unit: s.unit,
      points: s.points,
    }));
    return { metric, range, resolutionSec, unit: list[0]?.unit ?? '', series: list };
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  public async getLiveQueries(): Promise<DbLiveQueriesDto> {
    const sessions = await this.section('sessions', (ctx) =>
      this.monitoring.provider.sessions(ctx),
    );
    return {
      sessions: this.mapSection(sessions, (list) =>
        list
          .filter((s) => !s.isSelf && s.query !== null)
          .sort((a, b) => (b.queryMs ?? 0) - (a.queryMs ?? 0)),
      ),
      slowQueryMs: this.db.slowQueryMs,
      actionsEnabled: this.db.actionsEnabled,
    };
  }

  public async getQueryStats(range: DbRange, minMs: number): Promise<DbQueryStatsDto> {
    const now = Date.now();
    const from = now - DB_RANGES[range] * MINUTE;
    const stats = await this.section('digestStats', (ctx) =>
      this.monitoring.provider.digestStats(ctx, QUERY_STATS_LIMIT),
    );
    return {
      stats: this.mapSection(stats, (list) =>
        list
          .map((d) => this.statDto(d))
          .filter(
            (d) =>
              (d.lastSeen === null || Date.parse(d.lastSeen) >= from) &&
              (minMs <= 0 || (d.avgMs ?? 0) >= minMs || (d.maxMs ?? 0) >= minMs),
          ),
      ),
      minMs,
      range,
      note: 'cumulative',
    };
  }

  private statDto(d: DbDigestStat): DbQueryStatDto {
    return {
      ...d,
      avgMs: d.avgMs === null ? null : round(d.avgMs, 2),
      totalMs: d.totalMs === null ? null : round(d.totalMs, 1),
      maxMs: d.maxMs === null ? null : round(d.maxMs, 2),
      slow: this.digestSlow(d),
    };
  }

  private digestSlow(d: { avgMs: number | null }): boolean {
    return d.avgMs !== null && d.avgMs >= this.db.slowQueryMs;
  }

  /** Bộ đếm cộng dồn của digest; lịch sử từng câu và slow query nằm ở Logs (TypeORM ghi qua Pino). */
  public async getQueryDetail(digest: string, _range: DbRange): Promise<DbQueryDetailDto> {
    const stats = await this.section('digestStats', (ctx) =>
      this.monitoring.provider.digestStats(ctx, QUERY_STATS_LIMIT * 2),
    );
    if (!stats.available) throw this.sectionError(stats);
    const found = stats.data.find((d) => d.id === digest);
    if (!found) throw new DatabaseNotFoundException('database.error.queryNotFound', { id: digest });
    return { stat: this.statDto(found) };
  }

  public async getExplain(digest: string): Promise<DbExplainDto> {
    const result = await this.section('explain', (ctx) =>
      this.monitoring.provider.explain(ctx, digest),
    );
    if (!result.available)
      return {
        available: false,
        reason: result.reason === 'error' ? (result.message ?? 'error') : result.reason,
        plan: null,
      };
    if (!result.data) return { available: false, reason: 'notExplainable', plan: null };
    return { available: true, reason: null, plan: result.data };
  }

  // ─── Connections ──────────────────────────────────────────────────────────

  public async getConnections(): Promise<DbConnectionsDto> {
    const now = Date.now();
    const p = this.monitoring.provider;
    const [{ sessions, server }, todayStats] = await Promise.all([
      this.monitoring.batch(async (part) => ({
        sessions: await part('sessions', (ctx) => p.sessions(ctx)),
        server: await part('serverInfo', (ctx) => p.serverInfo(ctx)),
      })),
      this.metrics.stats(Math.max(1, (now - startOfDay(now)) / MINUTE)),
    ]);
    const byRuntime = new Map<string, { count: number; active: number }>();
    if (sessions.available) {
      for (const s of sessions.data) {
        if (s.isSelf) continue;
        const key = s.runtime ?? 'other';
        const entry = byRuntime.get(key) ?? { count: 0, active: 0 };
        entry.count++;
        if (s.state === 'active' || s.state === 'blocked') entry.active++;
        byRuntime.set(key, entry);
      }
    }
    return {
      sessions,
      byRuntime: [...byRuntime.entries()]
        .map(([runtime, v]) => ({ runtime, ...v }))
        .sort((a, b) => b.count - a.count),
      pool: this.pool(todayStats),
      maxConnections: server.available ? server.data.maxConnections : null,
      actionsEnabled: this.db.actionsEnabled,
    };
  }

  public async getConnectionDetail(id: string): Promise<DbConnectionDetailDto> {
    const p = this.monitoring.provider;
    const data = await this.section('sessions', async (ctx) => ({
      sessions: await p.sessions(ctx),
      transactions: this.monitoring.supports('transactions')
        ? await p.transactions(ctx).catch(() => [])
        : [],
      waits: this.monitoring.supports('locks') ? await p.lockWaits(ctx).catch(() => []) : [],
    }));
    if (!data.available) throw this.sectionError(data);
    const session = data.data.sessions.find((s) => s.id === id);
    if (!session) throw new DatabaseNotFoundException('database.error.sessionNotFound', { id });
    return {
      session,
      transaction: data.data.transactions.find((t) => t.sessionId === id) ?? null,
      waits: data.data.waits.filter((w) => w.waitingSession === id || w.blockingSession === id),
      actionsEnabled: this.db.actionsEnabled,
    };
  }

  // ─── Transactions & locks ─────────────────────────────────────────────────

  public async getTransactions(): Promise<DbTransactionsDto> {
    const now = Date.now();
    const p = this.monitoring.provider;
    const [{ transactions, lockWaits }, errors] = await Promise.all([
      this.monitoring.batch(async (part) => ({
        transactions: await part('transactions', (ctx) => p.transactions(ctx)),
        lockWaits: await part('locks', (ctx) => p.lockWaits(ctx)),
      })),
      this.errorsSince(now - DAY),
    ]);
    const deadlocks = errors.filter((e) => e.kind === 'deadlock');
    const tx = transactions.available ? transactions.data : null;
    return {
      transactions,
      stats: {
        active: tx ? tx.length : null,
        longestSec: tx && tx.length ? Math.max(...tx.map((t) => t.ageSec)) : null,
      },
      lockWaits,
      blockingChains: lockWaits.available ? buildBlockingChains(lockWaits.data) : [],
      deadlocks: {
        today: deadlocks.filter((e) => e.at >= startOfDay(now)).length,
        last24h: deadlocks.length,
        recent: deadlocks.slice(0, 20).map((e) => this.errorDto(e)),
      },
      longTransactionSec: this.db.longTransactionSec,
    };
  }

  // ─── Tables & storage ─────────────────────────────────────────────────────

  public async getTables(): Promise<DbTablesDto> {
    const now = Date.now();
    const [tables, storage, io] = await Promise.all([
      this.section('tables', (ctx) => this.monitoring.provider.tables(ctx)),
      this.store.storageSnapshots().catch(() => [] as StorageSnapshot[]),
      this.store.tableIo().catch(() => new Map()),
    ]);
    return {
      tables: this.mapSection(tables, (list) =>
        list.map((t) => this.tableRow(t, storage, io, now)),
      ),
    };
  }

  private tableRow<T extends DbTable>(
    t: T,
    storage: StorageSnapshot[],
    io: Awaited<ReturnType<DatabaseStoreService['tableIo']>>,
    now: number,
  ): T & Pick<DbTableRowDto, 'growthPercent' | 'readsPerSec' | 'writesPerSec'> {
    const rate = io.get(t.name);
    return {
      ...t,
      growthPercent: this.growthPercent(t, storage, now),
      readsPerSec: rate ? round(rate.readsPerSec, 2) : null,
      writesPerSec: rate ? round(rate.writesPerSec, 2) : null,
    };
  }

  public async getTableDetail(name: string): Promise<DbTableDetailDto> {
    if (!TABLE_NAME.test(name))
      throw new DatabaseNotFoundException('database.error.tableNotFound', { name });
    const now = Date.now();
    const [detail, storage, io] = await Promise.all([
      this.section('tables', (ctx) => this.monitoring.provider.tableDetail(ctx, name)),
      this.store.storageSnapshots().catch(() => [] as StorageSnapshot[]),
      this.store.tableIo().catch(() => new Map()),
    ]);
    if (!detail.available) throw this.sectionError(detail);
    if (!detail.data) throw new DatabaseNotFoundException('database.error.tableNotFound', { name });
    return this.tableRow(detail.data, storage, io, now);
  }

  public async getStorage(): Promise<DbStorageDto> {
    const now = Date.now();
    const p = this.monitoring.provider;
    const [{ storage, tables }, snapshots] = await Promise.all([
      this.monitoring.batch(async (part) => ({
        storage: await part('storage', (ctx) => p.storage(ctx)),
        tables: await part('tables', (ctx) => p.tables(ctx)),
      })),
      this.store.storageSnapshots().catch(() => [] as StorageSnapshot[]),
    ]);
    const current = storage.available
      ? storage.data.totalBytes
      : (snapshots[0]?.totalBytes ?? null);
    const limitBytes = this.db.storageLimitGb > 0 ? this.db.storageLimitGb * 1024 ** 3 : null;
    const oldestToday = [...snapshots].reverse().find((s) => s.at >= startOfDay(now));
    const monthAgo = snapshots.find((s) => s.at <= now - 29 * DAY);
    return {
      storage,
      limitBytes,
      percent: current !== null && limitBytes ? round((current / limitBytes) * 100, 1) : null,
      growthTodayBytes: current !== null && oldestToday ? current - oldestToday.totalBytes : null,
      growth30dBytes: current !== null && monthAgo ? current - monthAgo.totalBytes : null,
      history: [...snapshots].reverse().map((s) => ({ t: s.at, value: s.totalBytes })),
      topTables: tables.available
        ? tables.data.slice(0, 10).map((t) => ({ name: t.name, totalBytes: t.totalBytes }))
        : [],
    };
  }

  // ─── Migrations ───────────────────────────────────────────────────────────

  public async getMigrations(): Promise<DbMigrationsDto> {
    try {
      const { items, lastRun } = await this.operations.migrations();
      return {
        items,
        applied: items.filter((m) => m.status === 'applied').length,
        pending: items.filter((m) => m.status === 'pending').length,
        lastRun,
        enabled: this.db.migrationsEnabled,
        environment: this.config.app.env,
        database: this.db.database,
        tableName: this.db.migrationsTableName,
      };
    } catch (err) {
      throw this.operationError(err);
    }
  }

  public async runMigrations() {
    try {
      return await this.operations.runMigrations();
    } catch (err) {
      throw this.operationError(err);
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  public testConnection() {
    return this.operations.testConnection();
  }

  public async sessionAction(action: SessionAction, id: string): Promise<{ ok: true }> {
    try {
      await this.operations.sessionAction(action, id);
      return { ok: true };
    } catch (err) {
      throw this.operationError(err);
    }
  }

  // ─── Events & errors ──────────────────────────────────────────────────────

  public async getEvents(range: DbRange): Promise<DbEventDto[]> {
    const events = await this.eventsSince(Date.now() - DB_RANGES[range] * MINUTE);
    return events.map((e) => this.eventDto(e));
  }

  public async getErrors(range: DbRange): Promise<DbErrorsDto> {
    const now = Date.now();
    const errors = await this.errorsSince(now - DB_RANGES[range] * MINUTE);
    const counts = Object.fromEntries(
      ERROR_KINDS.map((k) => [k, errors.filter((e) => e.kind === k).length]),
    ) as Record<DbErrorKind, number>;
    return {
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      items: errors.slice(0, ERROR_LIST_LIMIT).map((e) => this.errorDto(e)),
      range,
    };
  }

  public getConfig(): DbConfigDto {
    const db = this.db;
    return {
      items: [
        { key: 'driver', value: this.connection.driver },
        { key: 'host', value: db.host },
        { key: 'port', value: db.port },
        { key: 'database', value: db.database },
        { key: 'username', value: db.username },
        { key: 'password', value: db.password !== '', sensitive: true },
        { key: 'poolMax', value: db.maxConnections },
        { key: 'synchronize', value: db.synchronize },
        { key: 'logging', value: db.logging },
        { key: 'autoLoadEntities', value: true },
        { key: 'ssl', value: db.ssl },
        { key: 'connectTimeoutMs', value: db.connectTimeoutMs },
        { key: 'healthIntervalMs', value: db.healthIntervalMs },
        { key: 'slowQueryMs', value: db.slowQueryMs },
        { key: 'longTransactionSec', value: db.longTransactionSec },
        { key: 'storageLimitGb', value: db.storageLimitGb || null },
        { key: 'migrationsTable', value: db.migrationsTableName },
        { key: 'actionsEnabled', value: db.actionsEnabled },
        { key: 'migrationsEnabled', value: db.migrationsEnabled },
      ],
    };
  }

  private async eventsSince(from: number): Promise<DbEventRecord[]> {
    return (await this.store.events().catch(() => [] as DbEventRecord[])).filter(
      (e) => e.at >= from,
    );
  }

  private async errorsSince(from: number): Promise<DbErrorRecord[]> {
    return (await this.store.errors().catch(() => [] as DbErrorRecord[])).filter(
      (e) => e.at >= from,
    );
  }

  private eventDto(e: DbEventRecord): DbEventDto {
    const rule = typeof e.params['rule'] === 'string' ? e.params['rule'] : null;
    const params = {
      ...e.params,
      ...(rule ? { alert: this.i18n.t(`database.alert.${rule}.title`) } : {}),
      runtime: e.runtime ? this.i18n.t(`runtime.name.${e.runtime}`) : '',
    };
    // Cảnh báo bắt đầu: dùng đúng câu mô tả của rule (có ngưỡng khi rule có ngưỡng).
    const message =
      e.type === 'alert_started' && rule
        ? `${params.alert}: ${this.i18n.t(`database.alert.${rule}.message`, { ...e.params, limit: this.db.maxConnections })}`
        : this.i18n.t(`database.event.${e.type}`, params);
    return {
      id: e.id,
      at: new Date(e.at).toISOString(),
      type: e.type,
      severity: e.severity,
      message,
      runtime: e.runtime,
      tab: rule
        ? (RULE_TAB[rule as DbRule] ?? null)
        : e.type === 'deadlock'
          ? 'transactions'
          : e.type.startsWith('migration')
            ? 'migrations'
            : e.type === 'query_cancelled' || e.type === 'session_terminated'
              ? 'connections'
              : null,
    };
  }

  private errorDto(e: DbErrorRecord): DbErrorRecordDto {
    return {
      at: new Date(e.at).toISOString(),
      kind: e.kind,
      code: e.code,
      message: e.message,
      sql: e.sql,
      runtime: e.runtime,
      correlationId: e.correlationId,
    };
  }

  private sectionError(s: Extract<SectionDto<unknown>, { available: false }>): Error {
    if (s.reason === 'disconnected')
      return new DatabaseNotConnectedException(s.message ?? 'unknown');
    if (s.reason === 'unsupported')
      return new DatabaseActionRejectedException(
        'UNSUPPORTED',
        'database.error.unsupported',
        { driver: this.connection.driver },
        422,
      );
    return new DatabaseActionRejectedException(
      'QUERY_FAILED',
      'database.error.monitoringFailed',
      { message: s.message ?? '' },
      502,
    );
  }

  private operationError(err: unknown): Error {
    if (!(err instanceof DatabaseOperationError))
      return err instanceof Error ? err : new Error(String(err));
    switch (err.code) {
      case 'UNAVAILABLE':
        return new DatabaseNotConnectedException(err.message);
      case 'SESSION_NOT_FOUND':
        return new DatabaseNotFoundException('database.error.sessionNotFound', { id: err.message });
      case 'FAILED':
        return new DatabaseActionRejectedException(
          'ACTION_FAILED',
          'database.error.actionFailed',
          { message: err.message },
          502,
        );
      default:
        return new DatabaseActionRejectedException(err.code, `database.error.${err.code}`, {
          driver: this.connection.driver,
        });
    }
  }
}

/**
 * Cây chặn: gốc là session đang chặn người khác nhưng không bị ai chặn. Có vòng (deadlock đang hình thành)
 * thì dừng ở node đã thăm.
 */
export function buildBlockingChains(waits: DbLockWait[]): BlockingNodeDto[] {
  const children = new Map<string, DbLockWait[]>();
  const info = new Map<string, { runtime: string | null; query: string | null }>();
  for (const w of waits) {
    children.set(w.blockingSession, [...(children.get(w.blockingSession) ?? []), w]);
    info.set(w.blockingSession, { runtime: w.blockingRuntime, query: w.blockingQuery });
    if (!info.has(w.waitingSession))
      info.set(w.waitingSession, { runtime: w.waitingRuntime, query: w.waitingQuery });
  }
  const waiting = new Set(waits.map((w) => w.waitingSession));
  const build = (session: string, via: DbLockWait | null, seen: Set<string>): BlockingNodeDto => {
    const next = new Set(seen).add(session);
    return {
      session,
      runtime: via?.waitingRuntime ?? info.get(session)?.runtime ?? null,
      query: via?.waitingQuery ?? info.get(session)?.query ?? null,
      waitMs: via?.waitMs ?? null,
      object: via?.object ?? null,
      lockMode: via?.lockMode ?? null,
      children: (children.get(session) ?? [])
        .filter((w) => !next.has(w.waitingSession))
        .map((w) => build(w.waitingSession, w, next)),
    };
  };
  const roots = [...children.keys()].filter((s) => !waiting.has(s));
  // Toàn bộ là vòng (không có gốc) → lấy session đầu tiên làm gốc để vẫn hiện được.
  return (roots.length ? roots : [...children.keys()].slice(0, 1)).map((s) =>
    build(s, null, new Set()),
  );
}
