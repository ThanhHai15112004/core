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
  changePercent: number | null;
}

export interface Bottleneck {
  id: string;
  rule: string;
  component: ComponentId | 'runtime';
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
  rssMb: number | null;
  heapUsedMb: number | null;
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
}


export interface Breakdown {
  requests: number;
  avgTotalMs: number | null;
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
  telemetry: { database: 'active' | 'unavailable' };
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
  label: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
}

export interface PerfTimeseries {
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
  severity: 'info' | 'warning' | 'critical' | 'success';
  title: string;
  message: string;
  target: string | null;
}

export interface ComponentDetail {
  status: ComponentStatus;
  note: string | null;
  metrics: { key: string; label: string; value: number | null; unit: string; baseline: number | null }[];
  bottlenecks: Bottleneck[];
  endpoints: { routeId: string; method: string; route: string; p95Ms: number | null; requests: number }[];
  target: string;
}

export interface PerfFilters {
  range: PerfRange;
  metric: PerfMetric;
  compare?: PerfMetric;
  baseline?: BaselineMode;
}
