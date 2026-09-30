import type {
  ExecutionError,
  ExecutionReason,
  ExecutionStatus,
  ExecutionTrigger,
  GeneratedJobRef,
  MisfirePolicy,
  OverlapPolicy,
  SchedulerEventType,
  SchedulerOperationAction,
  SchedulerTaskType,
} from '@packages/scheduler/index.js';

export type SchedulerRange = '1h' | '6h' | '24h' | '7d';
export type SchedulerMetric = 'executions' | 'duration' | 'failures' | 'missed';
export type SchedulerSeverity = 'warning' | 'critical' | 'info';
/** Trạng thái tổng của Scheduler runtime. */
export type SchedulerStatus = 'healthy' | 'degraded' | 'down' | 'paused' | 'unknown';
/** Trạng thái hiển thị của task (một giá trị ưu tiên nhất) — `enabled` + `health` giữ riêng. */
export type TaskDisplayStatus =
  'running' | 'failing' | 'overdue' | 'misconfigured' | 'disabled' | 'completed' | 'enabled';
export type TaskHealth = 'healthy' | 'warning' | 'error' | 'unknown';

export interface ScheduleDto {
  type: SchedulerTaskType;
  expression: string | null;
  intervalMs: number | null;
  runAt: string | null;
  timezone: string;
  utcOffset: string;
  /** Mô tả cho người đọc (theo ngôn ngữ của request), vd. "Every day at 01:00". */
  description: string;
}

export interface TaskRowDto {
  id: string;
  name: string;
  description: string | null;
  group: string;
  type: SchedulerTaskType;
  schedule: ScheduleDto;
  /** Trạng thái vận hành (bật/tắt) — tách với `health`. */
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
  /** Số lần chạy / lỗi / tỉ lệ thành công 24 giờ qua (telemetry). */
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
  driftMs: number | null;
  instance: string | null;
  correlationId: string | null;
  error: ExecutionError | null;
  reason: ExecutionReason | null;
  missedCount: number | null;
  missedUntil: string | null;
  jobs: GeneratedJobRef[];
  actor: string | null;
  blockedBy: string | null;
  /** Đang chạy lâu hơn thời lượng dự kiến (có thể bị treo — không khẳng định). */
  longRunning: boolean;
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

export interface SchedulerEventDto {
  id: string;
  at: string;
  type: SchedulerEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  taskId: string | null;
  executionId: string | null;
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

export interface SchedulerInstanceDto {
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

export interface SchedulerHealthDto {
  status: SchedulerStatus;
  reasons: { code: string; message: string; taskId: string | null }[];
  lastHeartbeatAt: string | null;
  heartbeatAgeSec: number | null;
  aliveInstances: number;
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
  dst: boolean;
}

export interface SchedulerReportDto {
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

export interface SchedulerSettingsDto {
  run: boolean;
  toggle: boolean;
}

export interface SchedulerRuntimeDto {
  instances: SchedulerInstanceDto[];
  /** Chạy nhiều instance: mỗi mốc lịch một instance nhận + lock chống chạy chồng (không có leader). */
  strategy: 'distributed_lock';
  lockProvider: string;
  runtimeState: string | null;
  uptimeSec: number | null;
}

export interface SchedulerOverviewDto {
  generatedAt: string;
  range: SchedulerRange;
  environment: string;
  timezone: TimezoneDto;
  health: SchedulerHealthDto;
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
  runtime: SchedulerRuntimeDto;
  alerts: SchedulerAlertDto[];
  upcoming: UpcomingDto[];
  concentration: ConcentrationDto[];
  tasks: TaskRowDto[];
  running: ExecutionDto[];
  recent: ExecutionDto[];
  events: SchedulerEventDto[];
  report: { today: SchedulerReportDto; yesterday: SchedulerReportDto };
  settings: SchedulerSettingsDto;
}

export interface TasksListDto {
  tasks: TaskRowDto[];
  settings: SchedulerSettingsDto;
}

export interface DownstreamDto {
  queue: string;
  /** null = không đọc được queue (backend chưa kết nối / queue không tồn tại) — `reason` nói rõ. */
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
  running: ExecutionDto[];
  next: string[];
  lock: {
    strategy: 'distributed_lock' | 'none';
    provider: string | null;
    ttlMs: number;
    owner: { executionId: string; instance: string } | null;
  };
  downstream: DownstreamDto | null;
  durations: { t: number; durationMs: number; status: ExecutionStatus }[];
  recent: ExecutionDto[];
  alerts: SchedulerAlertDto[];
  events: SchedulerEventDto[];
  settings: SchedulerSettingsDto;
}

export interface ExecutionsListDto {
  items: ExecutionDto[];
  truncated: boolean;
}

export interface TriggeredJobDto extends GeneratedJobRef {
  /** Trạng thái hiện tại trên broker; null = không còn (đã dọn theo retention) hoặc không đọc được. */
  status: string | null;
  attempts: number | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ExecutionDetailDto {
  execution: ExecutionDto;
  task: TaskRowDto | null;
  jobs: TriggeredJobDto[];
  /** Lý do không tra được trạng thái job (broker chưa kết nối…). */
  jobsReason: string | null;
  downstream: DownstreamDto | null;
  /** Lần chạy chặn lần này (bản ghi `skipped`). */
  blocking: ExecutionDto | null;
  settings: SchedulerSettingsDto;
}

export interface FailuresDto {
  range: SchedulerRange;
  failed: number;
  missed: number;
  byType: {
    type: string;
    count: number;
    tasks: string[];
    lastAt: string;
    sampleExecutionId: string;
  }[];
  byTask: {
    taskId: string;
    taskName: string;
    failed: number;
    missed: number;
    consecutive: number;
  }[];
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
  instance: string;
}
