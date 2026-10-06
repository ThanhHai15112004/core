import { Injectable } from '@nestjs/common';
import type { Counter, Gauge } from 'prom-client';
import type { PoolStats } from '@packages/database/index.js';
import { MetricsRegistryService, PrometheusQueryClient } from '@packages/metrics/index.js';
import { round } from '@modules/performance/index.js';

/**
 * Số đo database trong một khoảng, đọc lại từ Prometheus. Nguồn: delta bộ đếm digest của chính database
 * (`performance_schema` / `pg_stat_statements`) và pool TypeORM — `null` khi chưa có dữ liệu, không trả 0 giả.
 */
export interface DbWindowStats {
  queries: number | null;
  queriesPerSec: number | null;
  avgMs: number | null;
  failed: number | null;
  errorRatePercent: number | null;
  poolPeak: number | null;
}

export interface DbSeriesDef {
  id: string;
  unit: string;
  /** PromQL; `$w` được thay bằng cửa sổ rate theo độ phân giải. */
  expr: string;
}

/** Tên metric Prometheus của database (monitor trong API ghi mỗi chu kỳ). */
export const DB_PROM = {
  statements: 'core_db_statements_total',
  seconds: 'core_db_statement_seconds_total',
  errors: 'core_db_statement_errors_total',
  pool: 'core_db_pool_connections',
  sessions: 'core_db_sessions',
} as const;

const MAX_POINTS = 120;

@Injectable()
export class DatabaseMetricsService {
  private readonly statements: Counter;
  private readonly seconds: Counter;
  private readonly errors: Counter;
  private readonly pool: Gauge<'state'>;
  private readonly sessions: Gauge;

  constructor(
    registry: MetricsRegistryService,
    private readonly prom: PrometheusQueryClient,
  ) {
    this.statements = registry.counter(
      DB_PROM.statements,
      'Statements executed (delta of database digest counters)',
    );
    this.seconds = registry.counter(
      DB_PROM.seconds,
      'Statement execution time in seconds (delta of database digest counters)',
    );
    this.errors = registry.counter(DB_PROM.errors, 'Statements that returned an error');
    this.pool = registry.gauge(DB_PROM.pool, 'TypeORM pool connections of the API runtime', [
      'state',
    ]);
    this.sessions = registry.gauge(DB_PROM.sessions, 'Database sessions (excluding the monitor)');
  }

  /** Cộng delta digest của một chu kỳ (`ms` null khi bộ đếm thời gian của DB không tin được). */
  public recordStatements(calls: number, ms: number | null, errors: number): void {
    if (calls > 0) this.statements.inc(calls);
    if (ms !== null && ms > 0) this.seconds.inc(ms / 1000);
    if (errors > 0) this.errors.inc(errors);
  }

  public recordPool(stats: PoolStats | null, limit: number): void {
    if (!stats) return;
    this.pool.set({ state: 'used' }, stats.used);
    this.pool.set({ state: 'idle' }, stats.idle);
    this.pool.set({ state: 'waiting' }, stats.waiting);
    this.pool.set({ state: 'limit' }, limit);
  }

  public recordSessions(count: number): void {
    this.sessions.set(count);
  }

  /** Thống kê `minutes` phút, kết thúc trước hiện tại `offsetMin` phút. */
  public async stats(minutes: number, offsetMin = 0): Promise<DbWindowStats> {
    const w = `${Math.max(1, Math.round(minutes))}m`;
    const off = offsetMin > 0 ? ` offset ${Math.round(offsetMin)}m` : '';
    const v = (expr: string) => this.prom.value(expr);
    const [queries, seconds, failed, poolPeak] = await Promise.all([
      v(`sum(increase(${DB_PROM.statements}[${w}]${off}))`),
      v(`sum(increase(${DB_PROM.seconds}[${w}]${off}))`),
      v(`sum(increase(${DB_PROM.errors}[${w}]${off}))`),
      v(`max(max_over_time(${DB_PROM.pool}{state="used"}[${w}]${off}))`),
    ]);
    const q = queries === null ? null : Math.round(queries);
    return {
      queries: q,
      queriesPerSec: q === null ? null : round(q / (minutes * 60), 3),
      avgMs: q && seconds !== null ? round((seconds * 1000) / q, 2) : null,
      failed: failed === null ? null : Math.round(failed),
      errorRatePercent: q && failed !== null ? round((failed / q) * 100, 2) : null,
      poolPeak: poolPeak === null ? null : Math.round(poolPeak),
    };
  }

  /** Chuỗi thời gian `minutes` phút gần nhất; `resolutionSec` null khi không có điểm nào. */
  public async series(
    minutes: number,
    defs: DbSeriesDef[],
  ): Promise<{
    resolutionSec: number | null;
    series: (DbSeriesDef & { points: { t: number; value: number }[] })[];
  }> {
    const stepSec = Math.max(30, Math.ceil((minutes * 60) / MAX_POINTS));
    const rateWindow = `${Math.max(120, stepSec * 2)}s`;
    const series = await Promise.all(
      defs.map(async (d) => {
        const res = await this.prom.safeRange(
          d.expr.replaceAll('$w', rateWindow),
          minutes,
          stepSec,
        );
        return {
          ...d,
          points: (res[0]?.points ?? []).map((p) => ({ t: p.t, value: round(p.v, 3) })),
        };
      }),
    );
    return { resolutionSec: series.some((s) => s.points.length > 0) ? stepSec : null, series };
  }
}
