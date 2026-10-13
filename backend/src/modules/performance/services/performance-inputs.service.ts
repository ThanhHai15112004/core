import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { PrometheusQueryClient, round, type PromSample } from '@packages/metrics/index.js';
import { internalRouteRegex } from '@modules/traffic/index.js';
import type { RuleSnapshot } from './performance-rules.js';

const H = 'http_request_duration_seconds';
const MB = 1024 * 1024;
/** Baseline = chừng này phút liền trước cửa sổ hiện tại. */
export const BASELINE_MIN = 60;
const WAITING = 'sum(max by (queue) (core_queue_jobs{state="waiting"}))';

/** Số đo một cửa sổ cho KPI / component / throughput (null = không có số liệu). */
export interface WindowMetrics {
  api: {
    requests: number | null;
    rps: number | null;
    avgMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    errorRatePercent: number | null;
  };
  process: { cpuPercent: number | null; rssMb: number | null };
  db: {
    queries: number | null;
    qps: number | null;
    avgMs: number | null;
    errors: number | null;
    errorRatePercent: number | null;
    poolUsed: number | null;
    poolLimit: number | null;
    poolWaiting: number | null;
  };
  cache: { opsPerSec: number | null; hitRatePercent: number | null };
  worker: {
    jobsPerSec: number | null;
    completed: number | null;
    failed: number | null;
    avgMs: number | null;
    p95Ms: number | null;
    activeJobs: number | null;
  };
  messaging: {
    publishedPerSec: number | null;
    publishFailurePercent: number | null;
    waiting: number | null;
    delayed: number | null;
  };
}

/** Số đo theo runtime trong cửa sổ (nhãn `runtime` của prom-client). */
export interface RuntimeWindow {
  cpuAvg: number | null;
  cpuPeak: number | null;
  eventLoopPeakMs: number | null;
  gcPerMin: number | null;
  gcPauseMsPerMin: number | null;
  memoryTrend: { windowMin: number; changeMb: number; growing: boolean } | null;
}

/** Chuyển đổi mốc thời gian sang đơn vị mili-giây */
const ms = (sec: number | null) =>
  sec === null || !Number.isFinite(sec) ? null : round(sec * 1000, 1);
/** Thực hiện phép chia an toàn tránh lỗi chia cho số 0 */
const div = (a: number | null, b: number | null) =>
  a === null || b === null || b === 0 ? null : a / b;
/** Tính toán tỷ lệ phần trăm (0 - 100%) giữa hai giá trị */
const pct = (a: number | null, b: number | null) => {
  const v = div(a, b);
  return v === null ? null : round(v * 100, 2);
};
/** Làm tròn giá trị số đến 1 chữ số thập phân */
const r1 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : round(v, 1));

/**
 * Đầu vào của trang Performance đọc bằng PromQL: HTTP (`http_request_duration_seconds`), process mặc định của
 * prom-client (`process_*`, `nodejs_*` theo nhãn `runtime`), database (`core_db_*`), cache (`core_redis_*`), worker
 * (`messages_*_total`, `job_duration_seconds`) và độ sâu queue (`core_queue_jobs`). Không tự đo, không lưu.
 */
@Injectable()
export class PerformanceInputsService {
  constructor(
    private readonly prom: PrometheusQueryClient,
    private readonly config: CoreConfigService,
  ) {}

  public get configured(): boolean {
    return this.prom.configured;
  }

  /** Bộ lọc HTTP bỏ route nội bộ (System Console, health) — giống mặc định của trang HTTP Traffic. */
  private get httpSel(): string {
    return `{route!~"${internalRouteRegex(this.config.traffic.internalModules)}"}`;
  }

  /** Xác định dải thời gian truy vấn theo tham số yêu cầu */
  private range(seconds: number, offsetSec: number) {
    const w = `${Math.max(60, Math.round(seconds))}s`;
    const off = offsetSec > 0 ? ` offset ${Math.round(offsetSec)}s` : '';
    return { w, off, inc: (m: string) => `increase(${m}[${w}]${off})` };
  }

  /** Trích xuất giá trị số từ đối tượng đo lường */
  private v(expr: string): Promise<number | null> {
    return this.prom.value(expr);
  }

  /** Chuẩn hóa chuỗi truy vấn đầu vào */
  private q(expr: string): Promise<PromSample[]> {
    return this.prom.safeQuery(expr);
  }

  /** KPI, component, throughput của cửa sổ `seconds` kết thúc trước hiện tại `offsetSec` giây. */
  public async window(seconds: number, offsetSec = 0): Promise<WindowMetrics> {
    const { w, off, inc } = this.range(seconds, offsetSec);
    const sel = this.httpSel;
    const sel5xx = sel.replace('{', '{status=~"5..",');
    /** Làm tròn giá trị số theo độ chia nhỏ nhất (quantum) */
    const quant = (p: number) =>
      this.v(`histogram_quantile(${p}, sum by (le) (rate(${H}_bucket${sel}[${w}]${off})))`);
    const [
      requests,
      httpSec,
      errors5xx,
      p50,
      p95,
      p99,
      cpu,
      rss,
      dbQueries,
      dbSec,
      dbErrors,
      pool,
      cacheOps,
      hits,
      misses,
      consumed,
      jobSec,
      jobCount,
      jobP95,
      queueStates,
      published,
    ] = await Promise.all([
      this.v(`sum(${inc(`${H}_count${sel}`)})`),
      this.v(`sum(${inc(`${H}_sum${sel}`)})`),
      this.v(`sum(${inc(`${H}_count${sel5xx}`)})`),
      quant(0.5),
      quant(0.95),
      quant(0.99),
      this.v(`sum(rate(process_cpu_seconds_total[${w}]${off})) * 100`),
      this.v(`sum(avg_over_time(process_resident_memory_bytes[${w}]${off}))`),
      this.v(`sum(${inc('core_db_statements_total')})`),
      this.v(`sum(${inc('core_db_statement_seconds_total')})`),
      this.v(`sum(${inc('core_db_statement_errors_total')})`),
      this.q(`max by (state) (max_over_time(core_db_pool_connections[${w}]${off}))`),
      this.v(`max(avg_over_time(core_redis_ops_per_sec[${w}]${off}))`),
      this.v(`max(rate(core_redis_keyspace_hits[${w}]${off}))`),
      this.v(`max(rate(core_redis_keyspace_misses[${w}]${off}))`),
      this.q(`sum by (result) (${inc('messages_consumed_total')})`),
      this.v(`sum(${inc('job_duration_seconds_sum')})`),
      this.v(`sum(${inc('job_duration_seconds_count')})`),
      this.v(`histogram_quantile(0.95, sum by (le) (${inc('job_duration_seconds_bucket')}))`),
      this.q(`sum by (state) (max by (queue, state) (core_queue_jobs${off}))`),
      this.q(`sum by (result) (${inc('messages_published_total')})`),
    ]);
    /** Lấy thông tin trạng thái connection pool của dịch vụ */
    const poolOf = (state: string) => pool.find((x) => x.labels['state'] === state)?.value ?? null;
    /** Phân nhóm hoặc đếm số lượng kết quả theo trạng thái */
    const byResult = (list: PromSample[], result: string) =>
      list.length ? (list.find((x) => x.labels['result'] === result)?.value ?? 0) : null;
    /** Xác định trạng thái hoạt động dựa trên các chỉ số đo lường */
    const stateOf = (state: string) =>
      queueStates.length
        ? Math.round(queueStates.find((x) => x.labels['state'] === state)?.value ?? 0)
        : null;
    const completed = byResult(consumed, 'success');
    const failed = byResult(consumed, 'failed');
    const jobs = completed === null || failed === null ? null : completed + failed;
    const pubOk = byResult(published, 'success');
    const pubFailed = byResult(published, 'failed');
    return {
      api: {
        requests: requests === null ? null : Math.round(requests),
        rps: requests === null ? null : round(requests / seconds, 3),
        avgMs: ms(div(httpSec, requests)),
        p50Ms: ms(p50),
        p95Ms: ms(p95),
        p99Ms: ms(p99),
        errorRatePercent: requests === null ? null : (pct(errors5xx ?? 0, requests) ?? 0),
      },
      process: { cpuPercent: r1(cpu), rssMb: rss === null ? null : Math.round(rss / MB) },
      db: {
        queries: dbQueries === null ? null : Math.round(dbQueries),
        qps: dbQueries === null ? null : round(dbQueries / seconds, 3),
        avgMs: ms(div(dbSec, dbQueries)),
        errors: dbErrors === null ? null : Math.round(dbErrors),
        errorRatePercent: pct(dbErrors, dbQueries),
        poolUsed: poolOf('used'),
        poolLimit: poolOf('limit'),
        poolWaiting: poolOf('waiting'),
      },
      cache: {
        opsPerSec: r1(cacheOps),
        hitRatePercent: hits === null || misses === null ? null : pct(hits, hits + misses),
      },
      worker: {
        jobsPerSec: jobs === null ? null : round(jobs / seconds, 3),
        completed: completed === null ? null : Math.round(completed),
        failed: failed === null ? null : Math.round(failed),
        avgMs: ms(div(jobSec, jobCount)),
        p95Ms: ms(jobP95),
        activeJobs: stateOf('active'),
      },
      messaging: {
        publishedPerSec: pubOk === null ? null : round(pubOk / seconds, 3),
        publishFailurePercent:
          pubOk === null || pubFailed === null ? null : pct(pubFailed, pubOk + pubFailed),
        waiting: stateOf('waiting'),
        delayed: stateOf('delayed'),
      },
    };
  }

  /** Số đo theo runtime trong cửa sổ hiện tại `seconds`. */
  public async runtimes(seconds: number): Promise<Map<string, RuntimeWindow>> {
    const w = `${Math.max(60, Math.round(seconds))}s`;
    const step = `${Math.max(15, Math.round(seconds / 60))}s`;
    const growthMin = this.config.performance.rules.memoryGrowthWindowMin;
    const cpu1m = 'sum by (runtime) (rate(process_cpu_seconds_total[1m]))';
    const [cpuAvg, cpuPeak, loopPeak, gcCount, gcSec, memDelta, memRising] = await Promise.all([
      this.q(`sum by (runtime) (rate(process_cpu_seconds_total[${w}])) * 100`),
      this.q(`max_over_time((${cpu1m})[${w}:${step}]) * 100`),
      this.q(`max by (runtime) (max_over_time(nodejs_eventloop_lag_p99_seconds[${w}])) * 1000`),
      this.q(`sum by (runtime) (rate(nodejs_gc_duration_seconds_count[${w}])) * 60`),
      this.q(`sum by (runtime) (rate(nodejs_gc_duration_seconds_sum[${w}])) * 60000`),
      this.q(`sum by (runtime) (delta(process_resident_memory_bytes[${growthMin}m])) / ${MB}`),
      this.q(
        `avg_over_time((sum by (runtime) (deriv(process_resident_memory_bytes[5m])) > bool 0)[${growthMin}m:1m])`,
      ),
    ]);
    const out = new Map<string, RuntimeWindow>();
    /** Khởi tạo đối tượng từ giá trị đầu vào */
    const of = (id: string) => {
      let r = out.get(id);
      if (!r)
        out.set(
          id,
          (r = {
            cpuAvg: null,
            cpuPeak: null,
            eventLoopPeakMs: null,
            gcPerMin: null,
            gcPauseMsPerMin: null,
            memoryTrend: null,
          }),
        );
      return r;
    };
    /** Lưu trữ một giá trị theo khóa định danh */
    const set = (list: PromSample[], key: keyof Omit<RuntimeWindow, 'memoryTrend'>) => {
      for (const x of list) if (x.labels['runtime']) of(x.labels['runtime'])[key] = r1(x.value);
    };
    set(cpuAvg, 'cpuAvg');
    set(cpuPeak, 'cpuPeak');
    set(loopPeak, 'eventLoopPeakMs');
    set(gcCount, 'gcPerMin');
    set(gcSec, 'gcPauseMsPerMin');
    for (const x of memDelta) {
      const id = x.labels['runtime'];
      if (!id) continue;
      const rising = memRising.find((m) => m.labels['runtime'] === id)?.value ?? 0;
      of(id).memoryTrend = {
        windowMin: growthMin,
        changeMb: round(x.value, 1),
        growing: x.value > 0 && rising >= 0.8,
      };
    }
    return out;
  }

  /** Đầu vào rule engine: cửa sổ `seconds` gần nhất so với `BASELINE_MIN` phút liền trước. */
  public async ruleSnapshot(
    seconds: number,
    memoryPercent: ReadonlyMap<string, number | null>,
  ): Promise<RuleSnapshot> {
    const rules = this.config.performance.rules;
    const base = this.range(BASELINE_MIN * 60, seconds);
    const cur = this.range(seconds, 0);
    const growthMin = rules.memoryGrowthWindowMin;
    const cpu1m = 'sum by (runtime) (rate(process_cpu_seconds_total[1m]))';
    const [now, baseline, runtimeRows] = await Promise.all([
      this.window(seconds),
      this.window(BASELINE_MIN * 60, seconds),
      Promise.all([
        this.q(`min_over_time((${cpu1m})[${rules.cpuSustainMin}m:30s]) * 100`),
        this.q(`sum by (runtime) (rate(process_cpu_seconds_total[${cur.w}])) * 100`),
        this.q(`sum by (runtime) (rate(process_cpu_seconds_total[${base.w}]${base.off})) * 100`),
        this.q(`max by (runtime) (nodejs_eventloop_lag_p99_seconds) * 1000`),
        this.q(
          `max by (runtime) (avg_over_time(nodejs_eventloop_lag_p99_seconds[${base.w}]${base.off})) * 1000`,
        ),
        this.q(`sum by (runtime) (rate(nodejs_gc_duration_seconds_sum[${cur.w}])) * 60000`),
        this.q(
          `sum by (runtime) (rate(nodejs_gc_duration_seconds_sum[${base.w}]${base.off})) * 60000`,
        ),
        this.q(`sum by (runtime) (delta(process_resident_memory_bytes[${growthMin}m])) / ${MB}`),
        this.q(
          `avg_over_time((sum by (runtime) (deriv(process_resident_memory_bytes[5m])) > bool 0)[${growthMin}m:1m])`,
        ),
        this.q(
          `count_over_time((sum by (runtime) (process_resident_memory_bytes))[${growthMin}m:1m])`,
        ),
        this.v(`avg_over_time(${WAITING}[${base.w}:1m]${base.off})`),
        this.v(WAITING),
      ]),
    ]);
    const [
      cpuSustained,
      cpuAvg,
      cpuBase,
      loop,
      loopBase,
      gc,
      gcBase,
      memDelta,
      memRising,
      memPoints,
      queueBase,
      queueNow,
    ] = runtimeRows;
    const lists = [cpuSustained, cpuAvg, loop, gc, memDelta] as PromSample[][];
    const ids = new Set<string>([
      ...lists.flatMap((l) => l.map((x) => x.labels['runtime'] ?? '')).filter(Boolean),
      ...memoryPercent.keys(),
    ]);
    /** Trích xuất giá trị dữ liệu từ đối tượng hoặc chuỗi */
    const val = (list: PromSample[], id: string) =>
      r1(list.find((x) => x.labels['runtime'] === id)?.value ?? null);
    /** Tính tỷ lệ phần trăm các tác vụ bị thất bại */
    const failedPct = (w: WindowMetrics) => {
      const done = (w.worker.completed ?? 0) + (w.worker.failed ?? 0);
      return done > 0 ? ((w.worker.failed ?? 0) / done) * 100 : null;
    };
    return {
      api: {
        requests: now.api.requests ?? 0,
        p95: now.api.p95Ms,
        p99: now.api.p99Ms,
        errorRate: now.api.errorRatePercent ?? 0,
        baselineP95: baseline.api.p95Ms,
        baselineP99: baseline.api.p99Ms,
        baselineErrorRate: baseline.api.requests ? baseline.api.errorRatePercent : null,
      },
      runtimes: [...ids].map((id) => {
        const delta = val(memDelta, id);
        const points = val(memPoints, id);
        return {
          id,
          cpuSustained: val(cpuSustained, id),
          cpuAvg: val(cpuAvg, id),
          cpuBaseline: val(cpuBase, id),
          memoryPercent: memoryPercent.get(id) ?? null,
          memoryBaseline: null,
          eventLoopP99: val(loop, id),
          eventLoopBaseline: val(loopBase, id),
          gcPauseMsPerMin: val(gc, id),
          gcBaseline: val(gcBase, id),
          memoryTrend:
            delta === null || points === null
              ? null
              : {
                  changeMb: delta,
                  increasingRatio: val(memRising, id) ?? 0,
                  spanMin: points,
                },
        };
      }),
      db: {
        queries: now.db.queries ?? 0,
        avgMs: now.db.avgMs,
        baselineAvgMs: baseline.db.avgMs,
        poolPercent: pct(now.db.poolUsed, now.db.poolLimit),
      },
      queue: { waiting: queueNow, baseline: queueBase },
      worker: {
        completed: now.worker.completed ?? 0,
        failed: now.worker.failed ?? 0,
        baselineFailedPercent: failedPct(baseline),
      },
    };
  }
}
