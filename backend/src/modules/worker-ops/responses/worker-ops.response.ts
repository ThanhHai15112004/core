import type { MessagingConnectionState } from '@packages/messaging/index.js';
import type {
  DelayReason,
  JobState,
  QueueCapability,
  QueueEventType,
  QueueJobDefaults,
  QueueOperationAction,
  QueueProviderInfo,
  QueueSection,
} from '@packages/queue/index.js';

export type WorkerRange = '15m' | '1h' | '6h' | '24h';
export type WorkerMetric = 'throughput' | 'waiting' | 'duration' | 'failures' | 'retries';
export type WorkerSeverity = 'warning' | 'critical' | 'info';
/** Trạng thái tổng của background processing. */
export type BackgroundStatus =
  'healthy' | 'degraded' | 'down' | 'paused' | 'recovering' | 'unknown';
export type QueueStatus =
  'healthy' | 'backlog' | 'high_failure' | 'slow' | 'paused' | 'no_consumer' | 'idle';
export type WorkerInstanceStatus = 'healthy' | 'high_memory' | 'high_cpu' | 'busy' | 'paused';
export type SectionDto<T> = QueueSection<T>;

export interface WorkerAlertDto {
  id: string;
  rule: string;
  severity: WorkerSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string;
  tab: string;
  /** Queue liên quan (mở thẳng Queue Detail); null = cảnh báo toàn cục. */
  queue: string | null;
}

export interface BackgroundHealthDto {
  status: BackgroundStatus;
  /** Lý do ngắn gọn, mỗi dòng một vấn đề (queue nào, bao nhiêu). */
  reasons: { code: string; message: string; queue: string | null }[];
  state: MessagingConnectionState;
  pingMs: number | null;
  lastError: string | null;
  /** Lần gần nhất thấy worker kết nối (runtime worker báo heartbeat). */
  lastWorkerSeenAt: string | null;
}

export interface RateBalanceDto {
  incomingPerMin: number | null;
  processingPerMin: number | null;
  /** incoming − processing (job/phút); dương = queue đang dồn. */
  diffPerMin: number | null;
  state: 'growing' | 'draining' | 'stable' | null;
}

export interface DurationStatsDto {
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface WaitStatsDto {
  avgMs: number | null;
  p95Ms: number | null;
  /** Job đang chờ lâu nhất (giây) — tính từ lúc tạo. */
  oldestSec: number | null;
  oldestJobId: string | null;
}

export interface ConcurrencyDto {
  /** Tổng concurrency cấu hình của các worker instance đang chạy. */
  configured: number;
  active: number;
  available: number;
  utilizationPercent: number | null;
}

export interface QueueRowDto {
  name: string;
  status: QueueStatus;
  waiting: number;
  prioritized: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
  /** Kết nối worker trên broker; null = provider không cho biết. */
  workers: number | null;
  concurrency: number;
  incomingPerMin: number | null;
  processingPerMin: number | null;
  /** incoming − processing trong cửa sổ (job/phút). */
  growthPerMin: number | null;
  failureRatePercent: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  oldestWaitingSec: number | null;
  oldestWaitingId: string | null;
}

export interface WorkerRowDto {
  /** Instance id (`worker@host:pid`). */
  id: string;
  runtime: string | null;
  host: string | null;
  pid: number | null;
  status: WorkerInstanceStatus;
  /** Job đang xử lý trong instance này. */
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
  /** Kết nối broker của instance (addr) nếu khớp được. */
  connections: number | null;
}

export interface JobRowDto {
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
  /** active: đã chạy bao lâu. */
  runningMs: number | null;
  error: string | null;
  correlationId: string | null;
  worker: string | null;
  stalledCount: number;
  delayReason: DelayReason | null;
}

export interface FailureReasonDto {
  reason: string;
  count: number;
  queues: string[];
  lastAt: string | null;
  sampleJobId: string | null;
}

export interface WorkerSettingsDto {
  pause: boolean;
  retryFailed: boolean;
  retryFailedMax: number;
  drain: boolean;
}

export interface WorkerReportDto {
  received: number;
  completed: number;
  failed: number;
  retried: number;
  successRatePercent: number | null;
  avgProcessingMs: number | null;
  p95ProcessingMs: number | null;
  peakBacklog: number | null;
}

export interface WorkerEventDto {
  id: string;
  at: string;
  type: QueueEventType | 'worker_started' | 'worker_stopped' | 'worker_crashed';
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  tab: string | null;
  queue: string | null;
}

export interface WorkerStabilityDto {
  restartsToday: number;
  crashesToday: number;
  lastRestartAt: string | null;
  history: { at: string; reasonCode: string; reason: string; downtimeMs: number | null }[];
}

export interface WorkerOverviewDto {
  generatedAt: string;
  range: WorkerRange;
  provider: QueueProviderInfo;
  environment: string;
  capabilities: QueueCapability[];
  health: BackgroundHealthDto;
  kpis: {
    /** Instance worker đang chạy (tự báo) / kết nối worker trên broker. */
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
  rates: RateBalanceDto;
  processing: DurationStatsDto;
  wait: WaitStatsDto;
  concurrency: ConcurrencyDto | null;
  queues: SectionDto<QueueRowDto[]>;
  workers: WorkerRowDto[];
  distribution: { queue: string; completed: number; percent: number }[];
  failures: {
    failed: number;
    failureRatePercent: number | null;
    retried: number;
    recovered: number;
    exhausted: number;
    stalled: number | null;
  };
  stability: WorkerStabilityDto;
  alerts: WorkerAlertDto[];
  events: WorkerEventDto[];
  report: { today: WorkerReportDto; yesterday: WorkerReportDto };
  settings: WorkerSettingsDto;
}

export interface WorkerSeriesDto {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface WorkerMetricsDto {
  metric: WorkerMetric;
  range: WorkerRange;
  queue: string | null;
  resolutionSec: number | null;
  unit: string;
  series: WorkerSeriesDto[];
}

export interface WorkersListDto {
  workers: WorkerRowDto[];
  brokerWorkers: number | null;
  concurrency: ConcurrencyDto | null;
  stability: WorkerStabilityDto;
  /** Queue có job chờ nhưng không có worker nào tiêu thụ. */
  unconsumed: string[];
}

export interface WorkerDetailDto {
  worker: WorkerRowDto;
  distribution: { queue: string; completed: number; failed: number; percent: number }[];
  processing: DurationStatsDto;
  runtimeStatus: string | null;
  runtimeAlerts: { key: string; value: number; threshold: number }[];
  stability: WorkerStabilityDto;
}

export interface QueuesListDto {
  range: WorkerRange;
  queues: SectionDto<QueueRowDto[]>;
  thresholds: { backlogWarn: number; backlogCrit: number };
}

export interface QueueDetailDto {
  range: WorkerRange;
  queue: QueueRowDto;
  wait: WaitStatsDto;
  processing: DurationStatsDto;
  rates: RateBalanceDto;
  capacity: { waiting: number; warn: number; crit: number; percentOfWarn: number };
  concurrency: ConcurrencyDto | null;
  workers: WorkerRowDto[];
  brokerWorkers:
    | { name: string | null; addr: string | null; ageSec: number | null; idleSec: number | null }[]
    | null;
  recentJobs: SectionDto<JobRowDto[]>;
  failures: {
    failed: number;
    retried: number;
    exhausted: number;
    failureRatePercent: number | null;
  };
  defaults: QueueJobDefaults;
  alerts: WorkerAlertDto[];
  settings: WorkerSettingsDto;
}

export interface QueueJobsDto {
  queue: string;
  states: JobState[];
  jobs: SectionDto<JobRowDto[]>;
  limit: number;
}

export interface FailuresDto {
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
  reasons: FailureReasonDto[];
  /** Số job đã lấy mẫu để gộp lý do lỗi. */
  sampled: number;
  retrying: SectionDto<JobRowDto[]>;
  failedJobs: SectionDto<JobRowDto[]>;
  stalled: SectionDto<JobRowDto[]>;
  spike: { recentRatePercent: number; baselineRatePercent: number | null; sinceMin: number } | null;
  alerts: WorkerAlertDto[];
  settings: WorkerSettingsDto;
}

export interface DelayedDto {
  total: number | null;
  nextDueAt: string | null;
  oldestSec: number | null;
  byReason: Record<DelayReason, number>;
  jobs: SectionDto<JobRowDto[]>;
}

export interface WorkerOperationDto {
  id: string;
  at: string;
  action: QueueOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

export interface QueueRetryDto {
  operation: WorkerOperationDto;
  requested: number;
  retried: number;
}

export interface WorkerConfigDto {
  items: { key: string; value: string | number | boolean | null; group: string }[];
}
