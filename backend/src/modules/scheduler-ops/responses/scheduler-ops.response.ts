import type {
  ExecutionError,
  ExecutionStatus,
  ExecutionTrigger,
  GeneratedJobRef,
  SchedulerOperationAction,
  SchedulerTaskType,
} from '../contracts/scheduler.types.js';

export type SchedulerRange = '1h' | '6h' | '24h' | '7d';
export type SchedulerMetric = 'executions' | 'duration' | 'failures';
export type SchedulerSeverity = 'warning' | 'critical' | 'info';
/** Trạng thái tổng của Scheduler runtime (theo heartbeat). */
export type SchedulerStatus = 'healthy' | 'degraded' | 'down' | 'paused' | 'unknown';
/** Trạng thái hiển thị của task (một giá trị ưu tiên nhất) — `enabled` + `health` giữ riêng. */
export type TaskDisplayStatus = 'running' | 'failing' | 'disabled' | 'enabled';
export type TaskHealth = 'healthy' | 'warning' | 'error' | 'unknown';

export interface ScheduleDto {
  type: SchedulerTaskType;
  expression: string | null;
  intervalMs: number | null;
  timezone: string;
  /** Lệch UTC hiện tại của múi giờ lịch, vd. `+07:00`. */
  utcOffset: string;
  description: string;
}

/**
 * Một task: định nghĩa (scheduler runtime ghi), lịch BullMQ (`next`) và thống kê tính từ job còn giữ trên broker
 * (theo retention của queue) — `null` khi không có job nào để tính.
 */
export interface TaskRowDto {
  id: string;
  name: string;
  description: string | null;
  type: SchedulerTaskType;
  schedule: ScheduleDto;
  enabled: boolean;
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
  /** Số lần đã chạy theo BullMQ Job Scheduler (`iterationCount`). */
  iterations: number | null;
  consecutiveFailures: number;
  executions24h: number;
  failures24h: number;
  successRatePercent: number | null;
  avgDurationMs: number | null;
  downstreamQueue: string | null;
}

export interface ExecutionDto {
  id: string;
  taskId: string;
  taskName: string;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** Đang chạy: đã chạy bao lâu. */
  runningMs: number | null;
  attempts: number;
  correlationId: string;
  error: ExecutionError | null;
  jobs: GeneratedJobRef[];
}

export interface SchedulerAlertDto {
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
  /** Tab mở khi bấm (task → Task Detail). */
  tab: string;
}

export interface SchedulerOperationDto {
  id: string;
  at: string;
  action: SchedulerOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
  executionId: string | null;
}

/** Process scheduler theo heartbeat của runtime agent. */
export interface SchedulerInstanceDto {
  instance: string;
  host: string;
  pid: number;
  startedAt: string;
  lastSeenAt: string;
  heartbeatAgeSec: number;
  uptimeSec: number;
  paused: boolean;
}

export interface SchedulerHealthDto {
  status: SchedulerStatus;
  reasons: { code: string; message: string; taskId: string | null }[];
  lastHeartbeatAt: string | null;
  heartbeatAgeSec: number | null;
}

export interface UpcomingDto {
  taskId: string;
  taskName: string;
  at: string;
  inSec: number;
  expression: string | null;
  description: string;
}

/** Nhiều task dồn vào cùng một cửa sổ 5 phút — có thể gây đỉnh tải. */
export interface ConcentrationDto {
  from: string;
  to: string;
  count: number;
  tasks: string[];
}

export interface TimezoneDto {
  schedule: string;
  scheduleOffset: string;
  runtime: string | null;
}

export interface SchedulerReportDto {
  executions: number;
  successful: number;
  failed: number;
  successRatePercent: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  manualRuns: number;
}

export interface SchedulerSettingsDto {
  run: boolean;
  toggle: boolean;
}

export interface SchedulerOverviewDto {
  generatedAt: string;
  range: SchedulerRange;
  environment: string;
  timezone: TimezoneDto;
  health: SchedulerHealthDto;
  instance: SchedulerInstanceDto | null;
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
    nextExecutionAt: string | null;
    nextExecutionTask: string | null;
  };
  alerts: SchedulerAlertDto[];
  upcoming: UpcomingDto[];
  concentration: ConcentrationDto[];
  tasks: TaskRowDto[];
  running: ExecutionDto[];
  recent: ExecutionDto[];
  report: { today: SchedulerReportDto; yesterday: SchedulerReportDto };
  /** Lịch sử chỉ gồm job còn giữ trên broker (retention của queue), không lưu riêng. */
  historyNote: { keepCompleted: number; keepFailed: number };
  settings: SchedulerSettingsDto;
}

export interface TasksListDto {
  tasks: TaskRowDto[];
  settings: SchedulerSettingsDto;
}

export interface DownstreamDto {
  queue: string;
  /** null = không đọc được queue (broker chưa kết nối) — `reason` nói rõ. */
  state: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    paused: boolean;
    workers: number | null;
  } | null;
  reason: string | null;
}

export interface TaskDetailDto {
  task: TaskRowDto;
  kpis: {
    executions: number;
    successful: number;
    failed: number;
    successRatePercent: number | null;
    avgDurationMs: number | null;
    p95DurationMs: number | null;
    failuresToday: number;
    sampled: number;
  };
  consecutive: { count: number; firstFailedAt: string | null; lastSuccessAt: string | null } | null;
  running: ExecutionDto[];
  next: string[];
  downstream: DownstreamDto | null;
  durations: { t: number; durationMs: number; status: ExecutionStatus }[];
  recent: ExecutionDto[];
  alerts: SchedulerAlertDto[];
  settings: SchedulerSettingsDto;
}

export interface ExecutionsListDto {
  items: ExecutionDto[];
  truncated: boolean;
}

export interface ExecutionDetailDto {
  execution: ExecutionDto;
  task: TaskRowDto | null;
  downstream: DownstreamDto | null;
  settings: SchedulerSettingsDto;
}

export interface FailuresDto {
  range: SchedulerRange;
  failed: number;
  byType: {
    type: string;
    count: number;
    tasks: string[];
    lastAt: string;
    sampleExecutionId: string;
  }[];
  byTask: { taskId: string; taskName: string; failed: number; consecutive: number }[];
  items: ExecutionDto[];
  truncated: boolean;
  alerts: SchedulerAlertDto[];
}

export interface TimelineDto {
  range: SchedulerRange;
  from: string;
  to: string;
  lanes: { taskId: string; taskName: string; executions: ExecutionDto[] }[];
  upcoming: UpcomingDto[];
  truncated: boolean;
}

export interface UpcomingListDto {
  hours: number;
  items: UpcomingDto[];
  concentration: ConcentrationDto[];
  truncated: boolean;
}

export interface SchedulerSeriesDto {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface SchedulerMetricsDto {
  metric: SchedulerMetric;
  range: SchedulerRange;
  taskId: string | null;
  resolutionSec: number | null;
  unit: string;
  series: SchedulerSeriesDto[];
  stats: { current: number | null; peak: number | null; average: number | null };
}

export interface CronInspectDto {
  expression: string;
  timezone: string;
  utcOffset: string;
  valid: boolean;
  error: string | null;
  description: string | null;
  next: string[];
}

export interface SchedulerConfigDto {
  items: { group: string; key: string; value: string | number | boolean | null }[];
  tasks: {
    id: string;
    name: string;
    items: { key: string; value: string | number | boolean | null }[];
  }[];
}

export interface RunNowDto {
  operation: SchedulerOperationDto;
  executionId: string;
}
