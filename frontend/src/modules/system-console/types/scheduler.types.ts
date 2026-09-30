/** Kiểu dữ liệu trang Scheduler — khớp `backend/src/modules/scheduler-ops/responses`. */

export type SchedulerRange = '1h' | '6h' | '24h' | '7d';
export type SchedulerMetric = 'executions' | 'duration' | 'failures' | 'missed';
export type SchedulerTab = 'overview' | 'tasks' | 'history' | 'timeline' | 'failures' | 'events' | 'configuration';
export type TaskDetailTab = 'overview' | 'history' | 'metrics' | 'logs' | 'configuration';
export type SchedulerSeverity = 'warning' | 'critical' | 'info';
export type SchedulerStatus = 'healthy' | 'degraded' | 'down' | 'paused' | 'unknown';
export type TaskType = 'cron' | 'interval' | 'one_time';
export type TaskDisplayStatus = 'running' | 'failing' | 'overdue' | 'misconfigured' | 'disabled' | 'completed' | 'enabled';
export type TaskHealth = 'healthy' | 'warning' | 'error' | 'unknown';
export type OverlapPolicy = 'skip' | 'allow';
export type MisfirePolicy = 'run_once' | 'skip';
export type ExecutionTrigger = 'scheduled' | 'manual' | 'recovery';
export type ExecutionStatus = 'running' | 'success' | 'failed' | 'skipped' | 'missed';
export type ExecutionReason = 'previous_running' | 'lock_unavailable' | 'runtime_down' | 'interrupted';

export interface ExecutionError {
  type: string;
  message: string;
}

export interface GeneratedJob {
  id: string;
  queue: string;
  topic: string;
}

export interface Schedule {
  type: TaskType;
  expression: string | null;
  intervalMs: number | null;
  runAt: string | null;
  timezone: string;
  utcOffset: string;
  description: string;
}

export interface TaskRow {
  id: string;
  name: string;
  description: string | null;
  group: string;
  type: TaskType;
  schedule: Schedule;
  enabled: boolean;
  disabledAt: string | null;
  disabledBy: string | null;
  running: number;
  status: TaskDisplayStatus;
  health: TaskHealth;
  lastRunAt: string | null;
  lastStatus: ExecutionStatus | null;
  lastDurationMs: number | null;
  lastError: ExecutionError | null;
  lastExecutionId: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
  executions24h: number;
  failures24h: number;
  successRatePercent: number | null;
  avgDurationMs: number | null;
  overlap: OverlapPolicy;
  misfire: MisfirePolicy;
  expectedDurationMs: number | null;
  downstreamQueue: string | null;
  error: string | null;
}

export interface Execution {
  id: string;
  taskId: string;
  taskName: string;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  runningMs: number | null;
  driftMs: number | null;
  instance: string | null;
  correlationId: string | null;
  error: ExecutionError | null;
  reason: ExecutionReason | null;
  missedCount: number | null;
  missedUntil: string | null;
  jobs: GeneratedJob[];
  actor: string | null;
  blockedBy: string | null;
  longRunning: boolean;
}

export interface SchedulerAlert {
  id: string;
  rule: string;
  severity: SchedulerSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string;
  taskId: string | null;
  executionId: string | null;
  tab: SchedulerTab;
}

export interface SchedulerEvent {
  id: string;
  at: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  taskId: string | null;
  executionId: string | null;
}

export interface SchedulerOperation {
  id: string;
  at: string;
  action: 'run' | 'enable' | 'disable';
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
  executionId: string | null;
}

export interface SchedulerInstance {
  instance: string;
  host: string;
  pid: number;
  startedAt: string;
  lastSeenAt: string;
  heartbeatAgeSec: number;
  uptimeSec: number;
  alive: boolean;
  paused: boolean;
  tasks: number;
  running: number;
  timezone: string;
}

export interface SchedulerHealth {
  status: SchedulerStatus;
  reasons: { code: string; message: string; taskId: string | null }[];
  lastHeartbeatAt: string | null;
  heartbeatAgeSec: number | null;
  aliveInstances: number;
}

export interface Upcoming {
  taskId: string;
  taskName: string;
  at: string;
  inSec: number;
  expression: string | null;
  description: string;
}

export interface Concentration {
  from: string;
  to: string;
  count: number;
  tasks: string[];
}

export interface SchedulerReport {
  executions: number;
  successful: number;
  failed: number;
  skipped: number;
  missed: number;
  successRatePercent: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  manualRuns: number;
}

export interface SchedulerSettings {
  run: boolean;
  toggle: boolean;
}

export interface SchedulerOverview {
  generatedAt: string;
  range: SchedulerRange;
  environment: string;
  timezone: { schedule: string; scheduleOffset: string; runtime: string | null; dst: boolean };
  health: SchedulerHealth;
  kpis: {
    registered: number;
    enabled: number;
    disabled: number;
    running: number;
    failedToday: number;
    executionsToday: number;
    successRatePercent: number | null;
    avgDurationMs: number | null;
    p95DurationMs: number | null;
    missedToday: number;
    skippedToday: number;
    nextExecutionAt: string | null;
    nextExecutionTask: string | null;
  };
  drift: { avgMs: number | null; p95Ms: number | null };
  runtime: {
    instances: SchedulerInstance[];
    strategy: 'distributed_lock';
    lockProvider: string;
    runtimeState: string | null;
    uptimeSec: number | null;
  };
  alerts: SchedulerAlert[];
  upcoming: Upcoming[];
  concentration: Concentration[];
  tasks: TaskRow[];
  running: Execution[];
  recent: Execution[];
  events: SchedulerEvent[];
  report: { today: SchedulerReport; yesterday: SchedulerReport };
  settings: SchedulerSettings;
}

export interface TasksList {
  tasks: TaskRow[];
  settings: SchedulerSettings;
}

export interface Downstream {
  queue: string;
  state: { waiting: number; active: number; delayed: number; failed: number; paused: boolean; workers: number | null } | null;
  reason: string | null;
}

export interface TaskDetail {
  task: TaskRow;
  className: string;
  sourcePath: string | null;
  registeredAt: string;
  lockTtlMs: number;
  kpis: {
    executions: number;
    successful: number;
    failed: number;
    skipped: number;
    missed: number;
    successRatePercent: number | null;
    avgDurationMs: number | null;
    p95DurationMs: number | null;
    failuresToday: number;
    sampled: number;
  };
  consecutive: { count: number; firstFailedAt: string | null; lastSuccessAt: string | null } | null;
  expected: { durationMs: number | null; source: 'configured' | 'baseline' | null };
  running: Execution[];
  next: string[];
  lock: { strategy: 'distributed_lock' | 'none'; provider: string | null; ttlMs: number; owner: { executionId: string; instance: string } | null };
  downstream: Downstream | null;
  durations: { t: number; durationMs: number; status: ExecutionStatus }[];
  recent: Execution[];
  alerts: SchedulerAlert[];
  events: SchedulerEvent[];
  settings: SchedulerSettings;
}

export interface ExecutionsList {
  items: Execution[];
  truncated: boolean;
}

export interface TriggeredJob extends GeneratedJob {
  status: string | null;
  attempts: number | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ExecutionDetail {
  execution: Execution;
  task: TaskRow | null;
  jobs: TriggeredJob[];
  jobsReason: string | null;
  downstream: Downstream | null;
  blocking: Execution | null;
  settings: SchedulerSettings;
}

export interface SchedulerFailures {
  range: SchedulerRange;
  failed: number;
  missed: number;
  byType: { type: string; count: number; tasks: string[]; lastAt: string; sampleExecutionId: string }[];
  byTask: { taskId: string; taskName: string; failed: number; missed: number; consecutive: number }[];
  items: Execution[];
  truncated: boolean;
  alerts: SchedulerAlert[];
}

export interface SchedulerTimeline {
  range: SchedulerRange;
  from: string;
  to: string;
  lanes: { taskId: string; taskName: string; executions: Execution[] }[];
  upcoming: Upcoming[];
  truncated: boolean;
}

export interface UpcomingList {
  hours: number;
  items: Upcoming[];
  concentration: Concentration[];
  truncated: boolean;
}

export interface SchedulerSeries {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface SchedulerMetrics {
  metric: SchedulerMetric;
  range: SchedulerRange;
  taskId: string | null;
  resolutionSec: number | null;
  unit: string;
  series: SchedulerSeries[];
  stats: { current: number | null; peak: number | null; average: number | null };
}

export interface CronInspect {
  expression: string;
  timezone: string;
  utcOffset: string;
  valid: boolean;
  error: string | null;
  description: string | null;
  next: string[];
}

export interface SchedulerConfig {
  items: { group: string; key: string; value: string | number | boolean | null }[];
  tasks: { id: string; name: string; items: { key: string; value: string | number | boolean | null }[] }[];
}

export interface RunNowResult {
  operation: SchedulerOperation;
  executionId: string;
  instance: string;
}
