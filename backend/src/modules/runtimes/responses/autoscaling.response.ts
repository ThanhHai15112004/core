import type {
  AutoscalingDbImpact,
  AutoscalingDecision,
  AutoscalingTarget,
  AutoscalingWorkloadPolicy,
} from '@packages/runtime/index.js';

export interface AutoscalingInstanceSnapshotDto {
  readonly instance: string;
  readonly state: string;
  readonly cpuPercent: number | null;
  readonly memoryPercent: number | null;
  readonly rssMb: number | null;
  readonly inFlightRequests?: number | null;
  readonly uptimeSec: number;
}

export interface AutoscalingQueueBacklogItemDto {
  readonly queue: string;
  readonly waiting: number;
  readonly delayed: number;
  readonly active: number;
  readonly backlog: number;
  readonly workers: number;
}

export interface AutoscalingWorkloadStatusDto {
  readonly target: AutoscalingTarget;
  readonly activeInstances: number;
  readonly instances: readonly AutoscalingInstanceSnapshotDto[];
  readonly metrics: {
    readonly avgCpuPercent: number | null;
    readonly avgMemoryPercent: number | null;
    readonly inFlightRequests?: number | null;
    readonly queueBacklogTotal?: number | null;
  };
  readonly policy: AutoscalingWorkloadPolicy;
  readonly decision: AutoscalingDecision;
}

export interface AutoscalingMetricCatalogItemDto {
  readonly name: string;
  readonly target: 'api' | 'worker' | 'all' | 'database';
  readonly purpose: string;
}

export interface AutoscalingOverviewDto {
  readonly enabled: boolean;
  readonly tolerancePercent: number;
  readonly collectedAt: string;
  readonly configSource: 'env' | 'settings_override';
  readonly overriddenKeys: readonly string[];
  readonly workloads: {
    readonly api: AutoscalingWorkloadStatusDto;
    readonly worker: AutoscalingWorkloadStatusDto;
  };
  readonly queues: readonly AutoscalingQueueBacklogItemDto[];
  readonly databaseImpact: AutoscalingDbImpact;
  readonly publishedMetrics: readonly AutoscalingMetricCatalogItemDto[];
}

export interface AutoscalingSimulateResultDto {
  readonly policy: AutoscalingWorkloadPolicy;
  readonly decision: AutoscalingDecision;
}

export interface AutoscalingHpaDto {
  readonly target: AutoscalingTarget;
  readonly filename: string;
  readonly policy: AutoscalingWorkloadPolicy;
  readonly yaml: string;
}
