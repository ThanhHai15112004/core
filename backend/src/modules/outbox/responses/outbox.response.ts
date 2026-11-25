import { safeJsonParseObject } from '@packages/kernel/index.js';
import { getOutboxEventStatusName } from '../enum/outbox.enum.js';
import type { OutboxEventEntity } from '../entities/outbox-event.entity.js';
import type { OutboxEventDetailView, OutboxEventView } from '../types/outbox.types.js';

function toIso(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

export class OutboxResponseMapper {
  public static toEventView(entity: OutboxEventEntity): OutboxEventView {
    const publishLagMs =
      entity.publishedAt && entity.createdAt
        ? Math.max(0, entity.publishedAt.getTime() - entity.createdAt.getTime())
        : null;

    return {
      id: Number(entity.id),
      eventId: entity.eventId,
      eventType: entity.eventType,
      dotName: entity.dotName,
      eventVersion: Number(entity.eventVersion),
      sourceModule: entity.sourceModule,
      aggregateType: entity.aggregateType ?? null,
      aggregateId: entity.aggregateId ?? null,
      partitionKey: entity.partitionKey ?? null,
      destinationQueue: entity.destinationQueue,
      destinationTopic: entity.destinationTopic,
      requestId: entity.requestId ?? null,
      correlationId: entity.correlationId ?? null,
      causationId: entity.causationId ?? null,
      actorId: entity.actorId ?? null,
      occurredAt: toIso(entity.occurredAt) ?? new Date(0).toISOString(),
      status: entity.status,
      statusName: getOutboxEventStatusName(entity.status),
      attemptCount: Number(entity.attemptCount) || 0,
      maxRetries: Number(entity.maxRetries) || 0,
      nextAttemptAt: toIso(entity.nextAttemptAt),
      lockedBy: entity.lockedBy ?? null,
      lockedUntil: toIso(entity.lockedUntil),
      lastAttemptedAt: toIso(entity.lastAttemptedAt),
      publishedAt: toIso(entity.publishedAt),
      lastErrorCode: entity.lastErrorCode ?? null,
      lastErrorMessage: entity.lastErrorMessage ?? null,
      deadLetteredAt: toIso(entity.deadLetteredAt),
      deadLetterReason: entity.deadLetterReason ?? null,
      replayCount: Number(entity.replayCount) || 0,
      lastReplayedAt: toIso(entity.lastReplayedAt),
      lastReplayedBy:
        entity.lastReplayedBy !== null && entity.lastReplayedBy !== undefined
          ? Number(entity.lastReplayedBy)
          : null,
      publishLagMs,
      createdAt: toIso(entity.createdAt) ?? new Date(0).toISOString(),
      updatedAt: toIso(entity.updatedAt) ?? new Date(0).toISOString(),
    };
  }

  public static toEventDetailView(entity: OutboxEventEntity): OutboxEventDetailView {
    const rawHeaders = (entity.headersJson ? safeJsonParseObject(entity.headersJson) : null) ?? {};
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof v === 'string') {
        headers[k] = v;
      }
    }

    return {
      ...OutboxResponseMapper.toEventView(entity),
      payload: safeJsonParseObject(entity.payloadJson) ?? {},
      metadata: safeJsonParseObject(entity.metadataJson) ?? {},
      headers,
    };
  }
}
