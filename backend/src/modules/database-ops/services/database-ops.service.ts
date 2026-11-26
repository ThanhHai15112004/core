import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  DatabaseConnectionService,
  DatabaseMonitoringService,
  DatabaseOperationError,
  DatabaseOperationsService,
  DatabaseRoutingService,
  getActiveDatabaseRouter,
  type DbBackupReportRecord,
  type DbBackupRunStatus,
  type DbErrorKind,
  type DbErrorRecord,
  type DbEventRecord,
  type DbLockWait,
  type DbDigestStat,
  type DbSlowQueryRecord,
  type DbTable,
  type MonitoringCapability,
  type MonitoringContext,
  type SessionAction,
  readPoolStats,
} from '@packages/database/index.js';
import { LONG_RUNNING_RUNTIMES } from '@packages/runtime/index.js';
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
  DbBackupSummaryDto,
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
  DbReplicationOverviewDto,
  DbReportDto,
  DbSlowQueriesDto,
  DbStorageDto,
  DbTableDetailDto,
  DbTableRowDto,
  DbTablesDto,
  DbTransactionsDto,
  SectionDto,
} from '../responses/database-ops.response.js';
import { round } from '@packages/metrics/index.js';

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

/** Lấy mốc thời gian bắt đầu của ngày theo chuỗi ngày giờ */
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
    @Optional() private readonly routing?: DatabaseRoutingService,
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
    const [stats, todayStats, yesterdayStats, snapshot, events, alerts, runtimes, storage, errors, replication] =
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
        this.getReplicationOverview(),
      ]);
    const pool = this.pool(todayStats);
    const sessions = snapshot.sessions;
    const tx = snapshot.transactions.available ? snapshot.transactions.data : null;
    /** Lấy danh sách hoặc thống kê tình trạng khóa chết (deadlocks) */
    const deadlocks = (from: number, to = now) =>
      errors.filter((e) => e.kind === 'deadlock' && e.at >= from && e.at < to).length;
    const deadlocks24h = deadlocks(now - DAY);
    const sizeBytes = snapshot.storage.available
      ? snapshot.storage.data.totalBytes
      : (storage[0]?.totalBytes ?? null);

    return {
      range,
      driver: this.connection.driver,
      environment: this.config.app.env,
      database: this.db.database,
      capabilities: [...this.monitoring.provider.capabilities],
      health: {
        status: this.healthStatus(status.state, alerts),
        reasons: this.healthReasons(status, alerts),
        lastSuccessAt: status.lastSuccessAt,
        pingMs: status.lastPingMs,
      },
      server: snapshot.server,
      runtimes,
      kpis: {
        connections: { used: pool.used, limit: pool.limit },
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
      replication,
      events: events.slice(0, OVERVIEW_EVENTS).map((e) => this.eventDto(e)),
      settings: {
        slowQueryMs: this.db.slowQueryMs,
        longTransactionSec: this.db.longTransactionSec,
        actionsEnabled: this.db.actionsEnabled,
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

  /** Phân chia và nhóm dữ liệu theo từng phân vùng chức năng */
  private section<T>(
    cap: MonitoringCapability,
    fn: (ctx: MonitoringContext) => Promise<T>,
  ): Promise<SectionDto<T>> {
    return this.monitoring.section(cap, fn);
  }

  /** Ánh xạ dữ liệu phân vùng sang cấu trúc phản hồi chuẩn */
  private mapSection<T, R>(s: SectionDto<T>, fn: (data: T) => R): SectionDto<R> {
    return s.available ? { available: true, data: fn(s.data) } : s;
  }

  /** Đánh giá trạng thái sức khỏe tổng hợp của dịch vụ */
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

  /** Tổng hợp các nguyên nhân dẫn đến suy giảm sức khỏe dịch vụ */
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

  /** Thu thập danh sách các cảnh báo đang hoạt động trong hệ thống */
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

  /** Tạo báo cáo chi tiết về tình trạng hoạt động của dịch vụ */
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

  /** Tính toán tỷ lệ phần trăm tăng trưởng dung lượng lưu trữ */
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
    const series = await this.metrics.series(DB_RANGES[range], defs[metric]);
    const list = series.map((s) => ({
      id: s.id,
      label: this.i18n.t(`database.series.${s.id}`),
      unit: s.unit,
      points: s.points,
    }));
    return { metric, unit: list[0]?.unit ?? '', series: list };
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

  /** Truy vấn số liệu thống kê hiệu năng thực thi truy vấn */
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
    };
  }

  /** Chuyển đổi số liệu thống kê truy vấn thành đối tượng DTO */
  private statDto(d: DbDigestStat): DbQueryStatDto {
    return {
      ...d,
      avgMs: d.avgMs === null ? null : round(d.avgMs, 2),
      totalMs: d.totalMs === null ? null : round(d.totalMs, 1),
      maxMs: d.maxMs === null ? null : round(d.maxMs, 2),
      slow: this.digestSlow(d),
    };
  }

  /** Lọc và sắp xếp danh sách các truy vấn thực thi chậm nhất */
  private digestSlow(d: { avgMs: number | null }): boolean {
    return d.avgMs !== null && d.avgMs >= this.db.slowQueryMs;
  }

  /** Bộ đếm cộng dồn của digest; lịch sử từng câu và slow query nằm ở Logs (TypeORM ghi qua Pino). */
  public async getQueryDetail(digest: string): Promise<DbQueryDetailDto> {
    const stats = await this.section('digestStats', (ctx) =>
      this.monitoring.provider.digestStats(ctx, QUERY_STATS_LIMIT * 2),
    );
    if (!stats.available) throw this.sectionError(stats);
    const found = stats.data.find((d) => d.id === digest);
    if (!found) throw new DatabaseNotFoundException('database.error.queryNotFound', { id: digest });
    return { stat: this.statDto(found) };
  }

  /** Lấy kế hoạch thực thi chi tiết của câu truy vấn chỉ định */
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

  /** Lấy thông tin chi tiết của một kết nối cơ sở dữ liệu */
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

  /** Chuyển đổi dữ liệu bảng thành hàng hiển thị trên giao diện */
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

  /** Truy vấn chi tiết thông tin bảng trong cơ sở dữ liệu */
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

  /** Lấy dữ liệu tổng hợp về dung lượng lưu trữ cơ sở dữ liệu */
  public async getStorage(): Promise<DbStorageDto> {
    const now = Date.now();
    const [storage, snapshots] = await Promise.all([
      this.section('storage', (ctx) => this.monitoring.provider.storage(ctx)),
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

  /** Thực thi các tệp migration cơ sở dữ liệu chưa được áp dụng */
  public async runMigrations() {
    try {
      return await this.operations.runMigrations();
    } catch (err) {
      throw this.operationError(err);
    }
  }

  // ─── Slow queries (with requestId / traceId) & Backup Status ──────────────

  /** Danh sách các truy vấn chậm đã ghi nhận kèm requestId / traceId để truy vết. */
  public async getSlowQueries(range: DbRange, limit = 100): Promise<DbSlowQueriesDto> {
    const thresholdMs = this.db.slowQueryMs ?? 500;
    if (!this.store.isAvailable()) {
      return { available: false, thresholdMs, items: [] };
    }
    const from = Date.now() - DB_RANGES[range] * MINUTE;
    const rows = await this.store.slowQueries().catch(() => [] as DbSlowQueryRecord[]);
    const items = rows
      .filter((r) => r.at >= from)
      .slice(0, limit)
      .map((r) => ({
        at: new Date(r.at).toISOString(),
        durationMs: r.durationMs,
        thresholdMs: r.thresholdMs,
        sql: r.sql,
        runtime: r.runtime,
        requestId: r.requestId,
        traceId: r.traceId,
        correlationId: r.correlationId,
      }));
    return { available: true, thresholdMs, items };
  }

  /** Đọc trạng thái backup database gần nhất và lịch sử các lần chạy đã báo cáo. */
  public async getBackupStatus(): Promise<DbBackupSummaryDto> {
    const maxAgeHours = this.db.backupMaxAgeHours ?? 26;
    if (!this.store.isAvailable()) {
      return {
        status: 'unknown',
        stale: false,
        maxAgeHours,
        source: 'unconfigured',
        latest: null,
        history: [],
      };
    }
    const [latest, history] = await Promise.all([
      this.store.getBackupStatus().catch(() => null),
      this.store.getBackupHistory().catch(() => [] as DbBackupReportRecord[]),
    ]);
    if (!latest) {
      return {
        status: 'unknown',
        stale: false,
        maxAgeHours,
        source: 'unconfigured',
        latest: null,
        history,
      };
    }
    const atMs = Date.parse(latest.at);
    const stale = !Number.isNaN(atMs) && Date.now() - atMs > maxAgeHours * 60 * MINUTE;
    const status =
      latest.status === 'failed'
        ? 'critical'
        : stale
          ? 'warning'
          : latest.status === 'unknown'
            ? 'unknown'
            : 'healthy';
    return {
      status,
      stale,
      maxAgeHours,
      source: 'reported',
      latest,
      history,
    };
  }

  /** Ghi nhận báo cáo kết quả backup mới từ cron / script vận hành. */
  public async reportBackup(input: {
    status: DbBackupRunStatus;
    at?: string | undefined;
    durationMs?: number | null | undefined;
    sizeBytes?: number | null | undefined;
    location?: string | null | undefined;
    provider?: string | null | undefined;
    retentionDays?: number | null | undefined;
    nextScheduledAt?: string | null | undefined;
    error?: string | null | undefined;
    reportedBy?: string | null | undefined;
  }): Promise<DbBackupSummaryDto> {
    if (!this.store.isAvailable()) {
      throw new DatabaseNotConnectedException('Redis store unavailable');
    }
    const record: DbBackupReportRecord = {
      id: `bkp-${randomUUID()}`,
      at: input.at ?? new Date().toISOString(),
      status: input.status,
      durationMs: input.durationMs ?? null,
      sizeBytes: input.sizeBytes ?? null,
      location: input.location ?? null,
      provider: input.provider ?? null,
      retentionDays: input.retentionDays ?? null,
      nextScheduledAt: input.nextScheduledAt ?? null,
      error: input.error ?? null,
      reportedBy: input.reportedBy ?? null,
    };
    await this.store.saveBackupReport(record);
    return this.getBackupStatus();
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  public testConnection() {
    return this.operations.testConnection();
  }

  /** Thực hiện hành động vận hành trên một phiên kết nối cơ sở dữ liệu */
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

  /** Lấy danh sách thống kê các lỗi HTTP ghi nhận được */
  public async getErrors(range: DbRange): Promise<DbErrorsDto> {
    const now = Date.now();
    const errors = await this.errorsSince(now - DB_RANGES[range] * MINUTE);
    const counts = Object.fromEntries(
      ERROR_KINDS.map((k) => [k, errors.filter((e) => e.kind === k).length]),
    ) as Record<DbErrorKind, number>;
    return {
      counts,
      items: errors.slice(0, ERROR_LIST_LIMIT).map((e) => this.errorDto(e)),
    };
  }

  /** Tổng quan cấu hình, độ trễ đồng bộ và thống kê định tuyến Primary / Read Replica. */
  public async getReplicationOverview(): Promise<DbReplicationOverviewDto> {
    const db = this.db;
    const configured = db.readReplicas.length > 0 || this.connection.hasReadReplica();
    const router = this.routing ?? getActiveDatabaseRouter();
    const snap = router.getSnapshot();
    const stored = this.store.isAvailable()
      ? await this.store.getReplicationStatus().catch(() => null)
      : null;

    const lagMs = stored?.lagMs ?? snap.lagMs;
    const pingMs = stored?.pingMs ?? null;
    const ioRunning = stored?.ioRunning ?? null;
    const sqlRunning = stored?.sqlRunning ?? null;
    const replicaAvailable = stored ? stored.available : snap.replicaAvailable;
    const lastError = snap.lastError ?? stored?.lastError ?? null;
    const lastCheckedAt = stored?.checkedAt ?? snap.lastCheckedAt;

    const status: DbReplicationOverviewDto['status'] = !configured
      ? 'disabled'
      : snap.circuitState === 'open'
        ? 'fallback_active'
        : !replicaAvailable
          ? 'unavailable'
          : lagMs !== null && lagMs >= db.replicationLagWarnMs
            ? 'lagging'
            : 'healthy';

    return {
      configured,
      status,
      primary: { host: db.host, port: db.port, database: db.database },
      replicas: db.readReplicas.map((r) => ({
        host: r.host,
        port: r.port,
        database: r.database,
      })),
      lagMs,
      pingMs,
      ioRunning,
      sqlRunning,
      replicaAvailable,
      circuitState: snap.circuitState,
      circuitOpenUntil: snap.circuitOpenUntil,
      lastError,
      lastCheckedAt,
      thresholds: {
        readAfterWriteWindowMs: db.readAfterWriteWindowMs,
        replicaFallbackCooldownMs: db.replicaFallbackCooldownMs,
        lagWarnMs: db.replicationLagWarnMs,
        lagCritMs: db.replicationLagCritMs,
        fallbackOnCriticalLag: db.fallbackOnCriticalLag,
      },
      routing: {
        totalReads: snap.totalReads,
        replicaReads: snap.replicaReads,
        primaryReads: snap.primaryReads,
        reportReplicaReads: snap.reportReplicaReads,
        readAfterWritePrimaryReads: snap.readAfterWritePrimaryReads,
        fallbackCount: snap.fallbackCount,
        lastFallbackAt: snap.lastFallbackAt,
      },
    };
  }

  /** Lấy thông tin cấu hình hoạt động của dịch vụ */
  public getConfig(): DbConfigDto {
    const db = this.db;
    return {
      items: [
        { key: 'driver', value: this.connection.driver },
        { key: 'host', value: db.host },
        { key: 'port', value: db.port },
        {
          key: 'readReplicas',
          value: db.readReplicas.length
            ? db.readReplicas.map((r) => `${r.host}:${r.port}`).join(', ')
            : null,
        },
        { key: 'readAfterWriteWindowMs', value: db.readAfterWriteWindowMs },
        { key: 'replicaFallbackCooldownMs', value: db.replicaFallbackCooldownMs },
        { key: 'replicationLagWarnMs', value: db.replicationLagWarnMs },
        { key: 'replicationLagCritMs', value: db.replicationLagCritMs },
        { key: 'fallbackOnCriticalLag', value: db.fallbackOnCriticalLag },
        { key: 'database', value: db.database },
        { key: 'username', value: db.username },
        { key: 'password', value: db.password !== '', sensitive: true },
        { key: 'poolMax', value: db.maxConnections },
        {
          key: 'poolMaxIdle',
          value:
            db.poolMaxIdle > 0 ? Math.min(db.poolMaxIdle, db.maxConnections) : db.maxConnections,
        },
        { key: 'poolIdleTimeoutMs', value: db.poolIdleTimeoutMs },
        { key: 'poolQueueLimit', value: db.poolQueueLimit || null },
        { key: 'synchronize', value: db.synchronize },
        { key: 'logging', value: db.logging },
        { key: 'autoLoadEntities', value: true },
        { key: 'ssl', value: db.ssl },
        { key: 'connectTimeoutMs', value: db.connectTimeoutMs },
        { key: 'queryTimeoutMs', value: db.queryTimeoutMs || null },
        { key: 'healthIntervalMs', value: db.healthIntervalMs },
        { key: 'slowQueryMs', value: db.slowQueryMs },
        { key: 'longTransactionSec', value: db.longTransactionSec },
        { key: 'transactionTimeoutMs', value: db.transactionTimeoutMs || null },
        { key: 'migrationStrict', value: db.migrationStrict },
        { key: 'storageLimitGb', value: db.storageLimitGb || null },
        { key: 'migrationsTable', value: db.migrationsTableName },
        { key: 'actionsEnabled', value: db.actionsEnabled },
        { key: 'migrationsEnabled', value: db.migrationsEnabled },
      ],
    };
  }

  /** Lấy danh sách các sự kiện ghi nhận từ mốc thời gian chỉ định */
  private async eventsSince(from: number): Promise<DbEventRecord[]> {
    return (await this.store.events().catch(() => [] as DbEventRecord[])).filter(
      (e) => e.at >= from,
    );
  }

  /** Lấy danh sách các lỗi ghi nhận từ mốc thời gian chỉ định */
  private async errorsSince(from: number): Promise<DbErrorRecord[]> {
    return (await this.store.errors().catch(() => [] as DbErrorRecord[])).filter(
      (e) => e.at >= from,
    );
  }

  /** Chuyển đổi dữ liệu sự kiện nội bộ sang đối tượng Event DTO */
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

  /** Chuyển đổi thông tin lỗi sang đối tượng Error DTO */
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

  /** Tạo đối tượng lỗi phản hồi theo phân vùng chức năng */
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

  /** Tạo đối tượng lỗi phản hồi cho thao tác vận hành thất bại */
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
  /** Khởi tạo hoặc xây dựng đối tượng dữ liệu hoàn chỉnh */
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
