import type { RuntimeStatus } from './runtime.types';

export type PerfRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d';
export type PerfLevel = 'normal' | 'degraded' | 'critical' | 'unknown';
export type PerfSeverity = 'warning' | 'critical';
export type ComponentId = 'api' | 'database' | 'cache' | 'worker' | 'messaging';
export type ComponentStatus = 'normal' | 'degraded' | 'critical' | 'idle' | 'unavailable';
export type BaselineMode = 'previous' | 'yesterday' | 'lastWeek';
export type PerfMetric =
  | 'latency'
  | 'throughput'
  | 'errors'
  | 'cpu'
  | 'memory'
  | 'eventLoop'
  | 'gc'
  | 'dbLatency'
  | 'queueDepth';

export interface Kpi {
  value: number | null;
  previous: number | null;
  changePercent: number | null;
}

export interface Bottleneck {
  id: string;
  rule: string;
  component: ComponentId | 'runtime';
  runtime: string | null;
  severity: PerfSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  baseline: number | null;
  since: string | null;
  impact: { routeId: string; method: string; route: string; valueMs: number }[];
  target: string;
}

export interface RuntimeResource {
  id: string;
  name: string;
  status: RuntimeStatus;
  instances: number;
  cpuPercent: number | null;
  cpuAvgPercent: number | null;
  cpuPeakPercent: number | null;
  cpuPeakAt: string | null;
  rssMb: number | null;
  heapUsedMb: number | null;
  heapTotalMb: number | null;
  externalMb: number | null;
  memoryLimitMb: number | null;
  memoryLimitSource: 'cgroup' | 'v8-heap' | null;
  memoryPercent: number | null;
  eventLoopP99Ms: number | null;
  eventLoopPeakMs: number | null;
  gcPerMin: number | null;
  gcPauseMsPerMin: number | null;
  gcMaxPauseMs: number | null;
  memoryTrend: { windowMin: number; changeMb: number; growing: boolean } | null;
}

export interface ComponentRow {
  id: ComponentId;
  status: ComponentStatus;
  note: string | null;
  load: number | null;
  loadUnit: string;
  latencyMs: number | null;
  latencyKind: 'p95' | 'avg';
  errorPercent: number | null;
  target: string;
}

export type BreakdownPhase = 'route' | 'guard' | 'app' | 'db' | 'cache' | 'send';

export interface Breakdown {
  requests: number;
  avgTotalMs: number | null;
  phases: { phase: BreakdownPhase; avgMs: number; percent: number }[];
  dbQueriesPerRequest: number | null;
}

export interface Budget {
  key: 'apiP95Ms' | 'apiP99Ms' | 'errorRatePercent' | 'cpuPercent' | 'memoryPercent';
  target: number;
  current: number | null;
  unit: string;
  met: boolean | null;
}

export interface Capacity {
  key: 'cpu' | 'memory' | 'dbPool' | 'workerConcurrency';
  used: number | null;
  limit: number | null;
  percent: number | null;
  unit: string;
  runtime: string | null;
}

export interface Throughput {
  httpPerSec: number | null;
  dbQueriesPerSec: number | null;
  cacheOpsPerSec: number | null;
  jobsPerMin: number | null;
  messagesPerMin: number | null;
  queueWaiting: number | null;
}

export interface PerformanceOverview {
  range: PerfRange;
  generatedAt: string;
  telemetry: { performance: boolean; traffic: boolean; database: 'active' | 'unavailable' };
  status: { level: PerfLevel; reasons: string[] };
  kpis: {
    apiP95Ms: Kpi;
    throughputPerSec: Kpi;
    cpuPercent: Kpi;
    memoryMb: Kpi & { percent: number | null; limitMb: number | null };
    errorRatePercent: Kpi;
    bottlenecks: { count: number; components: string[] };
  };
  resources: RuntimeResource[];
  bottlenecks: Bottleneck[];
  components: ComponentRow[];
  breakdown: Breakdown;
  budgets: Budget[];
  capacity: Capacity[];
  throughput: Throughput;
  settings: {
    resolutionSec: number | null;
    evaluateSec: number;
    windowMin: number;
    thresholds: { cpuPercent: number; memoryPercent: number };
  };
}

export interface PerfSeries {
  id: string;
  label: string;
  unit: string;
  axis: 'left' | 'right';
  kind: 'main' | 'compare' | 'baseline';
  points: { t: number; value: number }[];
}

export interface PerfMarker {
  t: number;
  kind: 'restart' | 'crash' | 'stop' | 'bottleneck' | 'recovered';
  label: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
}

export interface PerfTimeseries {
  metric: PerfMetric;
  compare: PerfMetric | null;
  baseline: BaselineMode | null;
  range: PerfRange;
  resolutionSec: number | null;
  unit: string;
  series: PerfSeries[];
  markers: PerfMarker[];
  stats: { current: number | null; avg: number | null; peak: number | null; peakAt: string | null };
  baselineUnavailable: boolean;
}

export interface PerfEvent {
  id: string;
  at: string;
  source: 'performance' | 'runtime';
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  title: string;
  message: string;
  target: string | null;
}

export interface SlowQuery {
  at: number;
  sql: string;
  durationMs: number;
  failed: boolean;
  instance: string;
  correlationId: string | null;
}

export interface ComponentDetail {
  id: ComponentId;
  name: string;
  status: ComponentStatus;
  note: string | null;
  range: PerfRange;
  metrics: { key: string; label: string; value: number | null; unit: string; baseline: number | null; changePercent: number | null }[];
  bottlenecks: Bottleneck[];
  endpoints: { routeId: string; method: string; route: string; p95Ms: number | null; requests: number }[];
  slowQueries: SlowQuery[];
  target: string;
}

export interface PerfFilters {
  range: PerfRange;
  metric: PerfMetric;
  compare?: PerfMetric;
  baseline?: BaselineMode;
}
