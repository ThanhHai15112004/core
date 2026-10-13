import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { DatabaseConnectionService } from '@packages/database/index.js';
import {
  PrometheusQueryClient,
  PrometheusUnavailableError,
  changePercent,
  round,
} from '@packages/metrics/index.js';
import { RuntimesService, type RuntimeSummaryDto } from '@modules/runtimes/index.js';
import { TRAFFIC_RANGES, TrafficService, internalRouteRegex } from '@modules/traffic/index.js';
import {
  PerformanceComponentNotFoundException,
  PerformanceTelemetryUnavailableException,
} from '../exceptions/performance.exceptions.js';
import type {
  BaselineMode,
  BottleneckDto,
  BottleneckResponseDto,
  BudgetDto,
  CapacityDto,
  ComponentDetailDto,
  ComponentId,
  ComponentMetricDto,
  ComponentRowDto,
  ComponentStatus,
  KpiDto,
  PerfEventDto,
  PerfMarkerDto,
  PerfRange,
  PerfSeriesDto,
  PerfTimeseriesDto,
  PerformanceOverviewDto,
  RuntimeResourceDto,
  TimeseriesMetric,
} from '../responses/performance.response.js';
import { PerformanceEventsService } from './performance-events.service.js';
import { PerformanceInputsService, type WindowMetrics } from './performance-inputs.service.js';
import { evaluateRules, overallLevel, type Violation } from './performance-rules.js';

export const PERF_RANGES: Record<PerfRange, number> = TRAFFIC_RANGES;
export const TIMESERIES_METRICS: TimeseriesMetric[] = [
  'latency',
  'throughput',
  'errors',
  'cpu',
  'memory',
  'eventLoop',
  'gc',
  'dbLatency',
  'queueDepth',
];
export const BASELINE_MODES: BaselineMode[] = ['previous', 'yesterday', 'lastWeek'];
export const COMPONENT_IDS: ComponentId[] = ['api', 'database', 'cache', 'worker', 'messaging'];

/** Điểm nghẽn = trạng thái hiện tại: đánh giá trên 5 phút gần nhất. */
const RULE_WINDOW_SEC = 5 * 60;
const MAX_POINTS = 60;
const IMPACT_ENDPOINTS = 3;
const H = 'http_request_duration_seconds';

const COMPONENT_TARGET: Record<ComponentId, string> = {
  api: 'http-traffic',
  database: 'database',
  cache: 'cache',
  worker: 'workers',
  messaging: 'messaging',
};

/** Section để drill-down theo rule. */
function targetOf(v: Violation): string {
  if (v.rule === 'API_ERROR_RATE') return 'http-traffic/endpoints?sort=errors';
  if (v.rule.startsWith('API_')) return 'http-traffic/endpoints?sort=p95';
  if (v.rule.startsWith('DB_')) return 'database';
  if (v.rule === 'QUEUE_BACKLOG' || v.rule === 'WORKER_FAILURES') return 'workers';
  return v.runtime ? `runtimes/${v.runtime}` : 'runtimes';
}

/** Tính toán các chỉ số đánh giá hiệu quả vận hành then chốt */
const kpi = (value: number | null, previous: number | null): KpiDto => ({
  value,
  changePercent: changePercent(value, previous),
});
/** `runtime` chỉ dùng nội bộ — không trả cho console. */
const toResponse = ({ runtime: _runtime, ...rest }: BottleneckDto): BottleneckResponseDto => rest;
/** Tìm giá trị lớn nhất trong tập hợp các số liệu */
const max = (values: (number | null)[]) => {
  const list = values.filter((v): v is number => v !== null);
  return list.length ? Math.max(...list) : null;
};

/**
 * Performance — hiệu năng toàn hệ thống từ Prometheus (HTTP, process theo runtime, database, cache, worker/queue)
 * và heartbeat runtime (RAM so với giới hạn cgroup). Điểm nghẽn theo rule `PERF_*`; không có số liệu giả.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly prom: PrometheusQueryClient,
    private readonly inputs: PerformanceInputsService,
    private readonly events: PerformanceEventsService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
    private readonly runtimes: RuntimesService,
    private readonly traffic: TrafficService,
    private readonly database: DatabaseConnectionService,
  ) {}

  public get telemetryConfigured(): boolean {
    return this.prom.configured;
  }

  private get rules() {
    return this.config.performance.rules;
  }

  /** Prometheus không cấu hình/không trả lời → 503, thay vì KPI rỗng trông như hệ thống nhàn rỗi. */
  private async must(): Promise<void> {
    if (!this.prom.configured) throw new PerformanceTelemetryUnavailableException();
    try {
      await this.prom.query('vector(1)');
    } catch (err) {
      if (err instanceof PrometheusUnavailableError)
        throw new PerformanceTelemetryUnavailableException();
      throw err;
    }
  }

  /** Tổng hợp thông tin hiệu năng của các thành phần hệ thống */
  private summaries(): Promise<RuntimeSummaryDto[]> {
    return this.runtimes.getSummaries().catch(() => [] as RuntimeSummaryDto[]);
  }

  // ─── Rule / điểm nghẽn ────────────────────────────────────────────────────

  /** Vi phạm hiện tại; `null` khi không có Prometheus (không kết luận). */
  public async evaluate(summaries?: RuntimeSummaryDto[]): Promise<Violation[] | null> {
    if (!this.prom.configured) return null;
    const list = summaries ?? (await this.summaries());
    const memory = new Map(list.map((r) => [r.id, r.resources?.memoryPercent ?? null]));
    try {
      const snapshot = await this.inputs.ruleSnapshot(RULE_WINDOW_SEC, memory);
      return evaluateRules(snapshot, this.rules);
    } catch {
      return null;
    }
  }

  /** Xác định các điểm nghẽn hiệu năng trong hệ thống */
  private async bottlenecks(violations: Violation[]): Promise<BottleneckDto[]> {
    if (!violations.length) return [];
    const [active, endpoints, summaries] = await Promise.all([
      this.events.active(),
      violations.some((v) => v.rule.startsWith('API_'))
        ? this.traffic.getEndpoints({ range: '5m', includeInternal: false }, 'p95').catch(() => [])
        : Promise.resolve([]),
      this.summaries(),
    ]);
    /** Lấy tên định danh hiển thị của thành phần hoặc package */
    const nameOf = (id: string | null) =>
      id ? (summaries.find((s) => s.id === id)?.name ?? id) : '';
    const none = this.i18n.t('performance.none');
    return violations.map((v) => {
      const params = {
        value: v.value,
        threshold: v.threshold,
        unit: v.unit,
        baseline: v.baseline ?? none,
        runtime: nameOf(v.runtime),
      };
      const since = active.get(v.id)?.since;
      return {
        ...v,
        title: this.i18n.t(`performance.rule.${v.rule}.title`, params),
        message: this.i18n.t(`performance.rule.${v.rule}.message`, params),
        since: since ? new Date(since).toISOString() : null,
        impact: v.rule.startsWith('API_')
          ? endpoints
              .filter((e) => e.stats.p95LatencyMs !== null)
              .slice(0, IMPACT_ENDPOINTS)
              .map((e) => ({
                routeId: e.id,
                method: e.method,
                route: e.route,
                valueMs: e.stats.p95LatencyMs!,
              }))
          : [],
        target: targetOf(v),
      };
    });
  }

  /** Truy vấn danh sách các điểm nghẽn hiệu năng đã phát hiện */
  public async getBottlenecks(): Promise<BottleneckDto[]> {
    return this.bottlenecks((await this.evaluate()) ?? []);
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  private componentStatus(
    id: ComponentId,
    load: number | null,
    violations: Violation[],
  ): { status: ComponentStatus; note: string | null } {
    const own = violations.filter((v) => v.component === id);
    if (own.some((v) => v.severity === 'critical')) return { status: 'critical', note: null };
    if (own.length) return { status: 'degraded', note: null };
    if (load === null)
      return { status: 'unavailable', note: this.i18n.t('performance.component.notMeasured') };
    if (load === 0) return { status: 'idle', note: this.i18n.t('performance.component.noLoad') };
    return { status: 'normal', note: null };
  }

  /** Lấy danh sách các thành phần đang được giám sát hiệu năng */
  private components(m: WindowMetrics, violations: Violation[]): ComponentRowDto[] {
    /** Chuyển đổi bản ghi dữ liệu thành hàng hiển thị trên bảng */
    const row = (
      id: ComponentId,
      load: number | null,
      loadUnit: string,
      latencyMs: number | null,
      latencyKind: 'p95' | 'avg',
      errorPercent: number | null,
      note?: string | null,
    ): ComponentRowDto => {
      const s = this.componentStatus(id, load, violations);
      return {
        id,
        status: s.status,
        note: s.note ?? note ?? null,
        load,
        loadUnit,
        latencyMs,
        latencyKind,
        errorPercent,
      };
    };
    const dbDown = this.database.getStatus().state !== 'connected';
    return [
      row('api', m.api.rps, 'rps', m.api.p95Ms, 'p95', m.api.errorRatePercent),
      dbDown
        ? {
            id: 'database',
            status: 'unavailable',
            note: this.i18n.t('performance.component.database.noDataSource'),
            load: null,
            loadUnit: 'qps',
            latencyMs: null,
            latencyKind: 'avg',
            errorPercent: null,
          }
        : row('database', m.db.qps, 'qps', m.db.avgMs, 'avg', m.db.errorRatePercent),
      row(
        'cache',
        m.cache.opsPerSec,
        'ops/s',
        null,
        'avg',
        null,
        m.cache.hitRatePercent === null
          ? null
          : this.i18n.t('performance.component.cache.hitRate', { rate: m.cache.hitRatePercent }),
      ),
      row(
        'worker',
        m.worker.jobsPerSec,
        'jobs/s',
        m.worker.avgMs,
        'avg',
        m.worker.completed === null
          ? null
          : (() => {
              const done = (m.worker.completed ?? 0) + (m.worker.failed ?? 0);
              return done > 0 ? round(((m.worker.failed ?? 0) / done) * 100, 2) : 0;
            })(),
      ),
      row(
        'messaging',
        m.messaging.publishedPerSec,
        'msg/s',
        null,
        'avg',
        m.messaging.publishFailurePercent,
        m.messaging.waiting
          ? this.i18n.t('performance.component.messaging.waiting', { count: m.messaging.waiting })
          : null,
      ),
    ];
  }

  /** Lấy thông tin mức độ sử dụng tài nguyên (CPU, RAM, Event Loop) */
  private resources(
    summaries: RuntimeSummaryDto[],
    perRuntime: Awaited<ReturnType<PerformanceInputsService['runtimes']>>,
  ): RuntimeResourceDto[] {
    return summaries.map((s) => {
      const r = s.resources;
      const w = perRuntime.get(s.id);
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        instances: r ? 1 : 0,
        cpuPercent: r?.cpuPercent ?? null,
        cpuAvgPercent: w?.cpuAvg ?? null,
        cpuPeakPercent: w?.cpuPeak ?? null,
        rssMb: r?.rssMb ?? null,
        heapUsedMb: r?.heapUsedMb ?? null,
        externalMb: r?.externalMb ?? null,
        memoryLimitMb: r?.memoryLimitMb ?? null,
        memoryLimitSource: r?.memoryLimitSource ?? null,
        memoryPercent: r?.memoryPercent ?? null,
        eventLoopP99Ms: r?.eventLoopP99Ms ?? null,
        eventLoopPeakMs: w?.eventLoopPeakMs ?? null,
        gcPerMin: w?.gcPerMin ?? null,
        gcPauseMsPerMin: w?.gcPauseMsPerMin ?? null,
        gcMaxPauseMs: r?.gcMaxPauseMs ?? null,
        memoryTrend: w?.memoryTrend ?? null,
      };
    });
  }

  /** Lấy dữ liệu tổng quan trạng thái hệ thống */
  public async getOverview(range: PerfRange): Promise<PerformanceOverviewDto> {
    await this.must();
    const minutes = PERF_RANGES[range];
    const seconds = minutes * 60;
    const summaries = await this.summaries();
    const [cur, prev, perRuntime, violations] = await Promise.all([
      this.inputs.window(seconds),
      this.inputs.window(seconds, seconds),
      this.inputs.runtimes(seconds),
      this.evaluate(summaries),
    ]);
    const bottlenecks = await this.bottlenecks(violations ?? []);
    const resources = this.resources(summaries, perRuntime);
    const budgetsCfg = this.config.performance.budgets;
    const maxCpu = max(resources.map((r) => r.cpuPercent));
    const maxMemPct = max(resources.map((r) => r.memoryPercent));
    const memRuntime = resources.find(
      (r) => r.memoryPercent !== null && r.memoryPercent === maxMemPct,
    );
    const cpuRuntime = resources.find((r) => r.cpuPercent !== null && r.cpuPercent === maxCpu);
    // Tổng RSS so với tổng giới hạn container — chỉ khi mọi runtime đang chạy đều có giới hạn cgroup
    // (giới hạn heap V8 không so được với RSS).
    const running = resources.filter((r) => r.rssMb !== null);
    const limitMb =
      running.length && running.every((r) => r.memoryLimitSource === 'cgroup')
        ? Math.round(running.reduce((a, r) => a + (r.memoryLimitMb ?? 0), 0))
        : null;
    /** Kiểm tra mức độ tiêu thụ tài nguyên so với ngưỡng định mức cho phép */
    const budget = (key: BudgetDto['key'], current: number | null, unit: string): BudgetDto => ({
      key,
      target: budgetsCfg[key],
      current,
      unit,
      met: current === null ? null : current <= budgetsCfg[key],
    });
    const dbLimit = cur.db.poolLimit;
    const concurrency = this.config.runtime.worker.concurrency;
    const workerUp = summaries.some((s) => s.id === 'worker' && s.resources !== null);
    const capacity: CapacityDto[] = [
      {
        key: 'cpu',
        used: maxCpu,
        limit: 100,
        percent: maxCpu,
        unit: '%',
        runtime: cpuRuntime?.id ?? null,
      },
      {
        key: 'memory',
        // Cùng loại với giới hạn: RSS / cgroup, hoặc heap / giới hạn heap V8.
        used: memRuntime
          ? memRuntime.memoryLimitSource === 'cgroup'
            ? memRuntime.rssMb
            : memRuntime.heapUsedMb
          : null,
        limit: memRuntime?.memoryLimitMb ?? null,
        percent: maxMemPct,
        unit: 'MB',
        runtime: memRuntime?.id ?? null,
      },
      {
        key: 'dbPool',
        used: cur.db.poolUsed,
        limit: dbLimit,
        percent:
          cur.db.poolUsed !== null && dbLimit ? round((cur.db.poolUsed / dbLimit) * 100, 1) : null,
        unit: 'conn',
        runtime: 'api',
      },
      {
        key: 'workerConcurrency',
        used: workerUp ? cur.worker.activeJobs : null,
        limit: workerUp ? concurrency : null,
        percent:
          workerUp && cur.worker.activeJobs !== null
            ? round((cur.worker.activeJobs / concurrency) * 100, 1)
            : null,
        unit: 'jobs',
        runtime: 'worker',
      },
    ];
    const v = violations ?? [];
    return {
      range,
      telemetry: {
        database: this.database.getStatus().state === 'connected' ? 'active' : 'unavailable',
      },
      status: {
        level: violations === null ? 'unknown' : overallLevel(v),
        reasons: bottlenecks.map((b) => b.title),
      },
      kpis: {
        apiP95Ms: kpi(cur.api.p95Ms, prev.api.p95Ms),
        throughputPerSec: kpi(cur.api.rps, prev.api.rps),
        cpuPercent: kpi(cur.process.cpuPercent, prev.process.cpuPercent),
        memoryMb: {
          ...kpi(cur.process.rssMb, prev.process.rssMb),
          percent:
            limitMb && cur.process.rssMb !== null
              ? round((cur.process.rssMb / limitMb) * 100, 1)
              : null,
          limitMb,
        },
        errorRatePercent: kpi(cur.api.errorRatePercent, prev.api.errorRatePercent),
        bottlenecks: {
          count: bottlenecks.length,
          components: [...new Set(bottlenecks.map((b) => b.runtime ?? b.component))],
        },
      },
      resources,
      bottlenecks: bottlenecks.map(toResponse),
      components: this.components(cur, v),
      // Prometheus chỉ có tổng thời gian request, không có từng giai đoạn → không chia ước lượng.
      breakdown: {
        requests: cur.api.requests ?? 0,
        avgTotalMs: cur.api.avgMs,
      },
      budgets: [
        budget('apiP95Ms', cur.api.p95Ms, 'ms'),
        budget('apiP99Ms', cur.api.p99Ms, 'ms'),
        budget('errorRatePercent', cur.api.errorRatePercent, '%'),
        budget('cpuPercent', maxCpu, '%'),
        budget('memoryPercent', maxMemPct, '%'),
      ],
      capacity,
      throughput: {
        httpPerSec: cur.api.rps,
        dbQueriesPerSec: cur.db.qps,
        cacheOpsPerSec: cur.cache.opsPerSec,
        jobsPerMin: cur.worker.jobsPerSec === null ? null : round(cur.worker.jobsPerSec * 60, 1),
        messagesPerMin:
          cur.messaging.publishedPerSec === null
            ? null
            : round(cur.messaging.publishedPerSec * 60, 1),
        queueWaiting: cur.messaging.waiting,
      },
      settings: {
        evaluateSec: Math.round(this.config.performance.evaluateMs / 1000),
        windowMin: minutes,
        thresholds: {
          cpuPercent: this.rules.cpuPercent.warn,
          memoryPercent: this.rules.memoryPercent.warn,
        },
      },
    };
  }

  // ─── Timeseries ───────────────────────────────────────────────────────────

  private metricExpr(m: TimeseriesMetric): { expr: string; unit: string } {
    const sel = `{route!~"${internalRouteRegex(this.config.traffic.internalModules)}"}`;
    const sel5xx = sel.replace('{', '{status=~"5..",');
    switch (m) {
      case 'latency':
        return {
          expr: `histogram_quantile(0.95, sum by (le) (rate(${H}_bucket${sel}[$w]))) * 1000`,
          unit: 'ms',
        };
      case 'throughput':
        return { expr: `sum(rate(${H}_count${sel}[$w]))`, unit: 'rps' };
      case 'errors':
        return {
          expr: `sum(rate(${H}_count${sel5xx}[$w])) / sum(rate(${H}_count${sel}[$w])) * 100`,
          unit: '%',
        };
      case 'cpu':
        return { expr: 'sum(rate(process_cpu_seconds_total[$w])) * 100', unit: '%' };
      case 'memory':
        return { expr: 'sum(process_resident_memory_bytes) / 1048576', unit: 'MB' };
      case 'eventLoop':
        return { expr: 'max(nodejs_eventloop_lag_p99_seconds) * 1000', unit: 'ms' };
      case 'gc':
        return { expr: 'sum(rate(nodejs_gc_duration_seconds_sum[$w])) * 60000', unit: 'ms/min' };
      case 'dbLatency':
        return {
          expr: 'sum(rate(core_db_statement_seconds_total[$w])) / sum(rate(core_db_statements_total[$w])) * 1000',
          unit: 'ms',
        };
      case 'queueDepth':
        return {
          expr: 'sum(max by (queue) (core_queue_jobs{state="waiting"}))',
          unit: 'jobs',
        };
    }
  }

  /** Chuyển đổi dữ liệu chuỗi thời gian thành các điểm trên biểu đồ */
  private toPoints(list: { t: number; v: number }[] | undefined, shiftMs = 0) {
    return (list ?? [])
      .filter((p) => Number.isFinite(p.v))
      .map((p) => ({ t: p.t + shiftMs, value: round(p.v, 2) }));
  }

  /** Lấy dữ liệu chuỗi thời gian của lưu lượng mạng */
  public async getTimeseries(
    range: PerfRange,
    metric: TimeseriesMetric,
    compare: TimeseriesMetric | null,
    baseline: BaselineMode | null,
  ): Promise<PerfTimeseriesDto> {
    await this.must();
    const minutes = PERF_RANGES[range];
    const stepSec = Math.max(15, Math.round((minutes * 60) / MAX_POINTS));
    const w = `${Math.max(60, stepSec * 2)}s`;
    /** Tạo chuỗi biểu thức logic hoặc truy vấn chuẩn hóa */
    const exprOf = (m: TimeseriesMetric) => {
      const e = this.metricExpr(m);
      return { ...e, expr: e.expr.replaceAll('$w', w) };
    };
    const main = exprOf(metric);
    const offsetSec =
      baseline === 'previous'
        ? minutes * 60
        : baseline === 'yesterday'
          ? 86_400
          : baseline === 'lastWeek'
            ? 7 * 86_400
            : 0;
    const [mainRes, cmpRes, baseRes, markers] = await Promise.all([
      this.prom.range(main.expr, minutes, stepSec),
      compare ? this.prom.safeRange(exprOf(compare).expr, minutes, stepSec) : Promise.resolve([]),
      offsetSec ? this.prom.safeRange(main.expr, minutes, stepSec, offsetSec) : Promise.resolve([]),
      this.markers(Date.now() - minutes * 60_000),
    ]);
    const points = this.toPoints(mainRes[0]?.points);
    /** Tạo nhãn hiển thị mô tả cho dữ liệu biểu đồ */
    const label = (m: TimeseriesMetric) => this.i18n.t(`performance.metric.${m}`);
    const series: PerfSeriesDto[] = [
      { id: metric, label: label(metric), unit: main.unit, axis: 'left', kind: 'main', points },
    ];
    if (compare)
      series.push({
        id: compare,
        label: label(compare),
        unit: exprOf(compare).unit,
        axis: 'right',
        kind: 'compare',
        points: this.toPoints(cmpRes[0]?.points),
      });
    // Baseline vẽ chồng lên cùng trục thời gian (dịch điểm tới khoảng hiện tại).
    const basePoints = this.toPoints(baseRes[0]?.points, offsetSec * 1000);
    if (baseline && basePoints.length)
      series.push({
        id: `baseline:${baseline}`,
        label: this.i18n.t(`performance.baseline.${baseline}`),
        unit: main.unit,
        axis: 'left',
        kind: 'baseline',
        points: basePoints,
      });
    const values = points.map((p) => p.value);
    const peak = values.length ? Math.max(...values) : null;
    const peakAt = peak !== null ? (points.find((p) => p.value === peak)?.t ?? null) : null;
    return {
      resolutionSec: stepSec,
      unit: main.unit,
      series,
      markers,
      stats: {
        current: values.at(-1) ?? null,
        avg: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : null,
        peak,
        peakAt: peakAt ? new Date(peakAt).toISOString() : null,
      },
      baselineUnavailable: Boolean(baseline) && basePoints.length === 0,
    };
  }

  /** Mốc trên biểu đồ: sự kiện nghẽn và vòng đời runtime (khởi động lại, crash, dừng). */
  private async markers(from: number): Promise<PerfMarkerDto[]> {
    const events = await this.getEventsSince(from);
    return events.map((e): PerfMarkerDto => ({
      t: Date.parse(e.at),
      label: e.title,
      severity: e.severity,
    }));
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  private async getEventsSince(from: number): Promise<PerfEventDto[]> {
    const [perf, rt] = await Promise.all([
      this.events.events().catch(() => []),
      this.runtimes.getEvents(undefined, 200).catch(() => []),
    ]);
    const none = this.i18n.t('performance.none');
    const perfEvents = perf
      .filter((e) => e.at >= from)
      .map((e): PerfEventDto => {
        const runtime = e.runtime ?? '';
        const params = {
          value: e.value,
          threshold: e.threshold,
          unit: e.unit,
          baseline: none,
          runtime,
        };
        return {
          id: e.id,
          at: new Date(e.at).toISOString(),
          source: 'performance',
          severity:
            e.type === 'recovered' ? 'success' : e.severity === 'critical' ? 'critical' : 'warning',
          title: this.i18n.t(`performance.rule.${e.rule}.title`, params),
          message:
            e.type === 'recovered'
              ? this.i18n.t('performance.event.recovered', {
                  minutes: Math.max(1, Math.round((e.durationMs ?? 0) / 60_000)),
                })
              : this.i18n.t(`performance.event.${e.type}`, params),
          target: e.runtime ? `runtimes/${e.runtime}` : null,
        };
      });
    const runtimeEvents = rt
      .filter((e) => Date.parse(e.at) >= from && ['started', 'stopped', 'crashed'].includes(e.type))
      .map((e): PerfEventDto => ({
        id: e.id,
        at: e.at,
        source: 'runtime',
        severity:
          e.level === 'error'
            ? 'critical'
            : e.level === 'warn'
              ? 'warning'
              : e.level === 'success'
                ? 'success'
                : 'info',
        title: e.runtimeName,
        message: e.message,
        target: `runtimes/${e.runtime}`,
      }));
    return [...perfEvents, ...runtimeEvents].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public getEvents(range: PerfRange): Promise<PerfEventDto[]> {
    return this.getEventsSince(Date.now() - PERF_RANGES[range] * 60_000);
  }

  // ─── Component ────────────────────────────────────────────────────────────

  public async getComponent(componentId: string, range: PerfRange): Promise<ComponentDetailDto> {
    if (!COMPONENT_IDS.includes(componentId as ComponentId))
      throw new PerformanceComponentNotFoundException(componentId);
    const id = componentId as ComponentId;
    const seconds = PERF_RANGES[range] * 60;
    const [cur, prev, violations] = await Promise.all([
      this.inputs.window(seconds),
      this.inputs.window(seconds, seconds),
      this.evaluate(),
    ]);
    const own = (violations ?? []).filter((v) => v.component === id);
    /** Khởi tạo hoặc cập nhật một chỉ số đo lường */
    const metric = (
      key: string,
      value: number | null,
      baseline: number | null,
      unit: string,
    ): ComponentMetricDto => ({
      key,
      label: this.i18n.t(`performance.detail.${key}`),
      value,
      unit,
      baseline,
    });
    const metrics: ComponentMetricDto[] =
      id === 'api'
        ? [
            metric('requestsPerSec', cur.api.rps, prev.api.rps, 'rps'),
            metric('p50', cur.api.p50Ms, prev.api.p50Ms, 'ms'),
            metric('p95', cur.api.p95Ms, prev.api.p95Ms, 'ms'),
            metric('p99', cur.api.p99Ms, prev.api.p99Ms, 'ms'),
            metric('errorRate', cur.api.errorRatePercent, prev.api.errorRatePercent, '%'),
          ]
        : id === 'database'
          ? [
              metric('queriesPerSec', cur.db.qps, prev.db.qps, 'qps'),
              metric('avg', cur.db.avgMs, prev.db.avgMs, 'ms'),
              metric('errors', cur.db.errors, prev.db.errors, ''),
              metric('poolUsed', cur.db.poolUsed, prev.db.poolUsed, ''),
              metric('poolWaiting', cur.db.poolWaiting, prev.db.poolWaiting, ''),
            ]
          : id === 'cache'
            ? [
                metric('opsPerSec', cur.cache.opsPerSec, prev.cache.opsPerSec, 'ops/s'),
                metric('hitRate', cur.cache.hitRatePercent, prev.cache.hitRatePercent, '%'),
              ]
            : id === 'worker'
              ? [
                  metric(
                    'jobsPerMin',
                    cur.worker.jobsPerSec === null ? null : round(cur.worker.jobsPerSec * 60, 1),
                    prev.worker.jobsPerSec === null ? null : round(prev.worker.jobsPerSec * 60, 1),
                    '/min',
                  ),
                  metric('avgJob', cur.worker.avgMs, prev.worker.avgMs, 'ms'),
                  metric('p95Job', cur.worker.p95Ms, prev.worker.p95Ms, 'ms'),
                  metric('failed', cur.worker.failed, prev.worker.failed, ''),
                  metric('queueWaiting', cur.messaging.waiting, prev.messaging.waiting, ''),
                ]
              : [
                  metric(
                    'publishedPerMin',
                    cur.messaging.publishedPerSec === null
                      ? null
                      : round(cur.messaging.publishedPerSec * 60, 1),
                    prev.messaging.publishedPerSec === null
                      ? null
                      : round(prev.messaging.publishedPerSec * 60, 1),
                    '/min',
                  ),
                  metric('queueWaiting', cur.messaging.waiting, prev.messaging.waiting, ''),
                  metric('queueActive', cur.worker.activeJobs, prev.worker.activeJobs, ''),
                  metric('queueDelayed', cur.messaging.delayed, prev.messaging.delayed, ''),
                ];
    const row = this.components(cur, violations ?? []).find((c) => c.id === id)!;
    const endpoints =
      id === 'api' && this.prom.configured
        ? await this.traffic
            .getEndpoints({ range, includeInternal: false }, 'p95')
            .then((list) =>
              list.slice(0, 10).map((e) => ({
                routeId: e.id,
                method: e.method,
                route: e.route,
                p95Ms: e.stats.p95LatencyMs,
                requests: e.stats.requests,
              })),
            )
            .catch(() => [])
        : [];
    return {
      status: row.status,
      note: row.note,
      metrics,
      bottlenecks: (await this.bottlenecks(own)).map(toResponse),
      endpoints,
      target: COMPONENT_TARGET[id],
    };
  }
}
