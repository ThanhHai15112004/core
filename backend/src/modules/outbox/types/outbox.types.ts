import type {
  DomainEvent,
  OutboxEventStatusCode,
  OutboxEventStatusName,
  OutboxMetricsSnapshot,
} from '@packages/kernel/index.js';

export interface OutboxRuntimeConfig {
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly leaseTimeoutMs: number;
  readonly lagWarnCount: number;
  readonly lagCritCount: number;
  readonly lagWarnAgeSec: number;
  readonly lagCritAgeSec: number;
  readonly deadLetterWarnCount: number;
  readonly retentionPublishedDays: number;
  readonly retentionDeadLetterDays: number;
  readonly cleanupBatchSize: number;
  readonly alertAdminRoles: readonly string[];
  readonly alertChannels: readonly string[];
  readonly alertCooldownSec: number;
}

export interface OutboxEventView {
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
  readonly status: OutboxEventStatusCode;
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

export interface OutboxEventDetailView extends OutboxEventView {
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly headers: Record<string, string>;
}

export interface OutboxDispatchBatchOptions {
  readonly workerId?: string | undefined;
  readonly batchSize?: number | undefined;
  readonly now?: Date | undefined;
}

export interface OutboxDispatchBatchResult {
  readonly workerId: string;
  readonly claimedCount: number;
  readonly publishedCount: number;
  readonly failedCount: number;
  readonly deadLetteredCount: number;
  readonly durationMs: number;
}

export interface OutboxPurgeOptions {
  readonly publishedRetentionDays?: number | undefined;
  readonly deadLetterRetentionDays?: number | undefined;
  readonly batchSize?: number | undefined;
  readonly now?: Date | undefined;
  readonly reason?: string | undefined;
}

export interface OutboxPurgeResult {
  readonly deletedPublishedCount: number;
  readonly deletedDeadLetterCount: number;
  readonly totalDeletedCount: number;
  readonly publishedCutoffAt: string;
  readonly deadLetterCutoffAt: string;
  readonly executedAt: string;
}

export interface OutboxReplayBatchItemResult {
  readonly id: number;
  readonly replayed: boolean;
  readonly statusName?: OutboxEventStatusName | undefined;
  readonly error?: string | undefined;
}

export interface OutboxReplayBatchResult {
  readonly requestedCount: number;
  readonly replayedCount: number;
  readonly skippedCount: number;
  readonly results: readonly OutboxReplayBatchItemResult[];
}

export interface OutboxLagAlertCheckResult {
  readonly metrics: OutboxMetricsSnapshot;
  readonly alerted: boolean;
  readonly skippedByCooldown: boolean;
  readonly reasons: readonly string[];
}

export interface OutboxTransportDispatchInput {
  readonly outboxId: number;
  readonly event: DomainEvent;
  readonly destinationQueue: string;
  readonly destinationTopic: string;
  readonly partitionKey: string | null;
  readonly headers: Record<string, string>;
  readonly attemptNumber: number;
}

export interface OutboxTransportDispatchResult {
  readonly brokerMessageId: string;
  readonly queue: string;
  readonly topic: string;
}

export interface RawOutboxMetricsCounts {
  readonly pendingCount: number;
  readonly processingCount: number;
  readonly failedCount: number;
  readonly deadLetterCount: number;
  readonly publishedLast24hCount: number;
  readonly oldestPendingCreatedAt: Date | null;
  readonly avgPublishLagMs: number | null;
}
