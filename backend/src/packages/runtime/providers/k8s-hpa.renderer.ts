import type {
  AutoscalingTarget,
  AutoscalingWorkloadPolicy,
} from './autoscaling-policy.evaluator.js';

export interface RenderHpaOptions {
  readonly target: AutoscalingTarget;
  readonly policy: AutoscalingWorkloadPolicy;
  readonly namespace?: string | undefined;
  readonly deploymentName?: string | undefined;
  readonly hpaName?: string | undefined;
}

/**
 * Sinh manifest Kubernetes HorizontalPodAutoscaler (`autoscaling/v2`) đồng bộ hoàn toàn với
 * policy autoscaling hiện hành (minReplicas, maxReplicas, CPU/Memory, custom metric & cooldown behavior).
 */
export function renderKubernetesHpaYaml(options: RenderHpaOptions): string {
  const { target, policy } = options;
  const namespace = options.namespace?.trim() || 'default';
  const deploymentName =
    options.deploymentName?.trim() || (target === 'api' ? 'core-api' : 'core-worker');
  const hpaName = options.hpaName?.trim() || `${deploymentName}-hpa`;

  const customMetricBlock =
    target === 'api'
      ? `    - type: Pods
      pods:
        metric:
          name: http_requests_in_flight
        target:
          type: AverageValue
          averageValue: "${policy.targetInFlightPerInstance ?? 100}"`
      : `    - type: External
      external:
        metric:
          name: core_queue_backlog_total
        target:
          type: AverageValue
          averageValue: "${policy.targetBacklogPerInstance ?? 50}"`;

  return `# Generated from Core Framework Autoscaling Policy (${target})
# Requires metrics-server (CPU/Memory) + prometheus-adapter (custom/external metrics)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${hpaName}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/name: ${deploymentName}
    app.kubernetes.io/component: ${target}
    app.kubernetes.io/managed-by: core-framework
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${deploymentName}
  minReplicas: ${Math.max(1, Math.trunc(policy.minReplicas))}
  maxReplicas: ${Math.max(Math.max(1, Math.trunc(policy.minReplicas)), Math.trunc(policy.maxReplicas))}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: ${Math.trunc(policy.targetCpuPercent)}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: ${Math.trunc(policy.targetMemoryPercent)}
${customMetricBlock}
  behavior:
    scaleUp:
      stabilizationWindowSeconds: ${Math.max(0, Math.trunc(policy.scaleUpCooldownSec))}
      selectPolicy: Max
      policies:
        - type: Pods
          value: ${Math.max(1, Math.trunc(policy.scaleUpMaxStep))}
          periodSeconds: ${Math.max(15, Math.min(120, Math.trunc(policy.scaleUpCooldownSec) || 60))}
    scaleDown:
      stabilizationWindowSeconds: ${Math.max(0, Math.trunc(policy.scaleDownCooldownSec))}
      selectPolicy: Min
      policies:
        - type: Pods
          value: ${Math.max(1, Math.trunc(policy.scaleDownMaxStep))}
          periodSeconds: ${Math.max(30, Math.min(300, Math.trunc(policy.scaleDownCooldownSec) || 60))}
`;
}
