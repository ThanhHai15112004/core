/** Các runtime chạy liên tục của Core; CLI là runtime chạy theo yêu cầu. */
export const LONG_RUNNING_RUNTIMES = ['api', 'worker', 'scheduler'] as const;
export type LongRunningRuntimeId = (typeof LONG_RUNNING_RUNTIMES)[number];
export type RuntimeId = LongRunningRuntimeId | 'cli';
export type RuntimeKind = 'long-running' | 'on-demand';

export interface RuntimeIdentity {
  id: RuntimeId;
  kind: RuntimeKind;
}

/** Trạng thái do chính process báo (trạng thái hiển thị được suy ra ở API). */
export type AgentState = 'starting' | 'running' | 'paused' | 'stopping';

export type MetricValue = number | string | boolean | null;

export interface RuntimeResources {
  cpuPercent: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  memoryLimitMb: number | null;
  /** `cgroup`: giới hạn container; `v8-heap`: giới hạn heap của V8 khi không chạy trong cgroup. */
  memoryLimitSource: 'cgroup' | 'v8-heap';
  memoryPercent: number | null;
  eventLoopMeanMs: number;
  eventLoopP99Ms: number;
  /** Tổng thời gian GC pause kể từ mẫu trước. */
  gcPauseMs: number;
  gcCount: number;
  activeHandles: number;
}

export interface RuntimeProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  execArgv: string[];
}

export interface RuntimeDescriptor {
  type: 'http' | 'queue-consumer' | 'scheduler' | 'cli';
  framework: string;
  adapter?: string;
  port?: number;
  entrypoint: string;
  sourcePath: string;
  details?: Record<string, MetricValue>;
}

export type RuntimeAlertKey = 'memory' | 'cpu' | 'eventLoop';

export interface RuntimeAlert {
  key: RuntimeAlertKey;
  value: number;
  threshold: number;
  /** ISO 8601 — lúc bắt đầu vượt ngưỡng. */
  since: string;
}

/** Vấn đề runtime-specific do contributor báo; `key` là i18n key. */
export interface RuntimeIssue {
  key: string;
  params?: Record<string, string | number>;
}

export interface RuntimeCapabilities {
  pause: boolean;
  restart: boolean;
}

export interface RuntimeHeartbeat {
  id: RuntimeId;
  instance: string;
  state: AgentState;
  /** ISO 8601 */
  at: string;
  startedAt: string;
  uptimeSec: number;
  supervisor: string;
  environment: string;
  process: RuntimeProcessInfo;
  resources: RuntimeResources;
  metrics: Record<string, MetricValue>;
  details: Record<string, unknown>;
  issues: RuntimeIssue[];
  alerts: RuntimeAlert[];
  descriptor: RuntimeDescriptor;
  capabilities: RuntimeCapabilities;
  startCount: number;
}

export interface RuntimeSample {
  /** epoch ms */
  t: number;
  cpu: number;
  mem: number;
  heap: number;
  elp99: number;
  starts: number;
}

export type RuntimeEventType =
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'paused'
  | 'resumed'
  | 'restart_requested'
  | 'threshold_exceeded'
  | 'threshold_recovered'
  | 'command_failed';

export type RuntimeEventData = Record<string, string | number | boolean | null>;

export interface RuntimeEvent {
  id: string;
  runtime: RuntimeId;
  type: RuntimeEventType;
  /** ISO 8601 */
  at: string;
  data: RuntimeEventData;
}

export type RuntimeCommandAction = 'restart' | 'pause' | 'resume';
export type RestartMode = 'graceful' | 'force';

export interface RuntimeCommand {
  id: string;
  runtime: LongRunningRuntimeId;
  action: RuntimeCommandAction;
  mode?: RestartMode;
  requestedAt: string;
}

export type RuntimeCommandStatus = 'pending' | 'accepted' | 'completed' | 'failed';

export interface RuntimeCommandResult {
  id: string;
  status: RuntimeCommandStatus;
  message?: string;
  at: string;
}

export interface CliExecution {
  id: string;
  command: string;
  args: string[];
  startedAt: string;
  durationMs: number;
  exitCode: number;
  result: 'success' | 'failure';
  error?: string;
}
