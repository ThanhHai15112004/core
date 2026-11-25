import {
  OUTBOX_LAG_STATUS,
  type OutboxLagStatus,
  type OutboxMetricsSnapshot,
} from '@packages/kernel/index.js';
import type { OutboxRuntimeConfig, RawOutboxMetricsCounts } from '../types/outbox.types.js';

/** Đánh giá độ trễ & tồn đọng Outbox thành snapshot kèm trạng thái `HEALTHY | WARNING | CRITICAL`. */
export function evaluateOutboxLagSnapshot(
  raw: RawOutboxMetricsCounts,
  config: Pick<
    OutboxRuntimeConfig,
    'lagWarnCount' | 'lagCritCount' | 'lagWarnAgeSec' | 'lagCritAgeSec' | 'deadLetterWarnCount'
  >,
  now: Date = new Date(),
): OutboxMetricsSnapshot {
  const totalBacklogCount = raw.pendingCount + raw.failedCount;
  const oldestPendingAgeSec = raw.oldestPendingCreatedAt
    ? Math.max(0, Math.round((now.getTime() - raw.oldestPendingCreatedAt.getTime()) / 1000))
    : null;

  const reasons: string[] = [];
  let lagStatus: OutboxLagStatus = OUTBOX_LAG_STATUS.HEALTHY;

  const escalate = (next: OutboxLagStatus) => {
    if (next === OUTBOX_LAG_STATUS.CRITICAL) {
      lagStatus = OUTBOX_LAG_STATUS.CRITICAL;
    } else if (next === OUTBOX_LAG_STATUS.WARNING && lagStatus === OUTBOX_LAG_STATUS.HEALTHY) {
      lagStatus = OUTBOX_LAG_STATUS.WARNING;
    }
  };

  if (totalBacklogCount >= config.lagCritCount) {
    escalate(OUTBOX_LAG_STATUS.CRITICAL);
    reasons.push(`Backlog count ${totalBacklogCount} >= critical threshold ${config.lagCritCount}`);
  } else if (totalBacklogCount >= config.lagWarnCount) {
    escalate(OUTBOX_LAG_STATUS.WARNING);
    reasons.push(`Backlog count ${totalBacklogCount} >= warning threshold ${config.lagWarnCount}`);
  }

  if (oldestPendingAgeSec !== null && oldestPendingAgeSec >= config.lagCritAgeSec) {
    escalate(OUTBOX_LAG_STATUS.CRITICAL);
    reasons.push(
      `Oldest pending event age ${oldestPendingAgeSec}s >= critical threshold ${config.lagCritAgeSec}s`,
    );
  } else if (oldestPendingAgeSec !== null && oldestPendingAgeSec >= config.lagWarnAgeSec) {
    escalate(OUTBOX_LAG_STATUS.WARNING);
    reasons.push(
      `Oldest pending event age ${oldestPendingAgeSec}s >= warning threshold ${config.lagWarnAgeSec}s`,
    );
  }

  if (raw.deadLetterCount >= config.deadLetterWarnCount) {
    escalate(OUTBOX_LAG_STATUS.WARNING);
    reasons.push(
      `Dead letter count ${raw.deadLetterCount} >= threshold ${config.deadLetterWarnCount}`,
    );
  }

  return {
    pendingCount: raw.pendingCount,
    processingCount: raw.processingCount,
    failedCount: raw.failedCount,
    deadLetterCount: raw.deadLetterCount,
    publishedLast24hCount: raw.publishedLast24hCount,
    totalBacklogCount,
    oldestPendingAgeSec,
    avgPublishLagMs: raw.avgPublishLagMs,
    lagStatus,
    alertReasons: reasons,
    thresholds: {
      lagWarnCount: config.lagWarnCount,
      lagCritCount: config.lagCritCount,
      lagWarnAgeSec: config.lagWarnAgeSec,
      lagCritAgeSec: config.lagCritAgeSec,
      deadLetterWarnCount: config.deadLetterWarnCount,
    },
    observedAt: now.toISOString(),
  };
}
