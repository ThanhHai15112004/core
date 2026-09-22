/* Khớp với backend/src/modules/runtimes/responses/runtime.response.ts */

export type RuntimeId = 'api' | 'worker' | 'scheduler';
export type RuntimeStatus =
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'restarting'
  | 'crashed'
  | 'unknown';
export type MetricValue = number | string | boolean | null;
export type RestartMode = 'graceful' | 'force';
export type RuntimeAction = 'restart' | 'stop' | 'start';
export type MetricRange = '15m' | '1h' | '6h' | '24h';

export interface RuntimeResources {
  cpuPercent: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  memoryLimitMb: number | null;
  memoryLimitSource: 'cgroup' | 'v8-heap';
  memoryPercent: number | null;
  eventLoopMeanMs: number;
  eventLoopP99Ms: number;
  gcPauseMs: number;
  gcCount: number;
  activeHandles: number;
}

export interface RuntimeReason {
  code: string;
  message: string;
}

export interface RuntimeAlert {
  key: string;
  message: string;
  value: number;
  threshold: number;
  since: string;
}

export interface ActionAvailability {
  allowed: boolean;
  reason?: string;
}

export interface RuntimeSummary {
  id: RuntimeId;
  name: string;
  kind: 'long-running';
  status: RuntimeStatus;
  reasons: RuntimeReason[];
  alerts: RuntimeAlert[];
  pid: number | null;
  uptimeSec: number | null;
  startedAt: string | null;
  lastSeenAt: string | null;
  lastRestartAt: string | null;
  restartCount: number;
  resources: RuntimeResources | null;
  metrics: Record<string, MetricValue>;
  supervisor: string | null;
  actions: Record<RuntimeAction, ActionAvailability>;
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
  type: string;
  framework: string;
  adapter?: string;
  port?: number;
  entrypoint: string;
  sourcePath: string;
  details?: Record<string, MetricValue>;
}

export interface RestartHistoryItem {
  at: string;
  reason: string;
  reasonCode: string;
  downtimeMs: number | null;
  exitCode: number | null;
}

export interface RuntimeDetail extends RuntimeSummary {
  environment: string | null;
  process: RuntimeProcessInfo | null;
  descriptor: RuntimeDescriptor | null;
  details: Record<string, unknown>;
  restartHistory: RestartHistoryItem[];
  lastExitCode: number | null;
  thresholds: RuntimeThresholds;
}

export interface RuntimeEvent {
  id: string;
  runtime: RuntimeId;
  runtimeName: string;
  type: string;
  level: 'info' | 'warn' | 'error' | 'success';
  at: string;
  message: string;
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

export interface RuntimeThresholds {
  memoryPercent: number;
  cpuPercent: number;
  eventLoopMs: number;
}

export interface RuntimesOverview {
  telemetry: { available: boolean; reason?: string };
  thresholds: RuntimeThresholds;
  summary: {
    running: number;
    total: number;
    warnings: number;
    down: number;
    unknown: number;
    restartsToday: number;
    totalCpuPercent: number | null;
    totalMemoryMb: number | null;
    totalMemoryLimitMb: number | null;
  };
  runtimes: RuntimeSummary[];
  cli: {
    lastExecution: CliExecution | null;
    executionsToday: number;
    failuresToday: number;
    recent: CliExecution[];
  };
}

export interface RuntimeSample {
  t: number;
  cpu: number;
  mem: number;
  heap: number;
  elp99: number;
  starts: number;
}

export type RuntimeSeries = Partial<Record<RuntimeId, RuntimeSample[]>>;

export interface RuntimeLog {
  t: string;
  level: string;
  context?: string;
  /** Có khi log phát sinh trong một HTTP request. */
  correlationId?: string;
  message: string;
}

export interface RuntimeCommand {
  id: string;
  runtime: RuntimeId;
  action: 'restart' | 'pause' | 'resume';
  mode?: RestartMode;
  requestedAt: string;
  status: 'pending' | 'accepted' | 'completed' | 'failed';
  message?: string;
}
