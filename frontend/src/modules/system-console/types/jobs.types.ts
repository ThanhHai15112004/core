import type { RateBalance, Section } from './worker.types';

export type JobsRange = '15m' | '1h' | '6h' | '24h';
export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'retrying' | 'delayed' | 'stalled' | 'cancelled';
export type JobPriorityLevel = 'critical' | 'high' | 'normal' | 'low';
export type JobSourceKind = 'http' | 'scheduler' | 'job' | 'manual' | 'system';
export type JobCapability =
  'progress' | 'stalled' | 'priority' | 'delayed' | 'lifecycle' | 'stacktrace' | 'result' | 'retry' | 'cancel' | 'remove' | 'children';
export type JobsTab = 'overview' | 'explorer' | 'failures' | 'performance' | 'events' | 'configuration';
export type JobDetailTab = 'overview' | 'lifecycle' | 'attempts' | 'payload' | 'logs' | 'configuration';
/** Bộ lọc trạng thái của Explorer (`all` = mọi trạng thái). */
export type StatusFilter = 'all' | JobStatus;
export type JobsWindow = '15m' | '1h' | '6h' | '24h' | '7d';

export interface JobSource {
  kind: JobSourceKind;
  id: string | null;
  name: string | null;
  detail: string | null;
}

export interface JobProgress {
  percent: number | null;
  processed: number | null;
  total: number | null;
  step: string | null;
  phases: { name: string; state: 'done' | 'active' | 'pending' | 'failed' }[];
}

export interface JobRow {
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
  waitMs: number | null;
  durationMs: number | null;
  runningMs: number | null;
  progress: JobProgress | null;
  source: JobSource;
  correlationId: string | null;
  error: string | null;
  errorType: string | null;
  retryable: boolean | null;
  delayReason: 'retry' | 'repeat' | 'delay' | null;
  stalledCount: number;
  heartbeatAgeSec: number | null;
  longWait: boolean;
  longRunning: boolean;
  typicalMs: number | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

export type SearchMatch = 'id' | 'correlation' | 'request' | 'idempotency' | 'execution' | 'entity' | 'parent';

export interface JobSearchResult {
  jobs: JobRow[];
  nextCursor: string | null;
  scanned: number;
  truncated: boolean;
  mode: 'scan' | 'lookup';
  matchedBy: SearchMatch | null;
}

export interface JobFilters {
  status?: JobStatus;
  queue?: string;
  type?: string;
  search?: string;
  window?: JobsWindow;
  worker?: string;
  source?: JobSourceKind;
  minAttempts?: number;
  minDurationMs?: number;
  errorType?: string;
  priority?: JobPriorityLevel;
}

export interface JobProblem {
  id: string;
  severity: 'warning' | 'critical';
  code: string;
  message: string;
  filter: {
    status?: JobStatus;
    queue?: string;
    errorType?: string;
    type?: string;
  } | null;
  jobId: string | null;
  queue: string | null;
}

export interface FailureGroup {
  errorType: string;
  count: number;
  retryable: boolean | null;
  queues: string[];
  types: string[];
  dependency: string | null;
  lastAt: string | null;
  sampleJobId: string | null;
  sampleQueue: string | null;
}

export interface JobEvent {
  id: string;
  at: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  jobId: string | null;
  queue: string | null;
  jobType: string | null;
}

export interface JobOperation {
  id: string;
  at: string;
  action: 'retry' | 'bulk_retry' | 'cancel' | 'remove' | 'payload';
  target: string;
  jobType: string | null;
  result: 'success' | 'failed';
  detail: string | null;
  reason: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

export interface JobsSettings {
  retry: boolean;
  bulkRetryMax: number;
  cancel: boolean;
  remove: boolean;
  payload: boolean;
}

export type JobsStatusValue = 'processing' | 'idle' | 'degraded' | 'critical' | 'unavailable';

export interface JobsOverview {
  generatedAt: string;
  environment: string;
  range: JobsRange;
  provider: {
    product: string;
    backend: string;
    endpoint: string;
    connection: string;
  };
  capabilities: JobCapability[];
  status: JobsStatusValue;
  kpis: {
    waiting: number | null;
    active: number | null;
    completedToday: number;
    failedToday: number;
    retrying: number | null;
    delayed: number | null;
    stalled: number | null;
    successRatePercent: number | null;
    failedNow: number | null;
  };
  rate: RateBalance;
  problems: JobProblem[];
  failureGroups: Section<FailureGroup[]>;
  priorities: Section<{ level: JobPriorityLevel; waiting: number; oldestSec: number | null }[]>;
  longRunning: Section<JobRow[]>;
  stalled: Section<JobRow[]>;
  events: JobEvent[];
  queues: string[];
  settings: JobsSettings;
}

export interface JobsReport {
  created: number;
  completed: number;
  failed: number;
  retried: number;
  successRatePercent: number | null;
  avgWaitMs: number | null;
  avgProcessingMs: number | null;
  p95ProcessingMs: number | null;
}

export interface JobTypeRow {
  type: string;
  created: number;
  runs: number;
  failed: number;
  failureRatePercent: number | null;
  avgMs: number | null;
  p95Ms: number | null;
}

export interface JobsReportResponse {
  range: JobsRange;
  today: JobsReport;
  yesterday: JobsReport;
  types: JobTypeRow[];
}

export interface JobsFailures {
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
  groups: Section<FailureGroup[]>;
  sampled: number;
  retryStorm: {
    retriesPerMin: number;
    threshold: number;
    primaryType: string | null;
    primaryError: string | null;
  } | null;
  settings: JobsSettings;
}

export type LifecycleKind =
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

export interface LifecycleStep {
  at: string | null;
  kind: LifecycleKind;
  attempt: number | null;
  instance: string | null;
  runtime: string | null;
  ms: number | null;
  delayMs: number | null;
  error: string | null;
  errorType: string | null;
  actor: string | null;
  queue: string | null;
  current: boolean;
}

export interface Attempt {
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
  backoffMs: number | null;
  manual: boolean;
  stack: string | null;
}

export interface ActionState {
  allowed: boolean;
  reason: string | null;
}

export interface JobDetail {
  job: JobRow;
  capabilities: JobCapability[];
  timing: {
    waitMs: number | null;
    processingMs: number | null;
    totalMs: number | null;
    queueAvgWaitMs: number | null;
    waitDeviationPercent: number | null;
    typicalMs: number | null;
    diagnosis: 'wait' | 'processing' | null;
  };
  lifecycle: LifecycleStep[];
  lifecycleAvailable: boolean;
  attempts: Attempt[];
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
  idempotency: {
    key: string | null;
    protection: 'enabled' | 'disabled' | 'unknown';
  };
  config: {
    maxAttempts: number;
    backoff: { type: string; delayMs: number } | null;
    priority: number;
    priorityLevel: JobPriorityLevel;
    cancellable: boolean;
    removeOnComplete: string | null;
    removeOnFail: string | null;
    lockDurationMs: number;
  };
  handler: { processors: string[]; runtimes: string[]; instances: number };
  children: JobRow[];
  logs: { t: string; level: string; context?: string; message: string }[];
  logsMatchedBy: 'job' | 'correlation' | null;
  jobLogs: string[];
  stalled: {
    detected: boolean;
    heartbeatAgeSec: number | null;
    stalledCount: number;
  };
  longRunning: {
    detected: boolean;
    runningMs: number | null;
    thresholdMs: number | null;
  };
  actions: {
    retry: ActionState;
    cancel: ActionState & { mode: 'removed' | 'cooperative' | null };
    remove: ActionState;
    payload: ActionState;
  };
  settings: JobsSettings;
}

export interface JobsConfig {
  items: {
    group: string;
    key: string;
    value: string | number | boolean | null;
  }[];
}

export interface JobCancelResult {
  operation: JobOperation;
  mode: 'removed' | 'cooperative';
  delivered: boolean;
  instance: string | null;
}

export interface JobBulkRetryResult {
  operation: JobOperation;
  items: {
    queue: string;
    id: string;
    result: 'retried' | 'skipped' | 'failed';
    reason: string | null;
  }[];
}
