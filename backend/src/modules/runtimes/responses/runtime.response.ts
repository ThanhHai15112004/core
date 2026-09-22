import type {
  CliExecution,
  MetricValue,
  RuntimeDescriptor,
  RuntimeEventType,
  RuntimeProcessInfo,
  RuntimeResources,
  RuntimeSample,
  RuntimeCommandStatus,
  RuntimeCommandAction,
  RestartMode,
} from '@packages/runtime/index.js';

/** Trạng thái hiển thị (suy ra từ heartbeat + sự kiện). */
export type RuntimeStatus =
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'restarting'
  | 'crashed'
  | 'unknown';

export interface RuntimeReasonDto {
  code: string;
  message: string;
}

export interface RuntimeAlertDto {
  key: string;
  message: string;
  value: number;
  threshold: number;
  since: string;
}

export interface RuntimeActionAvailabilityDto {
  allowed: boolean;
  reason?: string;
}

export interface RuntimeActionsDto {
  restart: RuntimeActionAvailabilityDto;
  stop: RuntimeActionAvailabilityDto;
  start: RuntimeActionAvailabilityDto;
}

export interface RuntimeSummaryDto {
  id: string;
  name: string;
  kind: 'long-running';
  status: RuntimeStatus;
  reasons: RuntimeReasonDto[];
  alerts: RuntimeAlertDto[];
  pid: number | null;
  uptimeSec: number | null;
  startedAt: string | null;
  lastSeenAt: string | null;
  lastRestartAt: string | null;
  restartCount: number;
  resources: RuntimeResources | null;
  metrics: Record<string, MetricValue>;
  supervisor: string | null;
  actions: RuntimeActionsDto;
}

export interface RestartHistoryItemDto {
  at: string;
  reason: string;
  reasonCode: string;
  downtimeMs: number | null;
  exitCode: number | null;
}

export interface RuntimeDetailDto extends RuntimeSummaryDto {
  environment: string | null;
  process: RuntimeProcessInfo | null;
  descriptor: RuntimeDescriptor | null;
  details: Record<string, unknown>;
  restartHistory: RestartHistoryItemDto[];
  lastExitCode: number | null;
  thresholds: RuntimeThresholdsDto;
}

export interface RuntimeEventDto {
  id: string;
  runtime: string;
  runtimeName: string;
  type: RuntimeEventType;
  level: 'info' | 'warn' | 'error' | 'success';
  at: string;
  message: string;
}

export interface CliPanelDto {
  lastExecution: CliExecution | null;
  executionsToday: number;
  failuresToday: number;
  recent: CliExecution[];
}

export interface RuntimeThresholdsDto {
  memoryPercent: number;
  cpuPercent: number;
  eventLoopMs: number;
}

export interface RuntimesOverviewDto {
  telemetry: { available: boolean; reason?: string };
  thresholds: RuntimeThresholdsDto;
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
  runtimes: RuntimeSummaryDto[];
  cli: CliPanelDto;
}

export type RuntimeSeriesDto = Record<string, RuntimeSample[]>;

export interface RuntimeLogDto {
  t: string;
  level: string;
  context?: string;
  correlationId?: string;
  message: string;
}

export interface RuntimeCommandDto {
  id: string;
  runtime: string;
  action: RuntimeCommandAction;
  mode?: RestartMode;
  requestedAt: string;
  status: RuntimeCommandStatus;
  message?: string;
}
