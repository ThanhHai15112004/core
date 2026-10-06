/** Kiểu dữ liệu trang Worker & Queue (khớp `/ops/workers/*`, `/ops/queues/*`). */

export type WorkerRange = '15m' | '1h' | '6h' | '24h';
export type WorkerMetric = 'throughput' | 'waiting' | 'duration' | 'failures' | 'retries';
export type WorkerTab = 'overview' | 'workers' | 'queues' | 'failures' | 'delayed' | 'events' | 'configuration';
export type QueueDetailTab = 'overview' | 'jobs' | 'workers' | 'failures' | 'metrics' | 'configuration';
export type WorkerSeverity = 'warning' | 'critical' | 'info';
export type BackgroundStatus = 'healthy' | 'degraded' | 'down' | 'paused' | 'recovering' | 'unknown';
export type QueueStatus = 'healthy' | 'backlog' | 'high_failure' | 'slow' | 'paused' | 'no_consumer' | 'idle';
export type WorkerInstanceStatus = 'healthy' | 'high_memory' | 'high_cpu' | 'busy' | 'paused';
export type JobState = 'waiting' | 'prioritized' | 'active' | 'delayed' | 'retrying' | 'completed' | 'failed';
export type DelayReason = 'retry' | 'repeat' | 'delay';
export type QueueCapability = 'workers' | 'jobs' | 'delayed' | 'priority' | 'stalled' | 'pause' | 'retryFailed' | 'drain';
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export type Section<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

export interface QueueProviderInfo {
  driver: string;
  product: string;
  backend: string;
  endpoint: string;
  prefix: string;
}

export interface WorkerAlert {
  id: string;
  rule: string;
  severity: WorkerSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string;
  tab: WorkerTab;
  queue: string | null;
}

export interface BackgroundHealth {
  status: BackgroundStatus;
  reasons: { code: string; message: string; queue: string | null }[];
  state: ConnectionState;
  pingMs: number | null;
  lastError: string | null;
  lastWorkerSeenAt: string | null;
}

export interface RateBalance {
  incomingPerMin: number | null;
  processingPerMin: number | null;
  diffPerMin: number | null;
  state: 'growing' | 'draining' | 'stable' | null;
}

export interface DurationStats {
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface WaitStats {
  avgMs: number | null;
  p95Ms: number | null;
  oldestSec: number | null;
  oldestJobId: string | null;
}

export interface Concurrency {
  configured: number;
  active: number;
  available: number;
  utilizationPercent: number | null;
}

export interface QueueRow {
  name: string;
  status: QueueStatus;
  waiting: number;
  prioritized: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
  workers: number | null;
  concurrency: number;
  incomingPerMin: number | null;
  processingPerMin: number | null;
  growthPerMin: number | null;
  failureRatePercent: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  oldestWaitingSec: number | null;
  oldestWaitingId: string | null;
}

export interface WorkerRow {
  id: string;
  runtime: string | null;
  host: string | null;
  pid: number | null;
  status: WorkerInstanceStatus;
  active: number;
  concurrency: number;
  utilizationPercent: number | null;
  cpuPercent: number | null;
  memoryMb: number | null;
  memoryLimitMb: number | null;
  memoryPercent: number | null;
  startedAt: string;
  uptimeSec: number;
  queues: string[];
  processors: string[];
  paused: boolean;
  connections: number | null;
}

export interface JobRow {
  id: string;
  queue: string;
  name: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  priority: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  runAt: string | null;
  durationMs: number | null;
  waitMs: number | null;
  runningMs: number | null;
  error: string | null;
  correlationId: string | null;
  worker: string | null;
  stalledCount: number;
  delayReason: DelayReason | null;
}

export interface FailureReason {
  reason: string;
  count: number;
  queues: string[];
  lastAt: string | null;
  sampleJobId: string | null;
}

export interface WorkerSettings {
  pause: boolean;
  retryFailed: boolean;
  retryFailedMax: number;
  drain: boolean;
}

export interface WorkerReport {
  received: number;
  completed: number;
  failed: number;
  retried: number;
  successRatePercent: number | null;
  avgProcessingMs: number | null;
  p95ProcessingMs: number | null;
  peakBacklog: number | null;
}

export interface WorkerEvent {
  id: string;
  at: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  tab: WorkerTab | null;
  queue: string | null;
}

export interface WorkerStability {
  restartsToday: number;
  crashesToday: number;
  lastRestartAt: string | null;
  history: { at: string; reasonCode: string; reason: string; downtimeMs: number | null }[];
}

export interface WorkerOverview {
  generatedAt: string;
  range: WorkerRange;
  provider: QueueProviderInfo;
  environment: string;
  capabilities: QueueCapability[];
  health: BackgroundHealth;
  kpis: {
    workers: number;
    brokerWorkers: number | null;
    waiting: number | null;
    active: number | null;
    failed: number | null;
    delayed: number | null;
    retrying: number | null;
    throughputPerMin: number | null;
    avgDurationMs: number | null;
    failedInRange: number;
  };
  rates: RateBalance;
  processing: DurationStats;
  wait: WaitStats;
  concurrency: Concurrency | null;
  queues: Section<QueueRow[]>;
  workers: WorkerRow[];
  distribution: { queue: string; completed: number; percent: number }[];
  failures: { failed: number; failureRatePercent: number | null; retried: number; recovered: number; exhausted: number; stalled: number | null };
  stability: WorkerStability;
  alerts: WorkerAlert[];
  events: WorkerEvent[];
  report: { today: WorkerReport; yesterday: WorkerReport };
  settings: WorkerSettings;
}

export interface WorkerSeries {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface WorkerMetrics {
  metric: WorkerMetric;
  range: WorkerRange;
  queue: string | null;
  resolutionSec: number | null;
  unit: string;
  series: WorkerSeries[];
}

export interface WorkersList {
  workers: WorkerRow[];
  brokerWorkers: number | null;
  concurrency: Concurrency | null;
  stability: WorkerStability;
  unconsumed: string[];
}

export interface WorkerDetail {
  worker: WorkerRow;
  distribution: { queue: string; completed: number; failed: number; percent: number }[];
  processing: DurationStats;
  runtimeStatus: string | null;
  runtimeAlerts: { key: string; value: number; threshold: number }[];
  stability: WorkerStability;
}

export interface QueuesList {
  range: WorkerRange;
  queues: Section<QueueRow[]>;
  thresholds: { backlogWarn: number; backlogCrit: number };
}

export interface QueueJobDefaults {
  attempts: number;
  backoff: { type: string; delayMs: number } | null;
  removeOnComplete: string | null;
  removeOnFail: string | null;
}

export interface QueueDetail {
  range: WorkerRange;
  queue: QueueRow;
  wait: WaitStats;
  processing: DurationStats;
  rates: RateBalance;
  capacity: { waiting: number; warn: number; crit: number; percentOfWarn: number };
  concurrency: Concurrency | null;
  workers: WorkerRow[];
  brokerWorkers: { name: string | null; addr: string | null; ageSec: number | null; idleSec: number | null }[] | null;
  recentJobs: Section<JobRow[]>;
  failures: { failed: number; retried: number; exhausted: number; failureRatePercent: number | null };
  defaults: QueueJobDefaults;
  alerts: WorkerAlert[];
  settings: WorkerSettings;
}

export interface QueueJobs {
  queue: string;
  states: JobState[];
  jobs: Section<JobRow[]>;
  limit: number;
}

export interface Failures {
  range: WorkerRange;
  queue: string | null;
  stats: {
    failed: number;
    failureRatePercent: number | null;
    retryingNow: number | null;
    retried: number;
    recovered: number;
    exhausted: number;
    deadLetter: number | null;
    failedToday: number;
    retriedToday: number;
    recoveredToday: number;
    exhaustedToday: number;
  };
  byQueue: { queue: string; failures: number; failed: number }[];
  reasons: FailureReason[];
  sampled: number;
  retrying: Section<JobRow[]>;
  failedJobs: Section<JobRow[]>;
  stalled: Section<JobRow[]>;
  spike: { recentRatePercent: number; baselineRatePercent: number | null; sinceMin: number } | null;
  alerts: WorkerAlert[];
  settings: WorkerSettings;
}

export interface Delayed {
  total: number | null;
  nextDueAt: string | null;
  oldestSec: number | null;
  byReason: Record<DelayReason, number>;
  jobs: Section<JobRow[]>;
}

export interface WorkerOperation {
  id: string;
  at: string;
  action: 'pause' | 'resume' | 'retry_failed' | 'drain';
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

export interface QueueRetryResult {
  operation: WorkerOperation;
  requested: number;
  retried: number;
}

export interface WorkerConfig {
  items: { key: string; value: string | number | boolean | null; group: string }[];
}
