export type AutoscalingTarget = 'api' | 'worker';
export type AutoscalingAction = 'scale_up' | 'scale_down' | 'hold';
export type AutoscalingSignalName = 'cpu' | 'memory' | 'in_flight_requests' | 'queue_backlog';

export interface AutoscalingWorkloadPolicy {
  readonly minReplicas: number;
  readonly maxReplicas: number;
  readonly scaleUpCooldownSec: number;
  readonly scaleDownCooldownSec: number;
  readonly scaleUpMaxStep: number;
  readonly scaleDownMaxStep: number;
  readonly targetCpuPercent: number;
  readonly targetMemoryPercent: number;
  /** Áp dụng cho API (`http_requests_in_flight` mục tiêu trên mỗi instance). */
  readonly targetInFlightPerInstance?: number | undefined;
  /** Áp dụng cho Worker (`core_queue_backlog_total` mục tiêu trên mỗi instance). */
  readonly targetBacklogPerInstance?: number | undefined;
}

export interface AutoscalingSignals {
  /** Trung bình CPU% trên các instance đang chạy (100 = 1 core). */
  readonly cpuPercent: number | null;
  /** Trung bình RAM% so với limit trên các instance đang chạy. */
  readonly memoryPercent: number | null;
  /** Tổng số HTTP request đang xử lý trên toàn nhóm API (hoặc instance hiện tại). */
  readonly inFlightRequests?: number | null | undefined;
  /** Tổng queue backlog (`waiting + prioritized + delayed`). */
  readonly queueBacklog?: number | null | undefined;
}

export interface AutoscalingCooldownState {
  readonly lastScaleUpAtMs?: number | null | undefined;
  readonly lastScaleDownAtMs?: number | null | undefined;
}

export interface AutoscalingSignalEvaluation {
  readonly signal: AutoscalingSignalName;
  readonly currentValue: number | null;
  readonly targetPerInstance: number;
  readonly utilizationRatio: number | null;
  readonly desiredReplicas: number | null;
}

export interface AutoscalingDecision {
  readonly target: AutoscalingTarget;
  readonly currentReplicas: number;
  readonly rawDesiredReplicas: number;
  readonly clampedDesiredReplicas: number;
  readonly recommendedReplicas: number;
  readonly action: AutoscalingAction;
  readonly clampedBy: 'min' | 'max' | null;
  readonly dominantSignal: AutoscalingSignalName | null;
  readonly cooldownActive: boolean;
  readonly cooldownRemainingSec: number;
  readonly blockedReason: 'scale_up_cooldown' | 'scale_down_cooldown' | 'within_tolerance' | null;
  readonly signals: readonly AutoscalingSignalEvaluation[];
}

export interface EvaluateAutoscalingInput {
  readonly target: AutoscalingTarget;
  readonly currentReplicas: number;
  readonly policy: AutoscalingWorkloadPolicy;
  readonly signals: AutoscalingSignals;
  readonly cooldown?: AutoscalingCooldownState | undefined;
  /** Dải chống nhiễu (%) giống Kubernetes HPA tolerance (mặc định 10%). */
  readonly tolerancePercent?: number | undefined;
  readonly nowMs?: number | undefined;
}

export interface AutoscalingDbImpactInput {
  readonly activeApiReplicas: number;
  readonly activeWorkerReplicas: number;
  readonly recommendedApiReplicas: number;
  readonly recommendedWorkerReplicas: number;
  readonly maxApiReplicas: number;
  readonly maxWorkerReplicas: number;
  readonly perInstancePoolLimit: number;
  readonly maxConnectionsBudget: number;
  readonly warnUtilizationPercent: number;
  readonly observedPoolUsed?: number | null;
  readonly observedPoolWaiting?: number | null;
  readonly observedDbSessions?: number | null;
}

export interface AutoscalingDbImpact {
  readonly perInstancePoolLimit: number;
  readonly maxConnectionsBudget: number;
  readonly currentProjectedConnections: number;
  readonly recommendedProjectedConnections: number;
  readonly maxProjectedConnections: number;
  readonly recommendedBudgetPercent: number;
  readonly maxBudgetPercent: number;
  readonly observedPoolUsed: number | null;
  readonly observedPoolWaiting: number | null;
  readonly observedDbSessions: number | null;
  readonly risk: 'ok' | 'warn' | 'crit';
  readonly message: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sanitizePolicy(policy: AutoscalingWorkloadPolicy): AutoscalingWorkloadPolicy {
  const minReplicas = Math.max(1, Math.trunc(policy.minReplicas));
  const maxReplicas = Math.max(minReplicas, Math.trunc(policy.maxReplicas));
  return {
    ...policy,
    minReplicas,
    maxReplicas,
    scaleUpCooldownSec: Math.max(0, Math.trunc(policy.scaleUpCooldownSec)),
    scaleDownCooldownSec: Math.max(0, Math.trunc(policy.scaleDownCooldownSec)),
    scaleUpMaxStep: Math.max(1, Math.trunc(policy.scaleUpMaxStep)),
    scaleDownMaxStep: Math.max(1, Math.trunc(policy.scaleDownMaxStep)),
    targetCpuPercent: Math.max(1, policy.targetCpuPercent),
    targetMemoryPercent: Math.max(1, policy.targetMemoryPercent),
    ...(policy.targetInFlightPerInstance !== undefined
      ? { targetInFlightPerInstance: Math.max(1, policy.targetInFlightPerInstance) }
      : {}),
    ...(policy.targetBacklogPerInstance !== undefined
      ? { targetBacklogPerInstance: Math.max(1, policy.targetBacklogPerInstance) }
      : {}),
  };
}

/**
 * Đánh giá quyết định Autoscaling theo chuẩn HPA (`autoscaling/v2`):
 * - Lấy giá trị `desiredReplicas` lớn nhất giữa các tín hiệu (CPU, RAM, In-flight / Queue Backlog).
 * - Áp dụng dải chống nhiễu (tolerance), chặn biên `[minReplicas, maxReplicas]`.
 * - Áp dụng thời gian chờ sau khi scale (`scaleUpCooldownSec` / `scaleDownCooldownSec`) & bước nhảy tối đa (`maxStep`).
 */
export function evaluateAutoscalingDecision(input: EvaluateAutoscalingInput): AutoscalingDecision {
  const policy = sanitizePolicy(input.policy);
  const currentReplicas = Math.max(0, Math.trunc(input.currentReplicas));
  const baselineReplicas = Math.max(1, currentReplicas);
  const tolerance = Math.max(0, Math.min(50, input.tolerancePercent ?? 10)) / 100;
  const nowMs = input.nowMs ?? Date.now();

  const signalEvals: AutoscalingSignalEvaluation[] = [];

  const pushUtilizationSignal = (
    signal: 'cpu' | 'memory',
    currentValue: number | null | undefined,
    target: number,
  ): void => {
    if (currentValue === null || currentValue === undefined || !Number.isFinite(currentValue)) {
      signalEvals.push({
        signal,
        currentValue: null,
        targetPerInstance: target,
        utilizationRatio: null,
        desiredReplicas: null,
      });
      return;
    }
    const safeVal = Math.max(0, currentValue);
    const ratio = safeVal / target;
    const withinBand = currentReplicas > 0 && Math.abs(1 - ratio) <= tolerance;
    const desired = withinBand ? currentReplicas : Math.max(1, Math.ceil(baselineReplicas * ratio));
    signalEvals.push({
      signal,
      currentValue: round2(safeVal),
      targetPerInstance: target,
      utilizationRatio: round2(ratio),
      desiredReplicas: desired,
    });
  };

  const pushAbsoluteWorkSignal = (
    signal: 'in_flight_requests' | 'queue_backlog',
    totalValue: number | null | undefined,
    targetPerInstance: number,
  ): void => {
    if (totalValue === null || totalValue === undefined || !Number.isFinite(totalValue)) {
      signalEvals.push({
        signal,
        currentValue: null,
        targetPerInstance,
        utilizationRatio: null,
        desiredReplicas: null,
      });
      return;
    }
    const safeVal = Math.max(0, totalValue);
    const perInstance = safeVal / baselineReplicas;
    const ratio = perInstance / targetPerInstance;
    const withinBand = currentReplicas > 0 && Math.abs(1 - ratio) <= tolerance;
    const desired = withinBand
      ? currentReplicas
      : safeVal === 0
        ? policy.minReplicas
        : Math.max(1, Math.ceil(safeVal / targetPerInstance));
    signalEvals.push({
      signal,
      currentValue: round2(safeVal),
      targetPerInstance,
      utilizationRatio: round2(ratio),
      desiredReplicas: desired,
    });
  };

  pushUtilizationSignal('cpu', input.signals.cpuPercent, policy.targetCpuPercent);
  pushUtilizationSignal('memory', input.signals.memoryPercent, policy.targetMemoryPercent);

  if (input.target === 'api' && policy.targetInFlightPerInstance !== undefined) {
    pushAbsoluteWorkSignal(
      'in_flight_requests',
      input.signals.inFlightRequests,
      policy.targetInFlightPerInstance,
    );
  }
  if (input.target === 'worker' && policy.targetBacklogPerInstance !== undefined) {
    pushAbsoluteWorkSignal(
      'queue_backlog',
      input.signals.queueBacklog,
      policy.targetBacklogPerInstance,
    );
  }

  let dominantSignal: AutoscalingSignalName | null = null;
  let rawDesiredReplicas = currentReplicas > 0 ? currentReplicas : policy.minReplicas;
  const availableSignals = signalEvals.filter((s) => s.desiredReplicas !== null);
  if (availableSignals.length > 0) {
    rawDesiredReplicas = 0;
    for (const s of availableSignals) {
      const desired = s.desiredReplicas!;
      if (desired > rawDesiredReplicas) {
        rawDesiredReplicas = desired;
        dominantSignal = s.signal;
      }
    }
  }

  let clampedDesiredReplicas = rawDesiredReplicas;
  let clampedBy: 'min' | 'max' | null = null;
  if (clampedDesiredReplicas < policy.minReplicas) {
    clampedDesiredReplicas = policy.minReplicas;
    clampedBy = 'min';
  } else if (clampedDesiredReplicas > policy.maxReplicas) {
    clampedDesiredReplicas = policy.maxReplicas;
    clampedBy = 'max';
  }

  // Trường hợp currentReplicas < minReplicas (ví dụ mới khởi động hoặc tụt pod): ưu tiên khôi phục ngay về minReplicas.
  const recoveringBelowMin = currentReplicas < policy.minReplicas;

  const lastUpMs = input.cooldown?.lastScaleUpAtMs ?? null;
  const lastDownMs = input.cooldown?.lastScaleDownAtMs ?? null;

  let recommendedReplicas = clampedDesiredReplicas;
  let action: AutoscalingAction = 'hold';
  let cooldownActive = false;
  let cooldownRemainingSec = 0;
  let blockedReason: AutoscalingDecision['blockedReason'] = null;

  if (clampedDesiredReplicas > currentReplicas) {
    const upElapsedSec = lastUpMs !== null ? Math.max(0, (nowMs - lastUpMs) / 1000) : Infinity;
    if (
      !recoveringBelowMin &&
      policy.scaleUpCooldownSec > 0 &&
      upElapsedSec < policy.scaleUpCooldownSec
    ) {
      cooldownActive = true;
      cooldownRemainingSec = Math.ceil(policy.scaleUpCooldownSec - upElapsedSec);
      recommendedReplicas = currentReplicas;
      action = 'hold';
      blockedReason = 'scale_up_cooldown';
    } else {
      const stepped = recoveringBelowMin
        ? Math.max(
            policy.minReplicas,
            Math.min(clampedDesiredReplicas, currentReplicas + policy.scaleUpMaxStep),
          )
        : Math.min(clampedDesiredReplicas, currentReplicas + policy.scaleUpMaxStep);
      recommendedReplicas = Math.min(policy.maxReplicas, stepped);
      action = recommendedReplicas > currentReplicas ? 'scale_up' : 'hold';
    }
  } else if (clampedDesiredReplicas < currentReplicas) {
    // Sau khi scale-up hoặc scale-down, đều phải đợi đủ scaleDownCooldownSec trước khi giảm tiếp (chống flapping).
    const latestScaleMs =
      lastUpMs !== null && lastDownMs !== null
        ? Math.max(lastUpMs, lastDownMs)
        : (lastUpMs ?? lastDownMs);
    const downElapsedSec =
      latestScaleMs !== null ? Math.max(0, (nowMs - latestScaleMs) / 1000) : Infinity;

    if (policy.scaleDownCooldownSec > 0 && downElapsedSec < policy.scaleDownCooldownSec) {
      cooldownActive = true;
      cooldownRemainingSec = Math.ceil(policy.scaleDownCooldownSec - downElapsedSec);
      recommendedReplicas = currentReplicas;
      action = 'hold';
      blockedReason = 'scale_down_cooldown';
    } else {
      recommendedReplicas = Math.max(
        policy.minReplicas,
        Math.max(clampedDesiredReplicas, currentReplicas - policy.scaleDownMaxStep),
      );
      action = recommendedReplicas < currentReplicas ? 'scale_down' : 'hold';
    }
  } else {
    recommendedReplicas = currentReplicas;
    action = 'hold';
    const anyWithinTolerance = availableSignals.some(
      (s) => s.utilizationRatio !== null && Math.abs(1 - s.utilizationRatio) <= tolerance,
    );
    if (anyWithinTolerance && clampedBy === null) {
      blockedReason = 'within_tolerance';
    }
  }

  return {
    target: input.target,
    currentReplicas,
    rawDesiredReplicas,
    clampedDesiredReplicas,
    recommendedReplicas,
    action,
    clampedBy,
    dominantSignal,
    cooldownActive,
    cooldownRemainingSec,
    blockedReason,
    signals: signalEvals,
  };
}

/**
 * Dự báo tác động của việc autoscaling API + Worker lên tổng kết nối Database (`max_connections`),
 * tránh tình trạng scale-up làm cạn kiệt DB connection pool.
 */
export function evaluateAutoscalingDbImpact(input: AutoscalingDbImpactInput): AutoscalingDbImpact {
  const poolLimit = Math.max(1, Math.trunc(input.perInstancePoolLimit));
  const budget = Math.max(1, Math.trunc(input.maxConnectionsBudget));
  const warnPct = Math.max(10, Math.min(100, input.warnUtilizationPercent));

  const currentProjectedConnections =
    Math.max(0, input.activeApiReplicas + input.activeWorkerReplicas) * poolLimit;
  const recommendedProjectedConnections =
    Math.max(0, input.recommendedApiReplicas + input.recommendedWorkerReplicas) * poolLimit;
  const maxProjectedConnections =
    Math.max(0, input.maxApiReplicas + input.maxWorkerReplicas) * poolLimit;

  const recommendedBudgetPercent = round2((recommendedProjectedConnections / budget) * 100);
  const maxBudgetPercent = round2((maxProjectedConnections / budget) * 100);

  let risk: 'ok' | 'warn' | 'crit' = 'ok';
  let message = `Projected max DB connections (${maxProjectedConnections}) fits safely within budget (${budget}).`;

  if (recommendedProjectedConnections > budget || maxProjectedConnections > budget) {
    risk = 'crit';
    message = `Projected DB connections at max scale (${maxProjectedConnections} = (${input.maxApiReplicas} API + ${input.maxWorkerReplicas} Worker) × ${poolLimit}) exceeds DB budget (${budget}). Lower maxReplicas, lower DB_MAX_CONNECTIONS, or use a connection pooler (ProxySQL/PgBouncer).`;
  } else if (maxBudgetPercent >= warnPct || recommendedBudgetPercent >= warnPct) {
    risk = 'warn';
    message = `Projected DB connections at max scale (${maxProjectedConnections}/${budget}, ${maxBudgetPercent}%) reaches warning threshold (${warnPct}%).`;
  }

  return {
    perInstancePoolLimit: poolLimit,
    maxConnectionsBudget: budget,
    currentProjectedConnections,
    recommendedProjectedConnections,
    maxProjectedConnections,
    recommendedBudgetPercent,
    maxBudgetPercent,
    observedPoolUsed: input.observedPoolUsed ?? null,
    observedPoolWaiting: input.observedPoolWaiting ?? null,
    observedDbSessions: input.observedDbSessions ?? null,
    risk,
    message,
  };
}
