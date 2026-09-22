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
} from '@packages/database/index.js';
import {
  TELEMETRY_TIERS,
  histogramPercentile,
  mergeMetric,
  emptyMetric,
} from '@packages/telemetry/index.js';
import {
  counterOf,
  gaugeOf,
  gaugeWindow,
  round,
  runtimeOfInstance,
} from '@modules/performance/index.js';
import {
  DatabaseMetricsService,
  type DbWindowStats,
  type MetricWindow,
} from './database-metrics.service.js';
import { DatabaseStoreService, type StorageSnapshot } from './database-store.service.js';
import { RULE_TAB, type DbRule } from './database-rules.js';
import { digestMetric } from './database-monitor.service.js';
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
  DbSeriesDto,
  DbStorageDto,
  DbTableDetailDto,
  DbTableRowDto,
  DbTablesDto,
  DbTransactionsDto,
  SectionDto,
} from '../responses/database-ops.response.js';

export const DB_RANGES: Record<DbRange, number> = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 };
export const DB_METRICS: DbMetric[] = [
  'queries',
  'latency',
  'connections',
  'errors',
  'transactions',
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_POINTS = 120;
const LIVE_QUERY_LIMIT = 8;
const LARGEST_TABLES = 5;
const OVERVIEW_EVENTS = 8;
const QUERY_STATS_LIMIT = 100;
const RELATED_SLOW_LIMIT = 20;
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
/** So khớp SQL do app chuẩn hoá với DIGEST_TEXT của DB (bỏ quote, khoảng trắng, hoa/thường). */
const fuzzySql = (sql: string) =>
  sql
    .toLowerCase()
    .replace(/[`"\s]/g, '')
    .replace(/\$\d+/g, '?');

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
    const len = DB_RANGES[range] * MINUTE;
    const today = startOfDay(now);
    const status = this.connection.getStatus();

    const [win, todayWin, yesterdayWin, snapshot, events, alerts, runtimes, storage] =
      await Promise.all([
        this.metrics.window(now - len, now, now),
        this.metrics.window(today, now, now),
        this.metrics.window(today - DAY, today, now),
        this.snapshot(),
        this.eventsSince(now - DAY),
        this.alerts(),
        this.runtimeConnections(now),
        this.store.storageSnapshots().catch(() => [] as StorageSnapshot[]),
      ]);
    const stats = this.metrics.stats(win);
    const pool = this.pool(win, this.metrics.stats(todayWin));
    const sessions = snapshot.sessions;
    const tx = snapshot.transactions.available ? snapshot.transactions.data : null;
    const deadlocks24h = (await this.errorsSince(now - DAY)).filter(
      (e) => e.kind === 'deadlock',
    ).length;
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
        p50Ms: stats.p50Ms,
        p95Ms: stats.p95Ms,
        p99Ms: stats.p99Ms,
        queriesPerSec: stats.queriesPerSec,
        errorRatePercent: stats.errorRatePercent,
        failedQueries: stats.failed,
        slowQueries: stats.slow,
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
        committedPerMin: win ? round(stats.committed / (win.seconds / 60), 2) : null,
        rolledBackPerMin: win ? round(stats.rolledBack / (win.seconds / 60), 2) : null,
      },
      largestTables: this.mapSection(snapshot.tables, (list) =>
        list
          .slice(0, LARGEST_TABLES)
          .map((t) => ({ ...t, growthPercent: this.growthPercent(t, storage, now) })),
      ),
      report: {
        today: this.report(this.metrics.stats(todayWin), storage, today, now),
        yesterday: this.report(this.metrics.stats(yesterdayWin), storage, today - DAY, today),
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

  private async runtimeConnections(now: number) {
    const instances = await this.metrics.liveInstances(now - MINUTE);
    const statuses = await this.store.connections(instances).catch(() => new Map());
    return [...statuses.entries()].map(([instance, s]) => ({
      instance,
      runtime: runtimeOfInstance(instance),
      state: s.state,
      lastPingMs: s.lastPingMs,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
    }));
  }

  private pool(win: MetricWindow | null, todayStats: DbWindowStats): DbPoolDto {
    const b = win?.buckets ?? [];
    const used = gaugeWindow(b, 'db.pool.used').current;
    const limit = gaugeWindow(b, 'db.pool.limit').current ?? this.db.maxConnections;
    return {
      used: used === null ? null : round(used, 1),
      idle: gaugeWindow(b, 'db.pool.idle').current,
      waiting: gaugeWindow(b, 'db.pool.waiting').current,
      limit,
      percent: used === null || !limit ? null : round((used / limit) * 100, 1),
      peakToday: todayStats.poolPeak,
    };
  }

  private report(
    stats: DbWindowStats,
    storage: StorageSnapshot[],
    from: number,
    to: number,
  ): DbReportDto {
    return {
      queries: stats.queries,
      avgMs: stats.avgMs,
      p95Ms: stats.p95Ms,
      slowQueries: stats.slow,
      failedQueries: stats.failed,
      peakConnections: stats.poolPeak,
      deadlocks: stats.deadlocks,
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

  public async getMetrics(range: DbRange, metric: DbMetric): Promise<DbMetricsDto> {
    const now = Date.now();
    const win = await this.metrics.window(now - DB_RANGES[range] * MINUTE, now, now);
    const tierSec = win ? TELEMETRY_TIERS[win.tier].seconds : 0;
    const buckets = win?.buckets ?? [];
    const size = Math.max(1, Math.ceil(buckets.length / MAX_POINTS));
    const groups: { t: number; b: typeof buckets; seconds: number }[] = [];
    for (let i = 0; i < buckets.length; i += size) {
      const b = buckets.slice(i, i + size);
      groups.push({
        t: b[0]!.start,
        b,
        seconds: Math.max(1, Math.min(b.length * tierSec, (now - b[0]!.start) / 1000)),
      });
    }
    const label = (id: string) => this.i18n.t(`database.series.${id}`);
    const series = (
      id: string,
      unit: string,
      value: (g: (typeof groups)[number]) => number | null,
    ): DbSeriesDto => ({
      id,
      label: label(id),
      unit,
      points: groups
        .map((g) => ({ t: g.t, value: value(g) }))
        .filter(
          (p): p is { t: number; value: number } => p.value !== null && Number.isFinite(p.value),
        )
        .map((p) => ({ t: p.t, value: round(p.value, 3) })),
    });
    const merged = (g: (typeof groups)[number]) => {
      const m = emptyMetric();
      for (const b of g.b) {
        const a = b.metrics.get('db.query');
        if (a) mergeMetric(m, a);
      }
      return m;
    };
    const gaugeAvg = (g: (typeof groups)[number], name: string) => {
      const values = g.b.map((b) => gaugeOf(b, name)).filter((v): v is number => v !== null);
      return values.length ? values.reduce((a, v) => a + v, 0) / values.length : null;
    };
    const perMin = (g: (typeof groups)[number], name: string) =>
      counterOf(g.b, name) / (g.seconds / 60);

    const byMetric: Record<DbMetric, () => DbSeriesDto[]> = {
      queries: () => [
        series('queriesPerSec', '/s', (g) => merged(g).n / g.seconds),
        series('slowPerMin', '/min', (g) => perMin(g, 'db.slow')),
      ],
      latency: () =>
        [95, 50, 99].map((p) =>
          series(`p${p}`, 'ms', (g) =>
            merged(g).hist ? histogramPercentile(merged(g).hist!, p) : null,
          ),
        ),
      connections: () => [
        series('poolUsed', '', (g) => gaugeAvg(g, 'db.pool.used')),
        series('sessions', '', (g) => gaugeAvg(g, 'db.sessions')),
        series('poolWaiting', '', (g) => gaugeAvg(g, 'db.pool.waiting')),
      ],
      errors: () => [
        series('failedPerMin', '/min', (g) => perMin(g, 'db.errors')),
        series('deadlocksPerMin', '/min', (g) => perMin(g, 'db.err.deadlock')),
        series('timeoutsPerMin', '/min', (g) => perMin(g, 'db.err.timeout')),
      ],
      transactions: () => [
        series('committedPerMin', '/min', (g) => perMin(g, 'db.tx.committed')),
        series('rolledBackPerMin', '/min', (g) => perMin(g, 'db.tx.rolledback')),
      ],
    };
    const list = byMetric[metric]().filter((s, i) => i === 0 || s.points.length > 0);
    return {
      metric,
      range,
      resolutionSec: win ? tierSec : null,
      unit: list[0]?.unit ?? '',
      series: list,
    };
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
    const [stats, win] = await Promise.all([
      this.section('digestStats', (ctx) =>
        this.monitoring.provider.digestStats(ctx, QUERY_STATS_LIMIT),
      ),
      this.metrics.window(from, now, now),
    ]);
    return {
      stats: this.mapSection(stats, (list) =>
        list
          .map((d) => this.withRange(d, win))
          .filter(
            (d) =>
              (d.lastSeen === null || Date.parse(d.lastSeen) >= from) &&
              (minMs <= 0 ||
                (d.avgMs ?? 0) >= minMs ||
                (d.maxMs ?? 0) >= minMs ||
                (d.rangeAvgMs ?? 0) >= minMs),
          ),
      ),
      minMs,
      range,
      note: 'cumulative',
    };
  }

  private withRange(d: DbDigestStat, win: MetricWindow | null): DbQueryStatDto {
    const calls = win ? counterOf(win.buckets, digestMetric(d.id, 'calls')) : 0;
    const ms = win ? counterOf(win.buckets, digestMetric(d.id, 'ms')) : 0;
    return {
      ...d,
      avgMs: d.avgMs === null ? null : round(d.avgMs, 2),
      totalMs: d.totalMs === null ? null : round(d.totalMs, 1),
      maxMs: d.maxMs === null ? null : round(d.maxMs, 2),
      rangeCalls: win && calls > 0 ? calls : null,
      rangeAvgMs: calls > 0 ? round(ms / calls, 2) : null,
      slow: this.digestSlow(d),
    };
  }

  private digestSlow(d: { avgMs: number | null }): boolean {
    return d.avgMs !== null && d.avgMs >= this.db.slowQueryMs;
  }

  public async getQueryDetail(digest: string, range: DbRange): Promise<DbQueryDetailDto> {
    const now = Date.now();
    const [stats, win, slow] = await Promise.all([
      this.section('digestStats', (ctx) =>
        this.monitoring.provider.digestStats(ctx, QUERY_STATS_LIMIT * 2),
      ),
      this.metrics.window(now - DB_RANGES[range] * MINUTE, now, now),
      this.store.slowQueries().catch(() => []),
    ]);
    if (!stats.available) throw this.sectionError(stats);
    const found = stats.data.find((d) => d.id === digest);
    if (!found) throw new DatabaseNotFoundException('database.error.queryNotFound', { id: digest });
    const stat = this.withRange(found, win);
    const tierSec = win ? TELEMETRY_TIERS[win.tier].seconds : 60;
    const history = (kind: 'calls' | 'ms'): DbSeriesDto['points'] =>
      (win?.buckets ?? []).map((b) => ({
        t: b.start,
        value: b.metrics.get(digestMetric(digest, kind))?.c ?? 0,
      }));
    const calls = history('calls');
    const ms = history('ms');
    const key = fuzzySql(found.sql);
    return {
      stat,
      history: {
        calls: {
          id: 'calls',
          label: this.i18n.t('database.series.callsPerMin'),
          unit: '/min',
          points: calls.map((p) => ({ t: p.t, value: round(p.value / (tierSec / 60), 2) })),
        },
        avgMs: {
          id: 'avgMs',
          label: this.i18n.t('database.series.avgMs'),
          unit: 'ms',
          points: calls
            .map((p, i) => ({
              t: p.t,
              value: p.value > 0 ? round((ms[i]?.value ?? 0) / p.value, 2) : 0,
            }))
            .filter((p, i) => (calls[i]?.value ?? 0) > 0),
        },
      },
      relatedSlow: slow
        .filter((s) => fuzzySql(s.sql) === key)
        .slice(0, RELATED_SLOW_LIMIT)
        .map((s) => ({
          at: s.at,
          durationMs: s.durationMs,
          correlationId: s.correlationId,
          instance: s.instance,
        })),
    };
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
    const [{ sessions, server }, win, todayWin] = await Promise.all([
      this.monitoring.batch(async (part) => ({
        sessions: await part('sessions', (ctx) => p.sessions(ctx)),
        server: await part('serverInfo', (ctx) => p.serverInfo(ctx)),
      })),
      this.metrics.window(now - 5 * MINUTE, now, now),
      this.metrics.window(startOfDay(now), now, now),
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
      pool: this.pool(win, this.metrics.stats(todayWin)),
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
    const [{ transactions, lockWaits }, win, errors] = await Promise.all([
      this.monitoring.batch(async (part) => ({
        transactions: await part('transactions', (ctx) => p.transactions(ctx)),
        lockWaits: await part('locks', (ctx) => p.lockWaits(ctx)),
      })),
      this.metrics.window(now - 15 * MINUTE, now, now),
      this.errorsSince(now - DAY),
    ]);
    const stats = this.metrics.stats(win);
    const minutes = (win?.seconds ?? 0) / 60;
    const deadlocks = errors.filter((e) => e.kind === 'deadlock');
    const tx = transactions.available ? transactions.data : null;
    return {
      transactions,
      stats: {
        active: tx ? tx.length : null,
        longestSec: tx && tx.length ? Math.max(...tx.map((t) => t.ageSec)) : null,
        committedPerMin: minutes > 0 ? round(stats.committed / minutes, 2) : null,
        rolledBackPerMin: minutes > 0 ? round(stats.rolledBack / minutes, 2) : null,
        avgDurationMs: stats.txAvgMs,
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
    const [errors, win] = await Promise.all([
      this.errorsSince(now - DB_RANGES[range] * MINUTE),
      this.metrics.window(now - DB_RANGES[range] * MINUTE, now, now),
    ]);
    const counts = Object.fromEntries(
      ERROR_KINDS.map((k) => [
        k,
        win ? counterOf(win.buckets, `db.err.${k}`) : errors.filter((e) => e.kind === k).length,
      ]),
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
