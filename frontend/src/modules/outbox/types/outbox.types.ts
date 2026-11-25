export type OutboxEventStatusName =
  | 'PENDING'
  | 'PROCESSING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'DEAD_LETTER';

export type OutboxLagStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export interface OutboxMetricsSnapshot {
  readonly pendingCount: number;
  readonly processingCount: number;
  readonly failedCount: number;
  readonly deadLetterCount: number;
  readonly publishedLast24hCount: number;
  readonly totalBacklogCount: number;
  readonly oldestPendingAgeSec: number | null;
  readonly avgPublishLagMs: number | null;
  readonly lagStatus: OutboxLagStatus;
  readonly alertReasons: readonly string[];
  readonly thresholds: {
    readonly lagWarnCount: number;
    readonly lagCritCount: number;
    readonly lagWarnAgeSec: number;
    readonly lagCritAgeSec: number;
    readonly deadLetterWarnCount: number;
  };
  readonly observedAt: string;
}

export interface OutboxEventItem {
  readonly id: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly dotName: string;
  readonly eventVersion: number;
  readonly sourceModule: string;
  readonly aggregateType: string | null;
  readonly aggregateId: string | null;
  readonly partitionKey: string | null;
  readonly destinationQueue: string;
  readonly destinationTopic: string;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly actorId: string | null;
  readonly occurredAt: string;
  readonly status: number;
  readonly statusName: OutboxEventStatusName;
  readonly attemptCount: number;
  readonly maxRetries: number;
  readonly nextAttemptAt: string | null;
  readonly lockedBy: string | null;
  readonly lockedUntil: string | null;
  readonly lastAttemptedAt: string | null;
  readonly publishedAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly deadLetteredAt: string | null;
  readonly deadLetterReason: string | null;
  readonly replayCount: number;
  readonly lastReplayedAt: string | null;
  readonly lastReplayedBy: number | null;
  readonly publishLagMs: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OutboxEventDetail extends OutboxEventItem {
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly headers: Record<string, string>;
}

export interface OutboxPurgeResult {
  readonly deletedPublishedCount: number;
  readonly deletedDeadLetterCount: number;
  readonly totalDeletedCount: number;
  readonly publishedCutoffAt: string;
  readonly deadLetterCutoffAt: string;
  readonly executedAt: string;
}

export interface OutboxDispatchBatchResult {
  readonly workerId: string;
  readonly claimedCount: number;
  readonly publishedCount: number;
  readonly failedCount: number;
  readonly deadLetteredCount: number;
  readonly durationMs: number;
}

export const OUTBOX_STATUS_LABELS: Record<OutboxEventStatusName, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
  DEAD_LETTER: 'Dead Letter',
};

export const OUTBOX_STATUS_BADGE_STYLES: Record<
  OutboxEventStatusName,
  { readonly bg: string; readonly color: string; readonly border: string }
> = {
  PENDING: {
    bg: 'rgba(37, 99, 235, 0.1)',
    color: '#2563eb',
    border: 'rgba(37, 99, 235, 0.3)',
  },
  PROCESSING: {
    bg: 'rgba(14, 165, 233, 0.12)',
    color: '#0284c7',
    border: 'rgba(14, 165, 233, 0.3)',
  },
  PUBLISHED: {
    bg: 'rgba(22, 163, 74, 0.1)',
    color: '#15803d',
    border: 'rgba(22, 163, 74, 0.3)',
  },
  FAILED: {
    bg: 'rgba(217, 119, 6, 0.12)',
    color: '#b45309',
    border: 'rgba(217, 119, 6, 0.35)',
  },
  DEAD_LETTER: {
    bg: 'rgba(220, 38, 38, 0.1)',
    color: '#dc2626',
    border: 'rgba(220, 38, 38, 0.35)',
  },
};
