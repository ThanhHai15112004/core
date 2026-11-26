import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService, readPoolStats } from '@packages/database/index.js';
import { SettingRegistryService, defaultSettingRegistry } from '@packages/kernel/index.js';
import { MetricsRegistryService, PrometheusQueryClient } from '@packages/metrics/index.js';
import { QueueMonitoringService } from '@packages/queue/index.js';
import {
  RUNTIME_CPU_PERCENT_METRIC,
  RUNTIME_MEMORY_LIMIT_BYTES_METRIC,
  RUNTIME_MEMORY_PERCENT_METRIC,
  RUNTIME_MEMORY_RSS_BYTES_METRIC,
  RuntimeAgentService,
  evaluateAutoscalingDbImpact,
  evaluateAutoscalingDecision,
  renderKubernetesHpaYaml,
  type AutoscalingCooldownState,
  type AutoscalingSignals,
  type AutoscalingTarget,
  type AutoscalingWorkloadPolicy,
  type RuntimeHeartbeat,
} from '@packages/runtime/index.js';
import { resolveAutoscalingConfig } from '../helpers/autoscaling-config.helper.js';
import type {
  AutoscalingHpaDto,
  AutoscalingInstanceSnapshotDto,
  AutoscalingMetricCatalogItemDto,
  AutoscalingOverviewDto,
  AutoscalingQueueBacklogItemDto,
  AutoscalingSimulateResultDto,
  AutoscalingWorkloadStatusDto,
} from '../responses/autoscaling.response.js';
import { RuntimeStoreService } from './runtime-store.service.js';

export interface SimulateAutoscalingParams {
  readonly target: AutoscalingTarget;
  readonly currentReplicas: number;
  readonly signals: AutoscalingSignals;
  readonly cooldown?: AutoscalingCooldownState | undefined;
  readonly policyOverrides?:
    | {
        readonly minReplicas?: number | undefined;
        readonly maxReplicas?: number | undefined;
        readonly scaleUpCooldownSec?: number | undefined;
        readonly scaleDownCooldownSec?: number | undefined;
        readonly scaleUpMaxStep?: number | undefined;
        readonly scaleDownMaxStep?: number | undefined;
        readonly targetCpuPercent?: number | undefined;
        readonly targetMemoryPercent?: number | undefined;
        readonly targetInFlightPerInstance?: number | undefined;
        readonly targetBacklogPerInstance?: number | undefined;
      }
    | undefined;
  readonly tolerancePercent?: number | undefined;
  readonly nowMs?: number | undefined;
}

const PUBLISHED_METRICS_CATALOG: readonly AutoscalingMetricCatalogItemDto[] = [
  {
    name: RUNTIME_CPU_PERCENT_METRIC,
    target: 'all',
    purpose: 'Process CPU utilization % per runtime/instance (basic autoscaler)',
  },
  {
    name: RUNTIME_MEMORY_PERCENT_METRIC,
    target: 'all',
    purpose: 'Process memory utilization % vs cgroup/V8 limit (basic autoscaler)',
  },
  {
    name: RUNTIME_MEMORY_RSS_BYTES_METRIC,
    target: 'all',
    purpose: 'Resident memory bytes per runtime/instance',
  },
  {
    name: RUNTIME_MEMORY_LIMIT_BYTES_METRIC,
    target: 'all',
    purpose: 'Effective cgroup or V8 heap memory limit in bytes',
  },
  {
    name: 'http_requests_in_flight',
    target: 'api',
    purpose: 'Current concurrent inbound HTTP requests for API autoscaling',
  },
  {
    name: 'core_queue_backlog',
    target: 'worker',
    purpose: 'Queue backlog (waiting + prioritized + delayed) per queue for Worker autoscaling',
  },
  {
    name: 'core_queue_backlog_total',
    target: 'worker',
    purpose: 'Aggregate queue backlog across all BullMQ queues for Worker HPA/KEDA',
  },
  {
    name: 'core_db_pool_connections',
    target: 'database',
    purpose: 'Database connection pool usage (used/idle/waiting/limit) during scale events',
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function avgOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function toInstanceSnapshot(
  hb: RuntimeHeartbeat,
  includeInFlight: boolean,
): AutoscalingInstanceSnapshotDto {
  const rawInFlight = hb.metrics['inFlightRequests'];
  return {
    instance: hb.instance,
    state: hb.state,
    cpuPercent: hb.resources?.cpuPercent ?? null,
    memoryPercent: hb.resources?.memoryPercent ?? null,
    rssMb: hb.resources?.rssMb ?? null,
    ...(includeInFlight
      ? { inFlightRequests: typeof rawInFlight === 'number' ? rawInFlight : null }
      : {}),
    uptimeSec: hb.uptimeSec,
  };
}

/**
 * Điều phối quan sát & đánh giá chính sách Autoscaling (Phase 13.2):
 * - Đọc chính sách từ `.env` + override động `SettingRegistryService`.
 * - Đọc metrics CPU, RAM, in-flight HTTP, queue backlog và DB pool thực tế.
 * - Tính đề xuất scale (min/max, cooldown, DB pool budget) & sinh manifest K8s HPA YAML.
 */
@Injectable()
export class RuntimeAutoscalingService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly config: CoreConfigService,
    private readonly store: RuntimeStoreService,
    @Optional()
    @Inject(SettingRegistryService)
    settingRegistry?: SettingRegistryService,
    @Optional() private readonly queueMonitoring?: QueueMonitoringService,
    @Optional() private readonly dbConnection?: DatabaseConnectionService,
    @Optional() private readonly metricsRegistry?: MetricsRegistryService,
    @Optional() private readonly promClient?: PrometheusQueryClient,
    @Optional() private readonly runtimeAgent?: RuntimeAgentService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  /** Tổng hợp trạng thái Autoscaling, tín hiệu tải hiện tại và dự báo tác động DB. */
  public async getOverview(): Promise<AutoscalingOverviewDto> {
    const resolved = resolveAutoscalingConfig(this.config, this.settingRegistry);
    const [apiHbs, workerHbs, queueBacklog, dbObserved] = await Promise.all([
      this.store.instanceHeartbeats('api'),
      this.store.instanceHeartbeats('worker'),
      this.collectQueueBacklog(),
      this.collectDatabaseObserved(),
    ]);

    const apiInstances = apiHbs.map((hb) => toInstanceSnapshot(hb, true));
    const workerInstances = workerHbs.map((hb) => toInstanceSnapshot(hb, false));

    const apiCpu =
      avgOrNull(apiInstances.map((i) => i.cpuPercent).filter((v): v is number => v !== null)) ??
      (await this.readLocalGauge(RUNTIME_CPU_PERCENT_METRIC));
    const apiMem =
      avgOrNull(apiInstances.map((i) => i.memoryPercent).filter((v): v is number => v !== null)) ??
      (await this.readLocalGauge(RUNTIME_MEMORY_PERCENT_METRIC));
    const apiInFlight = await this.resolveInFlightRequests(apiInstances);

    const workerCpu = avgOrNull(
      workerInstances.map((i) => i.cpuPercent).filter((v): v is number => v !== null),
    );
    const workerMem = avgOrNull(
      workerInstances.map((i) => i.memoryPercent).filter((v): v is number => v !== null),
    );
    const queueBacklogTotal = this.resolveBacklogTotal(queueBacklog, workerHbs);

    const activeApiCount = apiInstances.length > 0 ? apiInstances.length : 1;
    const activeWorkerCount = workerInstances.length;

    const apiDecision = evaluateAutoscalingDecision({
      target: 'api',
      currentReplicas: activeApiCount,
      policy: resolved.api,
      signals: {
        cpuPercent: apiCpu,
        memoryPercent: apiMem,
        inFlightRequests: apiInFlight,
      },
      tolerancePercent: resolved.tolerancePercent,
    });

    const workerDecision = evaluateAutoscalingDecision({
      target: 'worker',
      currentReplicas: activeWorkerCount,
      policy: resolved.worker,
      signals: {
        cpuPercent: workerCpu,
        memoryPercent: workerMem,
        queueBacklog: queueBacklogTotal,
      },
      tolerancePercent: resolved.tolerancePercent,
    });

    const databaseImpact = evaluateAutoscalingDbImpact({
      activeApiReplicas: activeApiCount,
      activeWorkerReplicas: activeWorkerCount,
      recommendedApiReplicas: apiDecision.recommendedReplicas,
      recommendedWorkerReplicas: workerDecision.recommendedReplicas,
      maxApiReplicas: resolved.api.maxReplicas,
      maxWorkerReplicas: resolved.worker.maxReplicas,
      perInstancePoolLimit: this.config.database.maxConnections,
      maxConnectionsBudget: resolved.database.maxConnectionsBudget,
      warnUtilizationPercent: resolved.database.warnUtilizationPercent,
      observedPoolUsed: dbObserved.poolUsed,
      observedPoolWaiting: dbObserved.poolWaiting,
      observedDbSessions: dbObserved.sessions,
    });

    const apiWorkload: AutoscalingWorkloadStatusDto = {
      target: 'api',
      activeInstances: activeApiCount,
      instances: apiInstances,
      metrics: {
        avgCpuPercent: apiCpu,
        avgMemoryPercent: apiMem,
        inFlightRequests: apiInFlight,
      },
      policy: resolved.api,
      decision: apiDecision,
    };

    const workerWorkload: AutoscalingWorkloadStatusDto = {
      target: 'worker',
      activeInstances: activeWorkerCount,
      instances: workerInstances,
      metrics: {
        avgCpuPercent: workerCpu,
        avgMemoryPercent: workerMem,
        queueBacklogTotal,
      },
      policy: resolved.worker,
      decision: workerDecision,
    };

    return {
      enabled: resolved.enabled,
      tolerancePercent: resolved.tolerancePercent,
      collectedAt: new Date().toISOString(),
      configSource: resolved.overriddenKeys.length > 0 ? 'settings_override' : 'env',
      overriddenKeys: resolved.overriddenKeys,
      workloads: {
        api: apiWorkload,
        worker: workerWorkload,
      },
      queues: queueBacklog.items,
      databaseImpact,
      publishedMetrics: PUBLISHED_METRICS_CATALOG,
    };
  }

  /** Mô phỏng quyết định autoscaling với bộ tín hiệu & mốc cooldown tùy chỉnh. */
  public simulate(params: SimulateAutoscalingParams): AutoscalingSimulateResultDto {
    const resolved = resolveAutoscalingConfig(this.config, this.settingRegistry);
    const basePolicy = params.target === 'api' ? resolved.api : resolved.worker;
    const ov = params.policyOverrides;
    const policy: AutoscalingWorkloadPolicy = {
      minReplicas: ov?.minReplicas ?? basePolicy.minReplicas,
      maxReplicas: ov?.maxReplicas ?? basePolicy.maxReplicas,
      scaleUpCooldownSec: ov?.scaleUpCooldownSec ?? basePolicy.scaleUpCooldownSec,
      scaleDownCooldownSec: ov?.scaleDownCooldownSec ?? basePolicy.scaleDownCooldownSec,
      scaleUpMaxStep: ov?.scaleUpMaxStep ?? basePolicy.scaleUpMaxStep,
      scaleDownMaxStep: ov?.scaleDownMaxStep ?? basePolicy.scaleDownMaxStep,
      targetCpuPercent: ov?.targetCpuPercent ?? basePolicy.targetCpuPercent,
      targetMemoryPercent: ov?.targetMemoryPercent ?? basePolicy.targetMemoryPercent,
      targetInFlightPerInstance:
        ov?.targetInFlightPerInstance ?? basePolicy.targetInFlightPerInstance,
      targetBacklogPerInstance: ov?.targetBacklogPerInstance ?? basePolicy.targetBacklogPerInstance,
    };
    const decision = evaluateAutoscalingDecision({
      target: params.target,
      currentReplicas: params.currentReplicas,
      policy,
      signals: params.signals,
      cooldown: params.cooldown,
      tolerancePercent: params.tolerancePercent ?? resolved.tolerancePercent,
      nowMs: params.nowMs,
    });
    return { policy, decision };
  }

  /** Sinh manifest Kubernetes HPA (`autoscaling/v2`) khớp chính sách hiện hành. */
  public renderHpa(
    target: AutoscalingTarget,
    options?: { namespace?: string | undefined; deploymentName?: string | undefined },
  ): AutoscalingHpaDto {
    const resolved = resolveAutoscalingConfig(this.config, this.settingRegistry);
    const policy = target === 'api' ? resolved.api : resolved.worker;
    const yaml = renderKubernetesHpaYaml({
      target,
      policy,
      namespace: options?.namespace,
      deploymentName: options?.deploymentName,
    });
    return {
      target,
      filename: target === 'api' ? 'hpa-api.yaml' : 'hpa-worker.yaml',
      policy,
      yaml,
    };
  }

  private async readLocalGauge(metricName: string): Promise<number | null> {
    if (!this.metricsRegistry) return null;
    const json = await this.metricsRegistry.getMetricsJson().catch(() => []);
    const metric = json.find((m) => m.name === metricName);
    const val = metric?.values?.[0]?.value;
    return typeof val === 'number' && Number.isFinite(val) ? round2(val) : null;
  }

  private async resolveInFlightRequests(
    apiInstances: readonly AutoscalingInstanceSnapshotDto[],
  ): Promise<number> {
    if (this.promClient?.configured) {
      const promVal = await this.promClient.value('sum(http_requests_in_flight)').catch(() => null);
      if (promVal !== null && Number.isFinite(promVal)) {
        return Math.max(0, Math.round(promVal));
      }
    }
    const fromHeartbeats = apiInstances
      .map((i) => i.inFlightRequests)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (fromHeartbeats.length > 0) {
      return fromHeartbeats.reduce((sum, v) => sum + v, 0);
    }
    if (this.runtimeAgent) {
      return this.runtimeAgent.getInFlightCount();
    }
    if (this.metricsRegistry) {
      const json = await this.metricsRegistry.getMetricsJson().catch(() => []);
      const metric = json.find((m) => m.name === 'http_requests_in_flight');
      const val = metric?.values?.[0]?.value;
      if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, Math.round(val));
    }
    return 0;
  }

  private async collectQueueBacklog(): Promise<{
    items: AutoscalingQueueBacklogItemDto[];
    total: number | null;
  }> {
    if (this.queueMonitoring?.usable()) {
      const liveQueues = await this.queueMonitoring.queues().catch(() => null);
      if (liveQueues) {
        const items: AutoscalingQueueBacklogItemDto[] = liveQueues.map((q) => {
          const waiting = q.counts.waiting + (q.counts.prioritized ?? 0);
          const delayed = q.counts.delayed;
          return {
            queue: q.name,
            waiting,
            delayed,
            active: q.counts.active,
            backlog: waiting + delayed,
            workers: q.workers?.length ?? 0,
          };
        });
        return {
          items,
          total: items.reduce((sum, q) => sum + q.backlog, 0),
        };
      }
    }
    if (this.promClient?.configured) {
      const promTotal = await this.promClient
        .value('max(core_queue_backlog_total)')
        .catch(() => null);
      if (promTotal !== null && Number.isFinite(promTotal)) {
        return { items: [], total: Math.max(0, Math.round(promTotal)) };
      }
    }
    return { items: [], total: null };
  }

  private resolveBacklogTotal(
    queueBacklog: { total: number | null },
    workerHbs: readonly RuntimeHeartbeat[],
  ): number | null {
    if (queueBacklog.total !== null) return queueBacklog.total;
    for (const hb of workerHbs) {
      const v = hb.metrics['totalBacklog'];
      if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
    }
    return null;
  }

  private async collectDatabaseObserved(): Promise<{
    poolUsed: number | null;
    poolWaiting: number | null;
    sessions: number | null;
  }> {
    const pool = readPoolStats(this.dbConnection?.connected()?.driver);
    const sessions = this.promClient?.configured
      ? await this.promClient.value('max(core_db_sessions)').catch(() => null)
      : null;
    return {
      poolUsed: pool?.used ?? null,
      poolWaiting: pool?.waiting ?? null,
      sessions: sessions !== null && Number.isFinite(sessions) ? Math.round(sessions) : null,
    };
  }
}
