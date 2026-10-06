import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { PrometheusQueryClient, PrometheusUnavailableError } from '@packages/metrics/index.js';
import { RuntimesService } from '@modules/runtimes/index.js';
import { TRAFFIC_RANGES } from '@modules/traffic/index.js';
import { PerformanceStoreService } from './performance-store.service.js';
import {
  PerformanceComponentNotFoundException,
  PerformanceTelemetryUnavailableException,
} from '../exceptions/performance.exceptions.js';
import type {
  BaselineMode,
  BottleneckDto,
  BreakdownDto,
  BudgetDto,
  CapacityDto,
  ComponentDetailDto,
  ComponentId,
  ComponentRowDto,
  PerfEventDto,
  PerfRange,
  PerfSeriesDto,
  PerfTimeseriesDto,
  PerformanceOverviewDto,
  RuntimeResourceDto,
  TimeseriesMetric,
} from '../responses/performance.response.js';

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

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prom: PrometheusQueryClient,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
    private readonly runtimes: RuntimesService,
    private readonly store: PerformanceStoreService,
  ) {}

  /** Prometheus không cấu hình/không trả lời → 503, thay vì KPI rỗng trông như hệ thống nhàn rỗi. */
  private async must<T>(task: Promise<T>): Promise<T> {
    try {
      return await task;
    } catch (err) {
      if (err instanceof PrometheusUnavailableError)
        throw new PerformanceTelemetryUnavailableException();
      throw err;
    }
  }

  public async getOverview(range: PerfRange): Promise<PerformanceOverviewDto> {
    const minutes = TRAFFIC_RANGES[range] ?? 60;
    const w = `${minutes}m`;

    const [p95, rps, errCount, cpuRate, memoryBytes] = await Promise.all([
      this.prom.value(
        `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[${w}])))`,
      ),
      this.must(this.prom.query(`sum(rate(http_request_duration_seconds_count[${w}]))`)).then(
        (r) => r[0]?.value ?? null,
      ),
      this.prom.value(`sum(rate(http_request_duration_seconds_count{status=~"5.."}[${w}]))`),
      this.prom.value(`sum(rate(process_cpu_seconds_total[${w}])) * 100`),
      this.prom.value(`sum(process_resident_memory_bytes)`),
    ]);

    const p95LatencyMs = p95 !== null ? Math.round(p95 * 1000) : null;
    const throughputRps = rps !== null ? Number(rps.toFixed(2)) : null;
    const errorRatePercent =
      rps !== null && rps > 0 && errCount !== null
        ? Number(((errCount / rps) * 100).toFixed(2))
        : 0;
    const cpuPercent = cpuRate !== null ? Number(cpuRate.toFixed(1)) : null;
    const memoryMb = memoryBytes !== null ? Math.round(memoryBytes / 1024 / 1024) : null;

    const runtimeSummaries = await this.runtimes.getSummaries().catch(() => []);
    const resources: RuntimeResourceDto[] = runtimeSummaries.map((r) => {
      const cpu = typeof r.resources?.cpuPercent === 'number' ? r.resources.cpuPercent : null;
      const mem = typeof r.resources?.rssMb === 'number' ? r.resources.rssMb : null;
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        instances: 1,
        cpuPercent: cpu,
        cpuAvgPercent: cpu,
        cpuPeakPercent: cpu,
        cpuPeakAt: null,
        rssMb: mem,
        heapUsedMb: null,
        heapTotalMb: null,
        externalMb: null,
        memoryLimitMb: null,
        memoryLimitSource: null,
        memoryPercent: null,
        eventLoopP99Ms: null,
        eventLoopPeakMs: null,
        gcPerMin: null,
        gcPauseMsPerMin: null,
        gcMaxPauseMs: null,
        memoryTrend: null,
      };
    });

    // Chỉ HTTP có số đo qua Prometheus; thành phần khác chưa có metric → "unavailable", không báo "normal" giả.
    const notMeasured = (
      id: Exclude<ComponentId, 'api'>,
      loadUnit: string,
      target: string,
    ): ComponentRowDto => ({
      id,
      status: 'unavailable',
      note: this.i18n.t('performance.component.notMeasured'),
      load: null,
      loadUnit,
      latencyMs: null,
      latencyKind: 'avg',
      errorPercent: null,
      target,
    });
    const components: ComponentRowDto[] = [
      {
        id: 'api',
        status: throughputRps ? 'normal' : 'idle',
        note: throughputRps ? null : this.i18n.t('performance.component.noLoad'),
        load: throughputRps,
        loadUnit: 'rps',
        latencyMs: p95LatencyMs,
        latencyKind: 'p95',
        errorPercent: errorRatePercent,
        target: 'http-traffic',
      },
      notMeasured('database', 'qps', 'database'),
      notMeasured('cache', 'ops/s', 'cache'),
      notMeasured('worker', 'jobs/s', 'workers'),
      notMeasured('messaging', 'msg/s', 'messaging'),
    ];

    const budgets: BudgetDto[] = [
      {
        key: 'apiP95Ms',
        target: 500,
        current: p95LatencyMs,
        unit: 'ms',
        met: p95LatencyMs !== null ? p95LatencyMs <= 500 : null,
      },
      {
        key: 'errorRatePercent',
        target: 1,
        current: errorRatePercent,
        unit: '%',
        met: errorRatePercent <= 1,
      },
      {
        key: 'cpuPercent',
        target: 80,
        current: cpuPercent,
        unit: '%',
        met: cpuPercent !== null ? cpuPercent <= 80 : null,
      },
    ];

    const capacity: CapacityDto[] = [
      {
        key: 'cpu',
        used: cpuPercent,
        limit: 100,
        percent: cpuPercent,
        unit: '%',
        runtime: null,
      },
      // Không có giới hạn bộ nhớ thật (cgroup/container) qua Prometheus → không tự đặt ngưỡng.
      { key: 'memory', used: memoryMb, limit: null, percent: null, unit: 'MB', runtime: null },
    ];

    // Prometheus chỉ có tổng thời gian request, không có từng giai đoạn (route/guard/db/…) → không chia ước lượng.
    const breakdown: BreakdownDto = {
      requests: Math.round((throughputRps ?? 0) * minutes * 60),
      avgTotalMs: null,
      phases: [],
      dbQueriesPerRequest: null,
    };

    return {
      range,
      generatedAt: new Date().toISOString(),
      telemetry: { performance: true, traffic: true, database: 'unavailable' },
      status: { level: 'normal', reasons: [] },
      kpis: {
        apiP95Ms: { value: p95LatencyMs, previous: null, changePercent: null },
        throughputPerSec: { value: throughputRps, previous: null, changePercent: null },
        cpuPercent: { value: cpuPercent, previous: null, changePercent: null },
        memoryMb: {
          value: memoryMb,
          previous: null,
          changePercent: null,
          percent: null,
          limitMb: null,
        },
        errorRatePercent: { value: errorRatePercent, previous: null, changePercent: null },
        bottlenecks: { count: 0, components: [] },
      },
      resources,
      bottlenecks: [],
      components,
      breakdown,
      budgets,
      capacity,
      throughput: {
        httpPerSec: throughputRps,
        dbQueriesPerSec: null,
        cacheOpsPerSec: null,
        jobsPerMin: null,
        messagesPerMin: null,
        queueWaiting: null,
      },
      settings: {
        resolutionSec: null,
        evaluateSec: 60,
        windowMin: minutes,
        thresholds: { cpuPercent: 80, memoryPercent: 80 },
      },
    };
  }

  public async getTimeseries(
    range: PerfRange,
    metric: TimeseriesMetric,
    compare: TimeseriesMetric | null,
    _baseline: BaselineMode | null,
  ): Promise<PerfTimeseriesDto> {
    const minutes = TRAFFIC_RANGES[range] ?? 60;
    const stepSec = Math.max(10, Math.round((minutes * 60) / 60));

    const getExpr = (m: TimeseriesMetric): { expr: string; unit: string; label: string } => {
      switch (m) {
        case 'latency':
          return {
            expr: `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[1m]))) * 1000`,
            unit: 'ms',
            label: 'Latency (P95)',
          };
        case 'throughput':
          return {
            expr: `sum(rate(http_request_duration_seconds_count[1m]))`,
            unit: 'rps',
            label: 'Throughput',
          };
        case 'errors':
          return {
            expr: `sum(rate(http_request_duration_seconds_count{status=~"5.."}[1m]))`,
            unit: 'rps',
            label: '5xx Errors',
          };
        case 'cpu':
          return {
            expr: `sum(rate(process_cpu_seconds_total[1m])) * 100`,
            unit: '%',
            label: 'CPU',
          };
        case 'memory':
          return {
            expr: `sum(process_resident_memory_bytes) / 1024 / 1024`,
            unit: 'MB',
            label: 'Memory',
          };
        case 'eventLoop':
          return {
            expr: `sum(nodejs_eventloop_lag_seconds) * 1000`,
            unit: 'ms',
            label: 'Event Loop',
          };
        case 'gc':
          return {
            expr: `sum(rate(nodejs_gc_duration_seconds_count[1m]))`,
            unit: 'ops/s',
            label: 'GC',
          };
        default:
          return {
            expr: `sum(rate(http_request_duration_seconds_count[1m]))`,
            unit: 'rps',
            label: m,
          };
      }
    };

    const main = getExpr(metric);
    const seriesList = await this.must(this.prom.range(main.expr, minutes, stepSec));
    const points =
      seriesList[0]?.points.map((p) => ({ t: p.t, value: Number(p.v.toFixed(2)) })) ?? [];
    const values = points.map((p) => p.value);
    const current = values.length > 0 ? (values.at(-1) ?? null) : null;
    const average =
      values.length > 0
        ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
        : null;
    const peak = values.length > 0 ? Math.max(...values) : null;
    const peakAt = peak !== null ? (points.find((p) => p.value === peak)?.t ?? null) : null;

    const series: PerfSeriesDto[] = [
      {
        id: metric,
        label: main.label,
        unit: main.unit,
        axis: 'left',
        kind: 'main',
        points,
      },
    ];

    if (compare) {
      const cmp = getExpr(compare);
      const cmpSeriesList = await this.prom.safeRange(cmp.expr, minutes, stepSec);
      const cmpPoints =
        cmpSeriesList[0]?.points.map((p) => ({ t: p.t, value: Number(p.v.toFixed(2)) })) ?? [];
      series.push({
        id: compare,
        label: cmp.label,
        unit: cmp.unit,
        axis: 'right',
        kind: 'compare',
        points: cmpPoints,
      });
    }

    return {
      metric,
      compare,
      baseline: null,
      range,
      resolutionSec: stepSec,
      unit: main.unit,
      series,
      markers: [],
      stats: {
        current,
        avg: average,
        peak,
        peakAt: peakAt ? new Date(peakAt).toISOString() : null,
      },
      baselineUnavailable: false,
    };
  }

  public async getBottlenecks(): Promise<BottleneckDto[]> {
    return [];
  }

  public async getEvents(_range: PerfRange): Promise<PerfEventDto[]> {
    return [];
  }

  public async getComponent(componentId: string, range: PerfRange): Promise<ComponentDetailDto> {
    if (!COMPONENT_IDS.includes(componentId as ComponentId)) {
      throw new PerformanceComponentNotFoundException(componentId);
    }

    return {
      id: componentId as ComponentId,
      name: componentId.toUpperCase(),
      status: 'normal',
      note: null,
      range,
      metrics: [],
      bottlenecks: [],
      endpoints: [],
      slowQueries: [],
      target: 'performance',
    };
  }
}
