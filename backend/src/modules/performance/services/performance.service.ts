import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { DatabaseConnectionService } from '@packages/database/index.js';
import { LONG_RUNNING_RUNTIMES } from '@packages/runtime/index.js';
import {
  TELEMETRY_TIERS,
  tierCovering,
  type MetricBucket,
  type TelemetryTier,
} from '@packages/telemetry/index.js';
import {
  TRAFFIC_RANGES,
  TrafficStoreService,
  emptyAgg,
  mergeAgg,
  perEndpoint,
  statsOf,
  totalOf,
  type BucketAgg,
  type EndpointAgg,
} from '@modules/traffic/index.js';
import { RuntimesService, type RuntimeSummaryDto } from '@modules/runtimes/index.js';
import { histogramPercentile } from '@packages/telemetry/index.js';
import { PerformanceStoreService, type StoredPerfEvent } from './performance-store.service.js';
import {
  changePercent,
  counterOf,
  gaugeOf,
  gaugeWindow,
  latestInstance,
  linearTrend,
  meanOf,
  mergedOf,
  percentileOf,
  round,
  type GaugeOptions,
} from './performance-metrics.js';
import {
  GROWTH_RATIO,
  evaluateRules,
  type RuleSnapshot,
  type Violation,
} from './performance-rules.js';
import {
  PerformanceComponentNotFoundException,
  PerformanceTelemetryUnavailableException,
} from '../exceptions/performance.exceptions.js';
import type {
  BaselineMode,
  BottleneckDto,
  BreakdownDto,
  BreakdownPhaseDto,
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

const MINUTE = 60_000;
const MAX_POINTS = 120;
/** Cửa sổ "hiện tại" của rule engine và baseline liền trước nó. */
const RULE_WINDOW_MIN = 5;
const RULE_BASELINE_MIN = 60;
const BREAKDOWN_UNIT_MS = 0.1;
const IMPACT_LIMIT = 3;
const SLOW_QUERY_LIMIT = 50;
const EVENT_LIMIT = 100;
/** Instance coi là đang sống nếu có số đo trong khoảng này. */
const LIVE_INSTANCE_MS = 30_000;
const BASELINE_OFFSET_MS: Record<BaselineMode, (len: number) => number> = {
  previous: (len) => len,
  yesterday: () => 24 * 60 * MINUTE,
  lastWeek: () => 7 * 24 * 60 * MINUTE,
};

/** Dữ liệu của một khoảng thời gian từ mọi nguồn. */
interface Window {
  tier: TelemetryTier;
  perf: MetricBucket[];
  http: BucketAgg[];
  /** Số giây thực tế (tới hiện tại). */
  seconds: number;
}

interface Evaluation {
  violations: Violation[];
  current: Window | null;
  snapshot: RuleSnapshot;
}

interface SeriesDef {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

type Group = { t: number; perf: MetricBucket[]; http: EndpointAgg; seconds: number };

const sum = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};
const avgOfNumbers = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const r1 = (n: number | null) => (n === null ? null : round(n, 1));
const r2 = (n: number | null) => (n === null ? null : round(n, 2));

/**
 * Phân tích hiệu năng toàn hệ thống: gộp số đo runtime, HTTP, database, cache, worker/queue
 * (đã ghi trong Redis) và áp rule phát hiện nghẽn. Không có dữ liệu → `null`, không tự tạo số.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly store: PerformanceStoreService,
    private readonly traffic: TrafficStoreService,
    private readonly runtimes: RuntimesService,
    private readonly db: DatabaseConnectionService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.performance;
  }

  private get dbState(): 'active' | 'unavailable' {
    return this.db.isConnected() ? 'active' : 'unavailable';
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: PerfRange): Promise<PerformanceOverviewDto> {
    this.assertAvailable();
    const now = Date.now();
    const len = PERF_RANGES[range] * MINUTE;
    const [current, previous, summaries, assessment, liveInstances] = await Promise.all([
      this.window(now - len, now, now),
      this.window(now - 2 * len, now - len, now),
      this.runtimes.getSummaries(),
      this.assess(now),
      this.store.instances(now - LIVE_INSTANCE_MS).catch(() => [] as string[]),
    ]);
    const { bottlenecks, snapshot } = assessment;

    const httpNow = current ? totalOf(current.http, () => true) : emptyAgg();
    const httpPrev = previous ? totalOf(previous.http, () => true) : emptyAgg();
    const stats = statsOf(httpNow, current?.seconds ?? 0);
    const prevStats = previous ? statsOf(httpPrev, previous.seconds) : null;

    const runtimeIds = [...LONG_RUNNING_RUNTIMES];
    const cpuOf = (w: Window | null) =>
      w ? sum(runtimeIds.map((id) => gaugeWindow(w.perf, 'rt.cpu', { runtime: id }).avg)) : null;
    const rssOf = (w: Window | null) =>
      w ? sum(runtimeIds.map((id) => gaugeWindow(w.perf, 'rt.rss', { runtime: id }).avg)) : null;
    const memPctOf = (w: Window | null) => {
      if (!w) return null;
      const values = runtimeIds
        .map((id) => gaugeWindow(w.perf, 'rt.memPct', { runtime: id, mode: 'max' }).avg)
        .filter((v): v is number => v !== null);
      return values.length ? Math.max(...values) : null;
    };

    const kpi = (value: number | null, prev: number | null, digits = 1): KpiDto => ({
      value: value === null ? null : round(value, digits),
      previous: prev === null ? null : round(prev, digits),
      changePercent: changePercent(value, prev),
    });

    const hasHttp = httpNow.n > 0;
    const cgroupLimits = summaries.map((s) => s.resources).filter((r) => r !== null);
    const limitMb =
      cgroupLimits.length > 0 && cgroupLimits.every((r) => r!.memoryLimitSource === 'cgroup')
        ? sum(cgroupLimits.map((r) => r!.memoryLimitMb))
        : null;

    const resources = this.resources(summaries, current, snapshot, liveInstances);
    const components = this.components(current, summaries, bottlenecks);
    const cpuNow = cpuOf(current);
    const memPct = memPctOf(current);

    return {
      range,
      generatedAt: new Date(now).toISOString(),
      telemetry: {
        performance: this.cfg.enabled,
        traffic: this.config.traffic.enabled,
        database: this.dbState,
      },
      status: {
        level: this.levelOf(bottlenecks, current, summaries),
        reasons: bottlenecks.map((b) => b.title),
      },
      kpis: {
        apiP95Ms: kpi(hasHttp ? stats.p95LatencyMs : null, prevStats?.p95LatencyMs ?? null),
        throughputPerSec: kpi(
          current ? stats.requestsPerSecond : null,
          prevStats ? prevStats.requestsPerSecond : null,
          3,
        ),
        cpuPercent: kpi(cpuNow, cpuOf(previous)),
        memoryMb: {
          ...kpi(rssOf(current), rssOf(previous)),
          percent: r1(memPct),
          limitMb: r1(limitMb),
        },
        errorRatePercent: kpi(
          hasHttp ? stats.errorRatePercent : null,
          prevStats && httpPrev.n > 0 ? prevStats.errorRatePercent : null,
          2,
        ),
        bottlenecks: {
          count: bottlenecks.length,
          components: [
            ...new Set(bottlenecks.map((b) => this.componentName(b.component, b.runtime))),
          ],
        },
      },
      resources,
      bottlenecks,
      components,
      breakdown: this.breakdown(httpNow),
      budgets: this.budgets(stats, hasHttp, cpuNow, memPct),
      capacity: this.capacity(current, summaries),
      throughput: this.throughput(current),
      settings: {
        resolutionSec: current ? TELEMETRY_TIERS[current.tier].seconds : null,
        evaluateSec: Math.round(this.cfg.evaluateMs / 1000),
        windowMin: RULE_WINDOW_MIN,
        thresholds: {
          cpuPercent: this.cfg.rules.cpuPercent.warn,
          memoryPercent: this.cfg.rules.memoryPercent.warn,
        },
      },
    };
  }

  public async getBottlenecks(): Promise<BottleneckDto[]> {
    this.assertAvailable();
    return (await this.assess(Date.now())).bottlenecks;
  }

  // ─── Timeseries ───────────────────────────────────────────────────────────

  public async getTimeseries(
    range: PerfRange,
    metric: TimeseriesMetric,
    compare: TimeseriesMetric | null,
    baseline: BaselineMode | null,
  ): Promise<PerfTimeseriesDto> {
    this.assertAvailable();
    const now = Date.now();
    const len = PERF_RANGES[range] * MINUTE;
    const offset = baseline ? BASELINE_OFFSET_MS[baseline](len) : 0;
    const [win, baseWin, summaries, markers] = await Promise.all([
      this.window(now - len, now, now),
      baseline ? this.window(now - len - offset, now - offset, now) : Promise.resolve(null),
      this.runtimes.getSummaries(),
      this.markers(now - len, now),
    ]);
    const names = new Map(summaries.map((s) => [s.id, s.name]));

    const main = win ? this.seriesFor(metric, this.groups(win, now), names) : [];
    const series: PerfSeriesDto[] = main.map((s) => ({ ...s, axis: 'left', kind: 'main' }));

    if (compare && compare !== metric && win) {
      const primary = this.seriesFor(compare, this.groups(win, now), names)[0];
      if (primary)
        series.push({
          ...primary,
          id: `compare:${primary.id}`,
          label: `${this.i18n.t(`performance.metric.${compare}`)} · ${primary.label}`,
          axis: 'right',
          kind: 'compare',
        });
    }

    if (baseline && baseWin && main[0]) {
      const primary = this.seriesFor(metric, this.groups(baseWin, now - offset), names).find(
        (s) => s.id === main[0]!.id,
      );
      if (primary)
        series.push({
          ...primary,
          id: `baseline:${primary.id}`,
          label: this.i18n.t(`performance.baseline.${baseline}`),
          axis: 'left',
          kind: 'baseline',
          points: primary.points.map((p) => ({ t: p.t + offset, value: p.value })),
        });
    }

    const points = main[0]?.points ?? [];
    let peak: { t: number; value: number } | null = null;
    for (const p of points) if (!peak || p.value > peak.value) peak = p;
    return {
      metric,
      compare: compare && compare !== metric ? compare : null,
      baseline,
      range,
      resolutionSec: win ? TELEMETRY_TIERS[win.tier].seconds : null,
      unit: main[0]?.unit ?? this.unitOf(metric),
      series,
      markers,
      stats: {
        current: r2(points.at(-1)?.value ?? null),
        avg: r2(avgOfNumbers(points.map((p) => p.value))),
        peak: r2(peak?.value ?? null),
        peakAt: peak ? new Date(peak.t).toISOString() : null,
      },
      baselineUnavailable: Boolean(baseline) && !baseWin,
    };
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  public async getEvents(range: PerfRange): Promise<PerfEventDto[]> {
    this.assertAvailable();
    const now = Date.now();
    const from = now - PERF_RANGES[range] * MINUTE;
    const [perfEvents, runtimeEvents] = await Promise.all([
      this.store.events().catch(() => [] as StoredPerfEvent[]),
      this.runtimes.getEvents(undefined, 500),
    ]);
    const out: PerfEventDto[] = [];
    for (const e of perfEvents) {
      if (e.at < from) continue;
      out.push({
        id: e.id,
        at: new Date(e.at).toISOString(),
        source: 'performance',
        type: e.type,
        severity: e.type === 'recovered' ? 'success' : e.severity,
        title: this.ruleTitle(e.rule, e.runtime),
        message: this.eventMessage(e),
        target: this.targetOf(e.rule, e.runtime),
      });
    }
    for (const e of runtimeEvents) {
      if (Date.parse(e.at) < from) continue;
      out.push({
        id: e.id,
        at: e.at,
        source: 'runtime',
        type: e.type,
        severity: e.level === 'error' ? 'critical' : e.level === 'warn' ? 'warning' : e.level,
        title: e.runtimeName,
        message: e.message,
        target: `runtimes/${e.runtime}`,
      });
    }
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, EVENT_LIMIT);
  }

  // ─── Component detail ─────────────────────────────────────────────────────

  public async getComponent(rawId: string, range: PerfRange): Promise<ComponentDetailDto> {
    if (!COMPONENT_IDS.includes(rawId as ComponentId))
      throw new PerformanceComponentNotFoundException(rawId);
    this.assertAvailable();
    const id = rawId as ComponentId;
    const now = Date.now();
    const len = PERF_RANGES[range] * MINUTE;
    const [current, previous, summaries, { bottlenecks }, routes, slow] = await Promise.all([
      this.window(now - len, now, now),
      this.window(now - 2 * len, now - len, now),
      this.runtimes.getSummaries(),
      this.assess(now),
      this.traffic.routes().catch(() => new Map()),
      id === 'database'
        ? this.store.slowQueries(SLOW_QUERY_LIMIT).catch(() => [])
        : Promise.resolve([]),
    ]);
    const row = this.components(current, summaries, bottlenecks).find((c) => c.id === id)!;

    let endpoints: ComponentDetailDto['endpoints'] = [];
    if (id === 'api' && current) {
      endpoints = [...perEndpoint(current.http, () => true)]
        .map(([routeId, agg]) => {
          const route = routes.get(routeId);
          return {
            routeId,
            method: route?.method ?? '?',
            route: route?.route ?? routeId,
            p95Ms: histogramPercentile(agg.hist, 95),
            requests: agg.n,
          };
        })
        .sort((a, b) => (b.p95Ms ?? -1) - (a.p95Ms ?? -1))
        .slice(0, 10);
    }

    return {
      id,
      name: this.componentName(id, null),
      status: row.status,
      note: row.note,
      range,
      metrics: this.componentMetrics(id, current, previous),
      bottlenecks: bottlenecks.filter(
        (b) => b.component === id || (id === 'worker' && b.runtime === 'worker'),
      ),
      endpoints,
      slowQueries: slow.filter((q) => q.at >= now - len),
      target: row.target,
    };
  }

  // ─── Rule engine ──────────────────────────────────────────────────────────

  /** Đánh giá rule trên 5 phút gần nhất so với 60 phút trước đó (dùng chung cho Monitor). */
  public async evaluate(now = Date.now()): Promise<Evaluation> {
    const from = now - RULE_WINDOW_MIN * MINUTE;
    const [current, baseline, growth] = await Promise.all([
      this.window(from, now, now, 's10'),
      this.window(from - RULE_BASELINE_MIN * MINUTE, from, now, 's10'),
      this.window(now - this.cfg.rules.memoryGrowthWindowMin * MINUTE, now, now, 'm1'),
    ]);
    const snapshot = this.snapshot(current, baseline, growth, now);
    return { violations: evaluateRules(snapshot, this.cfg.rules), current, snapshot };
  }

  private snapshot(
    current: Window | null,
    baseline: Window | null,
    growth: Window | null,
    now: number,
  ): RuleSnapshot {
    const httpNow = current ? totalOf(current.http, () => true) : emptyAgg();
    const httpBase = baseline ? totalOf(baseline.http, () => true) : emptyAgg();
    const statsNow = statsOf(httpNow, current?.seconds ?? 0);
    const statsBase = httpBase.n > 0 ? statsOf(httpBase, baseline!.seconds) : null;
    const perfNow = current?.perf ?? [];
    const perfBase = baseline?.perf ?? [];
    const minutesNow = (current?.seconds ?? 0) / 60;
    const minutesBase = (baseline?.seconds ?? 0) / 60;
    const sustainFrom = now - this.cfg.rules.cpuSustainMin * MINUTE;

    const dbNow = mergedOf(perfNow, 'db.query');
    const dbBase = mergedOf(perfBase, 'db.query');
    const poolUsed = gaugeWindow(perfNow, 'db.pool.used').current;
    const poolLimit = gaugeWindow(perfNow, 'db.pool.limit').current;
    const workerFailedBase = counterOf(perfBase, 'worker.failed');
    const workerJobsBase = counterOf(perfBase, 'worker.completed') + workerFailedBase;

    return {
      api: {
        requests: httpNow.n,
        p95: statsNow.p95LatencyMs,
        p99: statsNow.p99LatencyMs,
        errorRate: statsNow.errorRatePercent,
        baselineP95: statsBase?.p95LatencyMs ?? null,
        baselineP99: statsBase?.p99LatencyMs ?? null,
        baselineErrorRate: statsBase?.errorRatePercent ?? null,
      },
      runtimes: LONG_RUNNING_RUNTIMES.map((id) => {
        const opts: GaugeOptions = { runtime: id };
        const pctOpts: GaugeOptions = { runtime: id, mode: 'max' };
        const gcNow = counterOf(perfNow, 'rt.gcPause', id);
        const gcBase = counterOf(perfBase, 'rt.gcPause', id);
        // Xu hướng bộ nhớ tính trên process hiện tại — process cũ (đã restart) không được cộng vào.
        const current = growth ? latestInstance(growth.perf, id) : null;
        const rss =
          growth && current ? gaugeWindow(growth.perf, 'rt.rss', { instance: current }).points : [];
        return {
          id,
          cpuRecent: perfNow
            .filter((b) => b.start >= sustainFrom)
            .map((b) => gaugeOf(b, 'rt.cpu', opts))
            .filter((v): v is number => v !== null),
          cpuBaseline: gaugeWindow(perfBase, 'rt.cpu', opts).avg,
          memoryPercent: gaugeWindow(perfNow, 'rt.memPct', pctOpts).avg,
          memoryBaseline: gaugeWindow(perfBase, 'rt.memPct', pctOpts).avg,
          eventLoopP99: gaugeWindow(perfNow, 'rt.elP99', pctOpts).avg,
          eventLoopBaseline: gaugeWindow(perfBase, 'rt.elP99', pctOpts).avg,
          gcPauseMsPerMin:
            minutesNow > 0 && this.hasRuntime(perfNow, id) ? gcNow / minutesNow : null,
          gcBaseline:
            minutesBase > 0 && this.hasRuntime(perfBase, id) ? gcBase / minutesBase : null,
          memoryTrend: linearTrend(rss),
        };
      }),
      db: {
        queries: dbNow.n,
        p95: percentileOf(dbNow, 95),
        baselineP95: dbBase.n > 0 ? percentileOf(dbBase, 95) : null,
        poolPercent: poolUsed !== null && poolLimit ? (poolUsed / poolLimit) * 100 : null,
      },
      queue: {
        waiting: gaugeWindow(perfNow, 'queue.waiting', { mode: 'max' }).current,
        baseline: gaugeWindow(perfBase, 'queue.waiting', { mode: 'max' }).avg,
      },
      worker: {
        completed: counterOf(perfNow, 'worker.completed'),
        failed: counterOf(perfNow, 'worker.failed'),
        baselineFailedPercent:
          workerJobsBase > 0 ? (workerFailedBase / workerJobsBase) * 100 : null,
      },
    };
  }

  private async assess(
    now: number,
  ): Promise<{ bottlenecks: BottleneckDto[]; snapshot: RuleSnapshot }> {
    const [{ violations, current, snapshot }, active, routes] = await Promise.all([
      this.evaluate(now),
      this.store.activeRules().catch(() => new Map()),
      this.traffic.routes().catch(() => new Map()),
    ]);
    const bottlenecks = violations.map((v): BottleneckDto => {
      const since = active.get(v.id)?.since;
      return {
        id: v.id,
        rule: v.rule,
        component: v.component,
        runtime: v.runtime,
        severity: v.severity,
        title: this.ruleTitle(v.rule, v.runtime),
        message: this.i18n.t(`performance.rule.${v.rule}.message`, {
          value: v.value,
          threshold: v.threshold,
          unit: v.unit,
          baseline:
            v.baseline === null
              ? this.i18n.t('performance.none')
              : v.unit === '%'
                ? `${v.baseline}%`
                : `${v.baseline} ${v.unit}`,
          runtime: v.runtime ? this.runtimeName(v.runtime) : '',
        }),
        value: v.value,
        threshold: v.threshold,
        unit: v.unit,
        baseline: v.baseline,
        since: since ? new Date(since).toISOString() : null,
        impact: this.impactOf(v, current, routes),
        target: this.targetOf(v.rule, v.runtime),
      };
    });
    return { bottlenecks, snapshot };
  }

  /** Endpoint bị ảnh hưởng: theo thời gian DB/request (DB_LATENCY) hoặc theo P95 (API latency). */
  private impactOf(
    v: Violation,
    current: Window | null,
    routes: Map<string, { method: string; route: string }>,
  ): BottleneckDto['impact'] {
    if (!current || !['DB_LATENCY', 'API_LATENCY_P95', 'API_LATENCY_P99'].includes(v.rule))
      return [];
    return [...perEndpoint(current.http, () => true)]
      .map(([routeId, agg]) => {
        const n = agg.breakdown.get('b.n') ?? 0;
        const valueMs =
          v.rule === 'DB_LATENCY'
            ? n > 0
              ? ((agg.breakdown.get('b.db') ?? 0) * BREAKDOWN_UNIT_MS) / n
              : 0
            : (histogramPercentile(agg.hist, v.rule === 'API_LATENCY_P99' ? 99 : 95) ?? 0);
        const route = routes.get(routeId);
        return {
          routeId,
          method: route?.method ?? '?',
          route: route?.route ?? routeId,
          valueMs: round(valueMs, 1),
        };
      })
      .filter((e) => e.valueMs > 0)
      .sort((a, b) => b.valueMs - a.valueMs)
      .slice(0, IMPACT_LIMIT);
  }

  // ─── Sections ─────────────────────────────────────────────────────────────

  private resources(
    summaries: RuntimeSummaryDto[],
    current: Window | null,
    snapshot: RuleSnapshot,
    liveInstances: string[],
  ): RuntimeResourceDto[] {
    const perf = current?.perf ?? [];
    const minutes = (current?.seconds ?? 0) / 60;
    return summaries.map((s) => {
      const opts: GaugeOptions = { runtime: s.id };
      const cpu = gaugeWindow(perf, 'rt.cpu', opts);
      const el = gaugeWindow(perf, 'rt.elP99', { ...opts, mode: 'max' });
      const gcMax = gaugeWindow(perf, 'rt.gcMaxPause', { ...opts, mode: 'max' });
      const has = this.hasRuntime(perf, s.id);
      // Instance đang sống = vừa ghi số đo gần đây (process đã restart không tính).
      const instances = liveInstances.filter((i) => i.startsWith(`${s.id}@`)).length;
      const r = s.resources;
      const trend = snapshot.runtimes.find((x) => x.id === s.id)?.memoryTrend ?? null;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        instances: instances || (r ? 1 : 0),
        cpuPercent: r?.cpuPercent ?? null,
        cpuAvgPercent: r1(cpu.avg),
        cpuPeakPercent: r1(cpu.peak),
        cpuPeakAt: cpu.peakAt ? new Date(cpu.peakAt).toISOString() : null,
        rssMb: r?.rssMb ?? null,
        heapUsedMb: r?.heapUsedMb ?? null,
        heapTotalMb: r?.heapTotalMb ?? null,
        externalMb: r?.externalMb ?? null,
        memoryLimitMb: r?.memoryLimitMb ?? null,
        memoryLimitSource: r?.memoryLimitSource ?? null,
        memoryPercent: r?.memoryPercent ?? null,
        eventLoopP99Ms: r?.eventLoopP99Ms ?? null,
        eventLoopPeakMs: r2(el.peak),
        gcPerMin: has && minutes > 0 ? r1(counterOf(perf, 'rt.gcCount', s.id) / minutes) : null,
        gcPauseMsPerMin:
          has && minutes > 0 ? r1(counterOf(perf, 'rt.gcPause', s.id) / minutes) : null,
        gcMaxPauseMs: r2(gcMax.peak),
        memoryTrend: trend
          ? {
              windowMin: Math.round(trend.spanMin),
              changeMb: round(trend.changeMb, 1),
              growing:
                trend.spanMin >= this.cfg.rules.memoryGrowthWindowMin * 0.9 &&
                trend.increasingRatio >= GROWTH_RATIO &&
                trend.changeMb > 0,
            }
          : null,
      };
    });
  }

  private components(
    current: Window | null,
    summaries: RuntimeSummaryDto[],
    bottlenecks: BottleneckDto[],
  ): ComponentRowDto[] {
    const perf = current?.perf ?? [];
    const seconds = current?.seconds ?? 0;
    const minutes = seconds / 60;
    const perSec = (n: number) => (seconds > 0 ? round(n / seconds, 3) : null);
    const worst = (id: ComponentId): ComponentStatus | null => {
      const related = bottlenecks.filter(
        (b) => b.component === id || (id === 'worker' && b.runtime === 'worker'),
      );
      if (related.some((b) => b.severity === 'critical')) return 'critical';
      return related.length ? 'degraded' : null;
    };
    const statusOf = (id: ComponentId, hasLoad: boolean) =>
      worst(id) ?? (hasLoad ? 'normal' : 'idle');

    const http = current ? totalOf(current.http, () => true) : emptyAgg();
    const httpStats = statsOf(http, seconds);
    const db = mergedOf(perf, 'db.query');
    const dbErrors = counterOf(perf, 'db.errors');
    const cacheOps = ['hit', 'miss', 'set', 'del'].reduce(
      (a, k) => a + counterOf(perf, `cache.${k}`),
      0,
    );
    const hits = counterOf(perf, 'cache.hit');
    const reads = hits + counterOf(perf, 'cache.miss');
    const cacheOp = mergedOf(perf, 'cache.op');
    const completed = counterOf(perf, 'worker.completed');
    const failed = counterOf(perf, 'worker.failed');
    const job = mergedOf(perf, 'worker.job');
    const published = counterOf(perf, 'msg.published');
    const waiting = gaugeWindow(perf, 'queue.waiting', { mode: 'max' }).current;
    const workerAlive = summaries.some((s) => s.id === 'worker' && s.resources !== null);

    const dbUnavailable = db.n === 0 && this.dbState === 'unavailable';
    const workerUnavailable = !workerAlive && completed + failed === 0;

    return [
      {
        id: 'api',
        status: statusOf('api', http.n > 0),
        note: http.n === 0 ? this.i18n.t('performance.component.noLoad') : null,
        load: http.n > 0 ? httpStats.requestsPerSecond : null,
        loadUnit: '/s',
        latencyMs: httpStats.p95LatencyMs,
        latencyKind: 'p95',
        errorPercent: http.n > 0 ? httpStats.errorRatePercent : null,
        target: 'http-traffic/endpoints?sort=p95',
      },
      {
        id: 'database',
        status: dbUnavailable ? 'unavailable' : statusOf('database', db.n > 0),
        note: dbUnavailable
          ? this.i18n.t('performance.component.database.noDataSource')
          : db.n === 0
            ? this.i18n.t('performance.component.noLoad')
            : null,
        load: db.n > 0 ? perSec(db.n) : null,
        loadUnit: '/s',
        latencyMs: r1(percentileOf(db, 95)),
        latencyKind: 'p95',
        errorPercent: db.n > 0 ? round((dbErrors / db.n) * 100) : null,
        target: 'performance/components/database',
      },
      {
        id: 'cache',
        status: statusOf('cache', cacheOps > 0),
        note:
          cacheOps === 0
            ? this.i18n.t('performance.component.noLoad')
            : reads > 0
              ? this.i18n.t('performance.component.cache.hitRate', {
                  rate: round((hits / reads) * 100, 1),
                })
              : null,
        load: cacheOps > 0 ? perSec(cacheOps) : null,
        loadUnit: '/s',
        latencyMs: r2(meanOf(cacheOp)),
        latencyKind: 'avg',
        errorPercent: null,
        target: 'cache',
      },
      {
        id: 'worker',
        status: workerUnavailable ? 'unavailable' : statusOf('worker', completed + failed > 0),
        note: workerUnavailable
          ? this.i18n.t('performance.component.worker.notRunning')
          : completed + failed === 0
            ? this.i18n.t('performance.component.noLoad')
            : null,
        load:
          completed + failed > 0 && minutes > 0 ? round((completed + failed) / minutes, 2) : null,
        loadUnit: '/min',
        latencyMs: r1(meanOf(job)),
        latencyKind: 'avg',
        errorPercent: completed + failed > 0 ? round((failed / (completed + failed)) * 100) : null,
        target: 'runtimes/worker',
      },
      {
        id: 'messaging',
        status: bottlenecks.some((b) => b.rule === 'QUEUE_BACKLOG')
          ? (worst('worker') ?? 'degraded')
          : published > 0 || (waiting ?? 0) > 0
            ? 'normal'
            : 'idle',
        note:
          waiting !== null
            ? this.i18n.t('performance.component.messaging.waiting', { count: Math.round(waiting) })
            : published === 0
              ? this.i18n.t('performance.component.noLoad')
              : null,
        load: published > 0 && minutes > 0 ? round(published / minutes, 2) : null,
        loadUnit: '/min',
        latencyMs: null,
        latencyKind: 'avg',
        errorPercent: null,
        target: 'messaging',
      },
    ];
  }

  private breakdown(http: EndpointAgg): BreakdownDto {
    const n = http.breakdown.get('b.n') ?? 0;
    const phases: BreakdownPhaseDto['phase'][] = ['route', 'guard', 'app', 'db', 'cache', 'send'];
    const avgs = phases.map((phase) => ({
      phase,
      avgMs: n > 0 ? ((http.breakdown.get(`b.${phase}`) ?? 0) * BREAKDOWN_UNIT_MS) / n : 0,
    }));
    const total = avgs.reduce((a, p) => a + p.avgMs, 0);
    return {
      requests: n,
      avgTotalMs: n > 0 ? round(total, 2) : null,
      phases: avgs.map((p) => ({
        phase: p.phase,
        avgMs: round(p.avgMs, 2),
        percent: total > 0 ? round((p.avgMs / total) * 100, 1) : 0,
      })),
      dbQueriesPerRequest: n > 0 ? round((http.breakdown.get('b.dbq') ?? 0) / n, 2) : null,
    };
  }

  private budgets(
    stats: ReturnType<typeof statsOf>,
    hasHttp: boolean,
    cpu: number | null,
    memPct: number | null,
  ): BudgetDto[] {
    const b = this.cfg.budgets;
    const item = (key: BudgetDto['key'], current: number | null, unit: string): BudgetDto => ({
      key,
      target: b[key],
      current: current === null ? null : round(current, 2),
      unit,
      met: current === null ? null : current <= b[key],
    });
    return [
      item('apiP95Ms', hasHttp ? stats.p95LatencyMs : null, 'ms'),
      item('apiP99Ms', hasHttp ? stats.p99LatencyMs : null, 'ms'),
      item('errorRatePercent', hasHttp ? stats.errorRatePercent : null, '%'),
      item('cpuPercent', cpu, '%'),
      item('memoryPercent', memPct, '%'),
    ];
  }

  private capacity(current: Window | null, summaries: RuntimeSummaryDto[]): CapacityDto[] {
    const perf = current?.perf ?? [];
    const live = summaries.filter((s) => s.resources !== null);
    const cpu = sum(live.map((s) => s.resources!.cpuPercent));
    const topMem = live
      .filter((s) => s.resources!.memoryPercent !== null)
      .sort((a, b) => b.resources!.memoryPercent! - a.resources!.memoryPercent!)[0];
    const mem = topMem?.resources ?? null;
    const memUsed = mem ? (mem.memoryLimitSource === 'cgroup' ? mem.rssMb : mem.heapUsedMb) : null;
    const poolUsed = gaugeWindow(perf, 'db.pool.used').current;
    const poolLimit = gaugeWindow(perf, 'db.pool.limit').current;
    const active = gaugeWindow(perf, 'queue.active', { mode: 'max' }).current;
    const concurrency = gaugeWindow(perf, 'worker.concurrency').current;
    const pct = (u: number | null, l: number | null) =>
      u !== null && l ? round((u / l) * 100, 1) : null;
    return [
      {
        key: 'cpu',
        used: r1(cpu),
        limit: cpu === null ? null : 100,
        percent: r1(cpu),
        unit: '%',
        runtime: null,
      },
      {
        key: 'memory',
        used: r1(memUsed),
        limit: mem?.memoryLimitMb ?? null,
        percent: mem?.memoryPercent ?? null,
        unit: 'MB',
        runtime: topMem?.id ?? null,
      },
      {
        key: 'dbPool',
        used: r1(poolUsed),
        limit: r1(poolLimit),
        percent: pct(poolUsed, poolLimit),
        unit: '',
        runtime: null,
      },
      {
        key: 'workerConcurrency',
        used: r1(active),
        limit: r1(concurrency),
        percent: pct(active, concurrency),
        unit: '',
        runtime: 'worker',
      },
    ];
  }

  private throughput(current: Window | null): PerformanceOverviewDto['throughput'] {
    const perf = current?.perf ?? [];
    const seconds = current?.seconds ?? 0;
    const minutes = seconds / 60;
    const http = current ? totalOf(current.http, () => true).n : 0;
    const db = mergedOf(perf, 'db.query').n;
    const cache = ['hit', 'miss', 'set', 'del'].reduce(
      (a, k) => a + counterOf(perf, `cache.${k}`),
      0,
    );
    const jobs = counterOf(perf, 'worker.completed') + counterOf(perf, 'worker.failed');
    const published = counterOf(perf, 'msg.published');
    const perSec = (n: number) => (seconds > 0 ? round(n / seconds, 3) : null);
    const perMin = (n: number) => (minutes > 0 ? round(n / minutes, 2) : null);
    return {
      httpPerSec: current ? perSec(http) : null,
      dbQueriesPerSec: this.dbState === 'unavailable' && db === 0 ? null : perSec(db),
      cacheOpsPerSec: perSec(cache),
      jobsPerMin: this.hasRuntime(perf, 'worker') || jobs > 0 ? perMin(jobs) : null,
      messagesPerMin: perMin(published),
      queueWaiting: r1(gaugeWindow(perf, 'queue.waiting', { mode: 'max' }).current),
    };
  }

  private componentMetrics(
    id: ComponentId,
    current: Window | null,
    previous: Window | null,
  ): ComponentMetricDto[] {
    const metric = (
      key: string,
      unit: string,
      get: (w: Window) => number | null,
    ): ComponentMetricDto => {
      const value = current ? get(current) : null;
      const base = previous ? get(previous) : null;
      return {
        key,
        label: this.i18n.t(`performance.detail.${key}`),
        value: r2(value),
        unit,
        baseline: r2(base),
        changePercent: changePercent(value, base),
      };
    };
    const minutes = (w: Window) => w.seconds / 60;
    const httpOf = (w: Window) => totalOf(w.http, () => true);
    switch (id) {
      case 'api':
        return [
          metric('requestsPerSec', '/s', (w) =>
            httpOf(w).n ? statsOf(httpOf(w), w.seconds).requestsPerSecond : null,
          ),
          metric('p50', 'ms', (w) => statsOf(httpOf(w), w.seconds).p50LatencyMs),
          metric('p95', 'ms', (w) => statsOf(httpOf(w), w.seconds).p95LatencyMs),
          metric('p99', 'ms', (w) => statsOf(httpOf(w), w.seconds).p99LatencyMs),
          metric('errorRate', '%', (w) =>
            httpOf(w).n ? statsOf(httpOf(w), w.seconds).errorRatePercent : null,
          ),
        ];
      case 'database':
        return [
          metric('queriesPerSec', '/s', (w) => {
            const n = mergedOf(w.perf, 'db.query').n;
            return n ? n / w.seconds : null;
          }),
          metric('avg', 'ms', (w) => meanOf(mergedOf(w.perf, 'db.query'))),
          metric('p95', 'ms', (w) => percentileOf(mergedOf(w.perf, 'db.query'), 95)),
          metric('p99', 'ms', (w) => percentileOf(mergedOf(w.perf, 'db.query'), 99)),
          metric('errors', '', (w) =>
            mergedOf(w.perf, 'db.query').n ? counterOf(w.perf, 'db.errors') : null,
          ),
          metric('poolUsed', '', (w) => gaugeWindow(w.perf, 'db.pool.used').avg),
          metric('poolWaiting', '', (w) => gaugeWindow(w.perf, 'db.pool.waiting').avg),
        ];
      case 'cache': {
        const ops = (w: Window) =>
          ['hit', 'miss', 'set', 'del'].reduce((a, k) => a + counterOf(w.perf, `cache.${k}`), 0);
        return [
          metric('opsPerSec', '/s', (w) => (ops(w) ? ops(w) / w.seconds : null)),
          metric('hitRate', '%', (w) => {
            const hits = counterOf(w.perf, 'cache.hit');
            const reads = hits + counterOf(w.perf, 'cache.miss');
            return reads ? (hits / reads) * 100 : null;
          }),
          metric('avg', 'ms', (w) => meanOf(mergedOf(w.perf, 'cache.op'))),
          metric('maxOp', 'ms', (w) => mergedOf(w.perf, 'cache.op').x),
        ];
      }
      case 'worker':
        return [
          metric('jobsPerMin', '/min', (w) => {
            const jobs = counterOf(w.perf, 'worker.completed') + counterOf(w.perf, 'worker.failed');
            return jobs ? jobs / minutes(w) : null;
          }),
          metric('avgJob', 'ms', (w) => meanOf(mergedOf(w.perf, 'worker.job'))),
          metric('p95Job', 'ms', (w) => percentileOf(mergedOf(w.perf, 'worker.job'), 95)),
          metric('failed', '', (w) => {
            const jobs = counterOf(w.perf, 'worker.completed') + counterOf(w.perf, 'worker.failed');
            return jobs ? counterOf(w.perf, 'worker.failed') : null;
          }),
          metric(
            'queueWaiting',
            '',
            (w) => gaugeWindow(w.perf, 'queue.waiting', { mode: 'max' }).avg,
          ),
        ];
      case 'messaging':
        return [
          metric('publishedPerMin', '/min', (w) => {
            const n = counterOf(w.perf, 'msg.published');
            return n ? n / minutes(w) : null;
          }),
          metric(
            'queueWaiting',
            '',
            (w) => gaugeWindow(w.perf, 'queue.waiting', { mode: 'max' }).avg,
          ),
          metric(
            'queueActive',
            '',
            (w) => gaugeWindow(w.perf, 'queue.active', { mode: 'max' }).avg,
          ),
          metric(
            'queueDelayed',
            '',
            (w) => gaugeWindow(w.perf, 'queue.delayed', { mode: 'max' }).avg,
          ),
        ];
    }
  }

  // ─── Series ───────────────────────────────────────────────────────────────

  private groups(win: Window, now: number): Group[] {
    const tierSec = TELEMETRY_TIERS[win.tier].seconds;
    const size = Math.max(1, Math.ceil(win.perf.length / MAX_POINTS));
    const groups: Group[] = [];
    for (let i = 0; i < win.perf.length; i += size) {
      const perf = win.perf.slice(i, i + size);
      const http = win.http.slice(i, i + size).reduce((acc, b) => {
        for (const agg of b.endpoints.values()) mergeAgg(acc, agg);
        return acc;
      }, emptyAgg());
      const start = perf[0]!.start;
      // Nhóm cuối đang diễn ra: chia theo thời gian đã trôi qua.
      const seconds = Math.max(1, Math.min(perf.length * tierSec, (now - start) / 1000));
      groups.push({ t: start, perf, http, seconds });
    }
    return groups;
  }

  private seriesFor(
    metric: TimeseriesMetric,
    groups: Group[],
    names: Map<string, string>,
  ): SeriesDef[] {
    const label = (id: string) => this.i18n.t(`performance.series.${id}`);
    const runtimeIds = [...LONG_RUNNING_RUNTIMES];
    const build = (
      id: string,
      lbl: string,
      unit: string,
      value: (g: Group) => number | null,
    ): SeriesDef => ({
      id,
      label: lbl,
      unit,
      points: groups
        .map((g) => ({ t: g.t, value: value(g) }))
        .filter(
          (p): p is { t: number; value: number } => p.value !== null && Number.isFinite(p.value),
        )
        .map((p) => ({ t: p.t, value: round(p.value, 3) })),
    });
    const gaugeAvg = (g: Group, m: string, opts: GaugeOptions) =>
      avgOfNumbers(g.perf.map((b) => gaugeOf(b, m, opts)).filter((v): v is number => v !== null));
    const perRuntime = (m: string, unit: string, mode: GaugeOptions['mode'] = 'sum') =>
      runtimeIds.map((id) =>
        build(id, names.get(id) ?? id, unit, (g) => gaugeAvg(g, m, { runtime: id, mode })),
      );
    const withTotal = (m: string, unit: string) => {
      const parts = perRuntime(m, unit);
      const total = build('total', label('total'), unit, (g) =>
        sum(runtimeIds.map((id) => gaugeAvg(g, m, { runtime: id }))),
      );
      return [total, ...parts];
    };
    const ops = (g: Group) =>
      ['hit', 'miss', 'set', 'del'].reduce((a, k) => a + counterOf(g.perf, `cache.${k}`), 0);

    let defs: SeriesDef[];
    switch (metric) {
      case 'latency':
        defs = [95, 50, 99].map((p) =>
          build(`p${p}`, `P${p}`, 'ms', (g) =>
            g.http.n ? histogramPercentile(g.http.hist, p) : null,
          ),
        );
        break;
      case 'throughput':
        defs = [
          build('http', label('http'), '/s', (g) => g.http.n / g.seconds),
          build('db', label('db'), '/s', (g) => {
            const n = mergedOf(g.perf, 'db.query').n;
            return n ? n / g.seconds : this.dbState === 'active' ? 0 : null;
          }),
          build('cache', label('cache'), '/s', (g) => (ops(g) ? ops(g) / g.seconds : null)),
          build('jobs', label('jobs'), '/s', (g) => {
            const n = counterOf(g.perf, 'worker.completed') + counterOf(g.perf, 'worker.failed');
            return n || this.hasRuntime(g.perf, 'worker') ? n / g.seconds : null;
          }),
        ];
        break;
      case 'errors':
        defs = [
          build('api', label('api5xx'), '%', (g) =>
            g.http.n ? statsOf(g.http, g.seconds).errorRatePercent : null,
          ),
          build('db', label('dbErrors'), '%', (g) => {
            const n = mergedOf(g.perf, 'db.query').n;
            return n ? (counterOf(g.perf, 'db.errors') / n) * 100 : null;
          }),
          build('worker', label('jobFailures'), '%', (g) => {
            const failed = counterOf(g.perf, 'worker.failed');
            const jobs = failed + counterOf(g.perf, 'worker.completed');
            return jobs ? (failed / jobs) * 100 : null;
          }),
        ];
        break;
      case 'cpu':
        defs = withTotal('rt.cpu', '%');
        break;
      case 'memory':
        defs = withTotal('rt.rss', 'MB');
        break;
      case 'eventLoop':
        defs = perRuntime('rt.elP99', 'ms', 'max');
        break;
      case 'gc':
        defs = [
          build('total', label('total'), 'ms/min', (g) =>
            this.hasRuntime(g.perf) ? counterOf(g.perf, 'rt.gcPause') / (g.seconds / 60) : null,
          ),
          ...runtimeIds.map((id) =>
            build(id, names.get(id) ?? id, 'ms/min', (g) =>
              this.hasRuntime(g.perf, id)
                ? counterOf(g.perf, 'rt.gcPause', id) / (g.seconds / 60)
                : null,
            ),
          ),
        ];
        break;
      case 'dbLatency':
        defs = [
          build('p95', 'P95', 'ms', (g) => percentileOf(mergedOf(g.perf, 'db.query'), 95)),
          build('avg', label('avg'), 'ms', (g) => meanOf(mergedOf(g.perf, 'db.query'))),
        ];
        break;
      case 'queueDepth':
        defs = [
          build('waiting', label('waiting'), 'jobs', (g) =>
            gaugeAvg(g, 'queue.waiting', { mode: 'max' }),
          ),
          build('active', label('active'), 'jobs', (g) =>
            gaugeAvg(g, 'queue.active', { mode: 'max' }),
          ),
        ];
        break;
    }
    // Giữ series chính (đầu tiên) kể cả khi rỗng để UI hiện trạng thái trống đúng chỗ.
    return defs.filter((d, i) => i === 0 || d.points.length > 0);
  }

  private unitOf(metric: TimeseriesMetric): string {
    const units: Record<TimeseriesMetric, string> = {
      latency: 'ms',
      throughput: '/s',
      errors: '%',
      cpu: '%',
      memory: 'MB',
      eventLoop: 'ms',
      gc: 'ms/min',
      dbLatency: 'ms',
      queueDepth: 'jobs',
    };
    return units[metric];
  }

  private async markers(from: number, now: number): Promise<PerfMarkerDto[]> {
    const [perfEvents, runtimeEvents] = await Promise.all([
      this.store.events().catch(() => [] as StoredPerfEvent[]),
      this.runtimes.getEvents(undefined, 500),
    ]);
    const out: PerfMarkerDto[] = [];
    for (const e of runtimeEvents) {
      const t = Date.parse(e.at);
      if (t < from || t > now) continue;
      const kind =
        e.type === 'started'
          ? 'restart'
          : e.type === 'crashed'
            ? 'crash'
            : e.type === 'stopped'
              ? 'stop'
              : null;
      if (!kind) continue;
      out.push({
        t,
        kind,
        label: `${e.runtimeName}: ${e.message}`,
        severity: kind === 'crash' ? 'critical' : kind === 'stop' ? 'warning' : 'info',
      });
    }
    for (const e of perfEvents) {
      if (e.at < from || e.at > now || e.type === 'escalated') continue;
      out.push({
        t: e.at,
        kind: e.type === 'recovered' ? 'recovered' : 'bottleneck',
        label: `${this.ruleTitle(e.rule, e.runtime)} — ${this.eventMessage(e)}`,
        severity: e.type === 'recovered' ? 'success' : e.severity,
      });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Dữ liệu của [fromMs, toMs] ở tầng mịn nhất còn giữ (hoặc tầng chỉ định). `null` khi vượt thời gian lưu. */
  private async window(
    fromMs: number,
    toMs: number,
    now: number,
    forceTier?: TelemetryTier,
  ): Promise<Window | null> {
    const tier = forceTier ?? tierCovering(fromMs, now);
    if (!tier) return null;
    const retention = TELEMETRY_TIERS.h1.ttlSec * 1000;
    const [perfInstances, httpInstances] = await Promise.all([
      this.store
        .instances(fromMs - TELEMETRY_TIERS[tier].seconds * 1000)
        .catch(() => [] as string[]),
      this.traffic.instances(Math.max(fromMs, now - retention)).catch(() => [] as string[]),
    ]);
    const [perf, http] = await Promise.all([
      this.store.buckets(tier, fromMs, toMs, perfInstances),
      this.traffic.buckets(tier, fromMs, toMs, httpInstances),
    ]);
    return { tier, perf, http, seconds: Math.max(1, (Math.min(toMs, now) - fromMs) / 1000) };
  }

  private hasRuntime(perf: readonly MetricBucket[], runtime?: string): boolean {
    return perf.some((b) =>
      [...b.byInstance.keys()].some((i) => !runtime || i.startsWith(`${runtime}@`)),
    );
  }

  private levelOf(
    bottlenecks: BottleneckDto[],
    current: Window | null,
    summaries: RuntimeSummaryDto[],
  ): PerformanceOverviewDto['status']['level'] {
    const hasData =
      summaries.some((s) => s.resources !== null) ||
      (current !== null &&
        (current.http.some((b) => b.endpoints.size > 0) || this.hasRuntime(current.perf)));
    if (!hasData) return 'unknown';
    if (bottlenecks.some((b) => b.severity === 'critical')) return 'critical';
    return bottlenecks.length ? 'degraded' : 'normal';
  }

  private runtimeName(id: string): string {
    return this.i18n.t(`runtime.name.${id}`);
  }

  private componentName(component: ComponentId | 'runtime', runtime: string | null): string {
    return component === 'runtime' && runtime
      ? this.runtimeName(runtime)
      : this.i18n.t(`performance.component.${component}`);
  }

  private ruleTitle(rule: string, runtime: string | null): string {
    return this.i18n.t(`performance.rule.${rule}.title`, {
      runtime: runtime ? this.runtimeName(runtime) : '',
    });
  }

  private eventMessage(e: StoredPerfEvent): string {
    if (e.type === 'recovered')
      return this.i18n.t('performance.event.recovered', {
        minutes: Math.max(1, Math.round((e.durationMs ?? 0) / MINUTE)),
      });
    return this.i18n.t(`performance.event.${e.type}`, {
      value: e.value,
      threshold: e.threshold,
      unit: e.unit,
    });
  }

  private targetOf(rule: string, runtime: string | null): string {
    if (rule === 'API_ERROR_RATE') return 'http-traffic/errors';
    if (rule.startsWith('API_')) return 'http-traffic/endpoints?sort=p95';
    if (rule.startsWith('DB_')) return 'performance/components/database';
    if (rule === 'QUEUE_BACKLOG' || rule === 'WORKER_FAILURES') return 'runtimes/worker';
    return runtime ? `runtimes/${runtime}` : 'runtimes';
  }

  private assertAvailable(): void {
    if (!this.store.isAvailable()) throw new PerformanceTelemetryUnavailableException();
  }
}
