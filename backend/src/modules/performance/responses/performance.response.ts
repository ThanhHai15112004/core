import type { SlowQueryRecord } from '@packages/telemetry/index.js';
import type { RuntimeStatus } from '@modules/runtimes/index.js';

export type PerfRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d';
export type PerfLevel = 'normal' | 'degraded' | 'critical' | 'unknown';
export type PerfSeverity = 'warning' | 'critical';
export type ComponentId = 'api' | 'database' | 'cache' | 'worker' | 'messaging';
export type ComponentStatus = 'normal' | 'degraded' | 'critical' | 'idle' | 'unavailable';
export type BaselineMode = 'previous' | 'yesterday' | 'lastWeek';

export type RuleKey =
  | 'API_LATENCY_P95'
  | 'API_LATENCY_P99'
  | 'API_ERROR_RATE'
  | 'CPU_HIGH'
  | 'MEMORY_HIGH'
  | 'MEMORY_GROWTH'
  | 'EVENT_LOOP_LAG'
  | 'GC_PRESSURE'
  | 'DB_LATENCY'
  | 'DB_POOL'
  | 'QUEUE_BACKLOG'
  | 'WORKER_FAILURES';

/** Giá trị hiện tại so với khoảng liền trước cùng độ dài. */
export interface KpiDto {
  value: number | null;
  previous: number | null;
  /** % thay đổi; `null` khi thiếu một trong hai. */
  changePercent: number | null;
}

export interface BottleneckDto {
  /** `<rule>` hoặc `<rule>:<runtime>` — ổn định giữa các lần đánh giá. */
  id: string;
  rule: RuleKey;
  component: ComponentId | 'runtime';
  runtime: string | null;
  severity: PerfSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  /** Giá trị trong 60 phút trước cửa sổ hiện tại; `null` khi không có dữ liệu. */
  baseline: number | null;
  /** ISO — thời điểm bắt đầu vi phạm do Performance Monitor ghi; `null` khi chưa ghi nhận. */
  since: string | null;
  /** Endpoint bị ảnh hưởng nhiều nhất (theo thời gian DB hoặc P95). */
  impact: { routeId: string; method: string; route: string; valueMs: number }[];
  /** Section của console để drill-down, vd `http-traffic/endpoints?sort=p95`. */
  target: string;
}

export interface RuntimeResourceDto {
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
  /** Xu hướng RSS trong cửa sổ theo dõi; `null` khi chưa đủ dữ liệu. */
  memoryTrend: { windowMin: number; changeMb: number; growing: boolean } | null;
}

export interface ComponentRowDto {
  id: ComponentId;
  status: ComponentStatus;
  /** Lý do khi `unavailable`/`idle`/có vấn đề (đã dịch). */
  note: string | null;
  load: number | null;
  loadUnit: string;
  latencyMs: number | null;
  latencyKind: 'p95' | 'avg';
  errorPercent: number | null;
  /** Section để mở màn chuyên sâu. */
  target: string;
}

export interface BreakdownPhaseDto {
  phase: 'route' | 'guard' | 'app' | 'db' | 'cache' | 'send';
  avgMs: number;
  percent: number;
}

export interface BreakdownDto {
  /** Số request đi tới handler được dùng để tính. */
  requests: number;
  avgTotalMs: number | null;
  phases: BreakdownPhaseDto[];
  dbQueriesPerRequest: number | null;
}

export interface BudgetDto {
  key: 'apiP95Ms' | 'apiP99Ms' | 'errorRatePercent' | 'cpuPercent' | 'memoryPercent';
  target: number;
  current: number | null;
  unit: string;
  /** `null` khi không có dữ liệu. */
  met: boolean | null;
}

export interface CapacityDto {
  key: 'cpu' | 'memory' | 'dbPool' | 'workerConcurrency';
  used: number | null;
  limit: number | null;
  percent: number | null;
  unit: string;
  /** Runtime quyết định giá trị (vd. memory cao nhất). */
  runtime: string | null;
}

export interface ThroughputDto {
  httpPerSec: number | null;
  dbQueriesPerSec: number | null;
  cacheOpsPerSec: number | null;
  jobsPerMin: number | null;
  messagesPerMin: number | null;
  queueWaiting: number | null;
}

export interface PerformanceOverviewDto {
  range: PerfRange;
  generatedAt: string;
  /** `database`: đã kết nối database thật hay chưa (chưa kết nối → không có số liệu query). */
  telemetry: { performance: boolean; traffic: boolean; database: 'active' | 'unavailable' };
  status: { level: PerfLevel; reasons: string[] };
  kpis: {
    apiP95Ms: KpiDto;
    throughputPerSec: KpiDto;
    cpuPercent: KpiDto;
    memoryMb: KpiDto & { percent: number | null; limitMb: number | null };
    errorRatePercent: KpiDto;
    bottlenecks: { count: number; components: string[] };
  };
  resources: RuntimeResourceDto[];
  bottlenecks: BottleneckDto[];
  components: ComponentRowDto[];
  breakdown: BreakdownDto;
  budgets: BudgetDto[];
  capacity: CapacityDto[];
  throughput: ThroughputDto;
  settings: {
    resolutionSec: number | null;
    evaluateSec: number;
    windowMin: number;
    /** Ngưỡng cảnh báo CPU/bộ nhớ theo runtime (tô màu thanh sử dụng). */
    thresholds: { cpuPercent: number; memoryPercent: number };
  };
}

export type TimeseriesMetric =
  | 'latency'
  | 'throughput'
  | 'errors'
  | 'cpu'
  | 'memory'
  | 'eventLoop'
  | 'gc'
  | 'dbLatency'
  | 'queueDepth';

export interface SeriesPointDto {
  /** epoch ms */
  t: number;
  value: number;
}

export interface PerfSeriesDto {
  id: string;
  label: string;
  unit: string;
  axis: 'left' | 'right';
  kind: 'main' | 'compare' | 'baseline';
  points: SeriesPointDto[];
}

export interface PerfMarkerDto {
  /** epoch ms */
  t: number;
  kind: 'restart' | 'crash' | 'stop' | 'bottleneck' | 'recovered';
  label: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
}

export interface PerfTimeseriesDto {
  metric: TimeseriesMetric;
  compare: TimeseriesMetric | null;
  baseline: BaselineMode | null;
  range: PerfRange;
  resolutionSec: number | null;
  unit: string;
  series: PerfSeriesDto[];
  markers: PerfMarkerDto[];
  /** Thống kê của series chính (đầu tiên). */
  stats: { current: number | null; avg: number | null; peak: number | null; peakAt: string | null };
  /** Baseline không có vì vượt thời gian lưu. */
  baselineUnavailable: boolean;
}

export interface PerfEventDto {
  id: string;
  at: string;
  source: 'performance' | 'runtime';
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  title: string;
  message: string;
  target: string | null;
}

export interface ComponentMetricDto {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  baseline: number | null;
  changePercent: number | null;
}

export interface ComponentDetailDto {
  id: ComponentId;
  name: string;
  status: ComponentStatus;
  note: string | null;
  range: PerfRange;
  metrics: ComponentMetricDto[];
  bottlenecks: BottleneckDto[];
  /** API: endpoint chậm nhất theo P95. */
  endpoints: {
    routeId: string;
    method: string;
    route: string;
    p95Ms: number | null;
    requests: number;
  }[];
  /** Database: slow query gần nhất (SQL đã chuẩn hoá, không có params). */
  slowQueries: SlowQueryRecord[];
  target: string;
}
