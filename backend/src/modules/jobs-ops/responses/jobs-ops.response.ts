import type { JobSource, JobOperationRecord } from '@packages/messaging/index.js';
import type {
  JobBackoff,
  JobCapability,
  JobPriorityLevel,
  JobProgressInfo,
  JobStatus,
  QueueSection,
} from '@packages/queue/index.js';
import type { RateBalanceDto } from '@modules/worker-ops/index.js';

export type JobsRange = '15m' | '1h' | '6h' | '24h';
export type SectionDto<T> = QueueSection<T>;

/** Một job trong bảng (không payload). */
export interface JobRowDto {
  id: string;
  queue: string;
  type: string;
  status: JobStatus;
  priority: number;
  priorityLevel: JobPriorityLevel;
  createdAt: string;
  availableAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  worker: string | null;
  attempts: number;
  maxAttempts: number;
  /** waiting: đã chờ tới giờ; còn lại: chờ trước lần xử lý gần nhất. */
  waitMs: number | null;
  durationMs: number | null;
  /** active / stalled: đã chạy bao lâu. */
  runningMs: number | null;
  progress: JobProgressInfo | null;
  source: JobSource;
  correlationId: string | null;
  error: string | null;
  errorType: string | null;
  retryable: boolean | null;
  delayReason: 'retry' | 'repeat' | 'delay' | null;
  stalledCount: number;
  /** active / stalled: giây kể từ lần gia hạn khoá gần nhất (null = không biết). */
  heartbeatAgeSec: number | null;
  longWait: boolean;
  longRunning: boolean;
  /** p95 thời gian xử lý của loại job (24h) — "Typical". */
  typicalMs: number | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

export type SearchMatch =
  'id' | 'correlation' | 'request' | 'idempotency' | 'execution' | 'entity' | 'parent';

export interface JobSearchDto {
  jobs: JobRowDto[];
  nextCursor: string | null;
  /** Số job đã đọc từ broker cho trang này. */
  scanned: number;
  /** Dừng vì chạm giới hạn quét (còn job chưa xét). */
  truncated: boolean;
  mode: 'scan' | 'lookup';
  matchedBy: SearchMatch | null;
}

export interface JobProblemDto {
  id: string;
  severity: 'warning' | 'critical';
  code:
    | 'STALLED'
    | 'FAILURES'
    | 'OLDEST_WAITING'
    | 'ERROR_GROUP'
    | 'RETRY_STORM'
    | 'LONG_RUNNING'
    | 'CRITICAL_WAITING'
    | 'BACKLOG_GROWING'
    | 'NO_WORKER';
  message: string;
  /** Mở Job Explorer với bộ lọc tương ứng. */
  filter: { status?: JobStatus; queue?: string; errorType?: string; type?: string } | null;
  jobId: string | null;
  queue: string | null;
}

export interface FailureGroupDto {
  errorType: string;
  count: number;
  /** false = không retry được; null = không rõ / lẫn lộn. */
  retryable: boolean | null;
  queues: string[];
  types: string[];
  dependency: string | null;
  lastAt: string | null;
  sampleJobId: string | null;
  sampleQueue: string | null;
}

export interface JobEventDto {
  id: string;
  at: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  jobId: string | null;
  queue: string | null;
  jobType: string | null;
}

export type JobOperationDto = Omit<JobOperationRecord, 'at'> & { at: string };

export interface JobsSettingsDto {
  retry: boolean;
  bulkRetryMax: number;
  cancel: boolean;
  remove: boolean;
  payload: boolean;
}

export type JobsStatus = 'processing' | 'idle' | 'degraded' | 'critical' | 'unavailable';

export interface JobsKpisDto {
  waiting: number | null;
  active: number | null;
  completedToday: number;
  failedToday: number;
  retrying: number | null;
  delayed: number | null;
  stalled: number | null;
  successRatePercent: number | null;
  /** Job đang nằm trong danh sách failed (chưa retry / chưa dọn). */
  failedNow: number | null;
}

export interface JobsOverviewDto {
  generatedAt: string;
  environment: string;
  range: JobsRange;
  provider: { product: string; backend: string; endpoint: string; connection: string };
  capabilities: JobCapability[];
  status: JobsStatus;
  kpis: JobsKpisDto;
  rate: RateBalanceDto;
  problems: JobProblemDto[];
  failureGroups: SectionDto<FailureGroupDto[]>;
  priorities: SectionDto<{ level: JobPriorityLevel; waiting: number; oldestSec: number | null }[]>;
  longRunning: SectionDto<JobRowDto[]>;
  stalled: SectionDto<JobRowDto[]>;
  events: JobEventDto[];
  queues: string[];
  settings: JobsSettingsDto;
}

export interface JobsReportDto {
  created: number;
  completed: number;
  failed: number;
  retried: number;
  successRatePercent: number | null;
  avgWaitMs: number | null;
  avgProcessingMs: number | null;
  p95ProcessingMs: number | null;
}

export interface JobTypeRowDto {
  type: string;
  created: number;
  runs: number;
  failed: number;
  failureRatePercent: number | null;
  avgMs: number | null;
  p95Ms: number | null;
}

export interface JobsReportResponseDto {
  range: JobsRange;
  today: JobsReportDto;
  yesterday: JobsReportDto;
  types: JobTypeRowDto[];
}

export interface JobsFailuresDto {
  range: JobsRange;
  queue: string | null;
  stats: {
    failedToday: number;
    failureRatePercent: number | null;
    failedNow: number | null;
    retryable: number | null;
    nonRetryable: number | null;
    retryingNow: number | null;
    retriedToday: number;
  };
  groups: SectionDto<FailureGroupDto[]>;
  sampled: number;
  retryStorm: {
    retriesPerMin: number;
    threshold: number;
    primaryType: string | null;
    primaryError: string | null;
  } | null;
  settings: JobsSettingsDto;
}

export type LifecycleStepKind =
  | 'created'
  | 'enqueued'
  | 'scheduled'
  | 'picked'
  | 'completed'
  | 'failed'
  | 'retry_scheduled'
  | 'exhausted'
  | 'retried_manually'
  | 'replayed'
  | 'cancel_requested'
  | 'cancelled'
  | 'stalled'
  | 'waiting'
  | 'running';

export interface LifecycleStepDto {
  at: string | null;
  kind: LifecycleStepKind;
  attempt: number | null;
  instance: string | null;
  runtime: string | null;
  ms: number | null;
  delayMs: number | null;
  error: string | null;
  errorType: string | null;
  actor: string | null;
  queue: string | null;
  /** true = trạng thái hiện tại (chưa kết thúc). */
  current: boolean;
}

export interface AttemptDto {
  attempt: number;
  result: 'completed' | 'failed' | 'running' | 'cancelled' | 'unknown';
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  errorType: string | null;
  dependency: string | null;
  retryable: boolean | null;
  instance: string | null;
  runtime: string | null;
  /** Chờ trước lần thử kế tiếp (backoff). */
  backoffMs: number | null;
  manual: boolean;
  stack: string | null;
}

export interface ActionStateDto {
  allowed: boolean;
  /** i18n key hậu tố giải thích vì sao không được. */
  reason: string | null;
}

export interface RelatedLogDto {
  t: string;
  level: string;
  context?: string;
  message: string;
}

export interface JobDetailDto {
  job: JobRowDto;
  capabilities: JobCapability[];
  timing: {
    waitMs: number | null;
    processingMs: number | null;
    totalMs: number | null;
    queueAvgWaitMs: number | null;
    waitDeviationPercent: number | null;
    typicalMs: number | null;
    /** Chậm vì chờ (backlog / thiếu worker) hay vì chính job xử lý chậm. */
    diagnosis: 'wait' | 'processing' | null;
  };
  lifecycle: LifecycleStepDto[];
  lifecycleAvailable: boolean;
  attempts: AttemptDto[];
  failure: {
    type: string;
    message: string;
    occurredAt: string | null;
    attempt: number;
    maxAttempts: number;
    dependency: string | null;
    retryable: boolean | null;
    stack: string | null;
  } | null;
  correlation: {
    correlationId: string | null;
    requestId: string | null;
    messageId: string;
    schedulerExecutionId: string | null;
    parentJobId: string | null;
    parentQueue: string | null;
  };
  source: JobSource;
  payload: {
    available: boolean;
    sizeBytes: number;
    contentType: string;
    schema: string | null;
    fields: number | null;
    index: Record<string, string>;
    malformed: boolean;
  };
  result: { sizeBytes: number; summary: unknown; truncated: boolean } | null;
  idempotency: { key: string | null; protection: 'enabled' | 'disabled' | 'unknown' };
  config: {
    maxAttempts: number;
    backoff: JobBackoff | null;
    priority: number;
    priorityLevel: JobPriorityLevel;
    cancellable: boolean;
    removeOnComplete: string | null;
    removeOnFail: string | null;
    lockDurationMs: number;
  };
  handler: { processors: string[]; runtimes: string[]; instances: number };
  children: JobRowDto[];
  logs: RelatedLogDto[];
  logsMatchedBy: 'job' | 'correlation' | null;
  jobLogs: string[];
  stalled: { detected: boolean; heartbeatAgeSec: number | null; stalledCount: number };
  longRunning: { detected: boolean; runningMs: number | null; thresholdMs: number | null };
  actions: {
    retry: ActionStateDto;
    cancel: ActionStateDto & { mode: 'removed' | 'cooperative' | null };
    remove: ActionStateDto;
    payload: ActionStateDto;
  };
  settings: JobsSettingsDto;
}

export interface JobsConfigDto {
  items: { group: string; key: string; value: string | number | boolean | null }[];
}

export interface JobRetryDto {
  operation: JobOperationDto;
  job: JobRowDto;
}

export interface JobCancelDto {
  operation: JobOperationDto;
  mode: 'removed' | 'cooperative';
  delivered: boolean;
  instance: string | null;
}

export interface JobBulkRetryDto {
  operation: JobOperationDto;
  items: {
    queue: string;
    id: string;
    result: 'retried' | 'skipped' | 'failed';
    reason: string | null;
  }[];
}
