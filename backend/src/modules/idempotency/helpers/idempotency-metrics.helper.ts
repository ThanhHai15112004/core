import type {
  IdempotencyAlertStatus,
  IdempotencyClientRepeatSummary,
  IdempotencyMetricsSnapshot,
  IdempotencyScopeMetrics,
} from '@packages/kernel/index.js';
import { IDEMPOTENCY_ALERT_STATUS, IDEMPOTENCY_SCOPES } from '../enum/idempotency.enum.js';
import type {
  IdempotencyRuntimeConfig,
  RawIdempotencyMetricsSummary,
  RawScopeMetricsRow,
} from '../types/idempotency.types.js';

function roundRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

/**
 * Tổng hợp ảnh chụp thống kê tỷ lệ request/event bị trùng và phát hiện client gửi lặp bất thường (Phase 11.3).
 */
export function evaluateIdempotencyMetricsSnapshot(
  raw: RawIdempotencyMetricsSummary,
  config: IdempotencyRuntimeConfig,
  windowHours: number,
  observedAt: Date = new Date(),
): IdempotencyMetricsSnapshot {
  const rowByScope = new Map<string, RawScopeMetricsRow>(
    raw.scopeRows.map((row) => [row.scope, row]),
  );

  const byScope: IdempotencyScopeMetrics[] = IDEMPOTENCY_SCOPES.map((scope) => {
    const item = rowByScope.get(scope);
    const uniqueKeys = item?.uniqueKeys ?? 0;
    const inProgressCount = item?.inProgressCount ?? 0;
    const completedCount = item?.completedCount ?? 0;
    const failedCount = item?.failedCount ?? 0;
    const duplicateHits = item?.duplicateHits ?? 0;
    const conflictHits = item?.conflictHits ?? 0;
    const totalRequests = uniqueKeys + duplicateHits + conflictHits;
    return {
      scope,
      uniqueKeys,
      inProgressCount,
      completedCount,
      failedCount,
      duplicateHits,
      conflictHits,
      totalRequests,
      duplicateRatePercent: roundRate(duplicateHits, totalRequests),
      conflictRatePercent: roundRate(conflictHits, totalRequests),
    };
  });

  const totalUniqueKeys = byScope.reduce((sum, s) => sum + s.uniqueKeys, 0);
  const totalDuplicateHits = byScope.reduce((sum, s) => sum + s.duplicateHits, 0);
  const totalConflictHits = byScope.reduce((sum, s) => sum + s.conflictHits, 0);
  const totalRequests = totalUniqueKeys + totalDuplicateHits + totalConflictHits;
  const duplicateRatePercent = roundRate(totalDuplicateHits, totalRequests);
  const conflictRatePercent = roundRate(totalConflictHits, totalRequests);

  const topRepeatedClients: IdempotencyClientRepeatSummary[] = raw.clientRows.map((row) => {
    const clientTotal = row.uniqueKeys + row.duplicateHits + row.conflictHits;
    const dupRate = roundRate(row.duplicateHits, clientTotal);
    const repeatHits = row.duplicateHits + row.conflictHits;

    let severity: IdempotencyAlertStatus = IDEMPOTENCY_ALERT_STATUS.HEALTHY;
    if (
      repeatHits >= config.clientRepeatCritHits ||
      row.conflictHits >= Math.max(3, Math.floor(config.clientRepeatWarnHits / 2))
    ) {
      severity = IDEMPOTENCY_ALERT_STATUS.CRITICAL;
    } else if (
      repeatHits >= config.clientRepeatWarnHits ||
      (clientTotal >= 5 && dupRate >= config.duplicateRateWarnPercent)
    ) {
      severity = IDEMPOTENCY_ALERT_STATUS.WARNING;
    }

    return {
      clientIdentifier: row.clientIdentifier,
      scope: row.scope,
      scopeTarget: row.scopeTarget,
      uniqueKeys: row.uniqueKeys,
      duplicateHits: row.duplicateHits,
      conflictHits: row.conflictHits,
      totalRequests: clientTotal,
      duplicateRatePercent: dupRate,
      lastDuplicateAt: row.lastDuplicateAt ? row.lastDuplicateAt.toISOString() : null,
      suspicious: severity !== IDEMPOTENCY_ALERT_STATUS.HEALTHY,
      severity,
    };
  });

  const alertReasons: string[] = [];
  let alertStatus: IdempotencyAlertStatus = IDEMPOTENCY_ALERT_STATUS.HEALTHY;

  if (totalRequests >= 10 && duplicateRatePercent >= config.duplicateRateCritPercent) {
    alertStatus = IDEMPOTENCY_ALERT_STATUS.CRITICAL;
    alertReasons.push(
      `Tỷ lệ yêu cầu/sự kiện bị trùng đạt ${duplicateRatePercent}% (vượt ngưỡng nghiêm trọng ${config.duplicateRateCritPercent}%)`,
    );
  } else if (totalRequests >= 10 && duplicateRatePercent >= config.duplicateRateWarnPercent) {
    alertStatus = IDEMPOTENCY_ALERT_STATUS.WARNING;
    alertReasons.push(
      `Tỷ lệ yêu cầu/sự kiện bị trùng đạt ${duplicateRatePercent}% (vượt ngưỡng cảnh báo ${config.duplicateRateWarnPercent}%)`,
    );
  }

  const criticalClients = topRepeatedClients.filter(
    (c) => c.severity === IDEMPOTENCY_ALERT_STATUS.CRITICAL,
  );
  const warningClients = topRepeatedClients.filter(
    (c) => c.severity === IDEMPOTENCY_ALERT_STATUS.WARNING,
  );

  if (criticalClients.length > 0) {
    alertStatus = IDEMPOTENCY_ALERT_STATUS.CRITICAL;
    alertReasons.push(
      `Phát hiện ${criticalClients.length} client/nguồn gửi lặp bất thường ở mức nghiêm trọng (${criticalClients
        .slice(0, 3)
        .map((c) => c.clientIdentifier)
        .join(', ')})`,
    );
  } else if (warningClients.length > 0) {
    if (alertStatus === IDEMPOTENCY_ALERT_STATUS.HEALTHY) {
      alertStatus = IDEMPOTENCY_ALERT_STATUS.WARNING;
    }
    alertReasons.push(
      `Phát hiện ${warningClients.length} client/nguồn gửi lặp vượt ngưỡng cảnh báo (${warningClients
        .slice(0, 3)
        .map((c) => c.clientIdentifier)
        .join(', ')})`,
    );
  }

  if (totalConflictHits > 0) {
    if (alertStatus === IDEMPOTENCY_ALERT_STATUS.HEALTHY) {
      alertStatus = IDEMPOTENCY_ALERT_STATUS.WARNING;
    }
    alertReasons.push(
      `Ghi nhận ${totalConflictHits} lượt gửi trùng khóa nhưng sai lệch dữ liệu (IDEMPOTENCY_PAYLOAD_MISMATCH)`,
    );
  }

  return {
    windowHours,
    totalUniqueKeys,
    activeKeysCount: raw.activeKeysCount,
    expiredPendingPurgeCount: raw.expiredPendingPurgeCount,
    totalDuplicateHits,
    totalConflictHits,
    totalRequests,
    duplicateRatePercent,
    conflictRatePercent,
    alertStatus,
    alertReasons,
    byScope,
    topRepeatedClients,
    thresholds: {
      duplicateRateWarnPercent: config.duplicateRateWarnPercent,
      duplicateRateCritPercent: config.duplicateRateCritPercent,
      clientRepeatWarnHits: config.clientRepeatWarnHits,
      clientRepeatCritHits: config.clientRepeatCritHits,
    },
    observedAt: observedAt.toISOString(),
  };
}
