import { safeJsonParseObject, safeJsonParseStringArray } from '@packages/kernel/index.js';
import {
  getInboundWebhookEventStatusName,
  getInboundWebhookProviderStatusName,
} from '../enum/inbound-webhooks.enum.js';
import type { InboundWebhookAttemptEntity } from '../entities/inbound-webhook-attempt.entity.js';
import type { InboundWebhookEventEntity } from '../entities/inbound-webhook-event.entity.js';
import type { InboundWebhookProviderEntity } from '../entities/inbound-webhook-provider.entity.js';
import { INBOUND_WEBHOOKS_ROUTES } from '../routes/inbound-webhooks.routes.js';
import type {
  InboundWebhookAttemptView,
  InboundWebhookEventView,
  InboundWebhookProviderView,
  InboundWebhookProviderWithSecretView,
} from '../types/inbound-webhooks.types.js';

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export class InboundWebhooksResponseMapper {
  public static toProviderView(entity: InboundWebhookProviderEntity): InboundWebhookProviderView {
    return {
      id: Number(entity.id),
      providerCode: entity.providerCode,
      name: entity.name,
      description: entity.description ?? null,
      status: entity.status,
      statusName: getInboundWebhookProviderStatusName(entity.status),
      authType: entity.authType,
      signingSecretPrefix: entity.signingSecretPrefix,
      signatureHeader: entity.signatureHeader,
      signaturePrefix: entity.signaturePrefix ?? null,
      signatureFormat: entity.signatureFormat,
      timestampHeader: entity.timestampHeader,
      requireTimestamp: Boolean(entity.requireTimestamp),
      toleranceSec: Number(entity.toleranceSec),
      eventIdHeader: entity.eventIdHeader,
      eventIdPayloadPath: entity.eventIdPayloadPath ?? null,
      eventTypeHeader: entity.eventTypeHeader,
      eventTypePayloadPath: entity.eventTypePayloadPath ?? null,
      sensitiveFields: safeJsonParseStringArray(entity.sensitiveFieldsJson),
      maxRetries: Number(entity.maxRetries),
      receivePath: INBOUND_WEBHOOKS_ROUTES.buildReceivePath(entity.providerCode),
      lastReceivedAt: toIsoOrNull(entity.lastReceivedAt),
      lastProcessedAt: toIsoOrNull(entity.lastProcessedAt),
      lastRejectedAt: toIsoOrNull(entity.lastRejectedAt),
      createdBy:
        entity.createdBy !== null && entity.createdBy !== undefined
          ? Number(entity.createdBy)
          : null,
      updatedBy:
        entity.updatedBy !== null && entity.updatedBy !== undefined
          ? Number(entity.updatedBy)
          : null,
      version: Number(entity.version ?? 1),
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
    };
  }

  public static toProviderWithSecretView(
    entity: InboundWebhookProviderEntity,
    signingSecret: string,
  ): InboundWebhookProviderWithSecretView {
    return {
      ...InboundWebhooksResponseMapper.toProviderView(entity),
      signingSecret,
    };
  }

  public static toAttemptView(entity: InboundWebhookAttemptEntity): InboundWebhookAttemptView {
    return {
      id: Number(entity.id),
      eventId: Number(entity.eventId),
      providerId: Number(entity.providerId),
      providerCode: entity.providerCode,
      attemptNumber: Number(entity.attemptNumber),
      handlerName: entity.handlerName,
      isSuccess: Boolean(entity.isSuccess),
      durationMs: Number(entity.durationMs ?? 0),
      resultSummary: entity.resultSummaryJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.resultSummaryJson, {})
        : null,
      errorCode: entity.errorCode ?? null,
      errorMessage: entity.errorMessage ?? null,
      attemptedAt:
        toIsoOrNull(entity.attemptedAt) ??
        toIsoOrNull(entity.createdAt) ??
        new Date().toISOString(),
    };
  }

  public static toEventView(
    entity: InboundWebhookEventEntity,
    options?: {
      readonly provider?: InboundWebhookProviderEntity | null | undefined;
      readonly attempts?: readonly InboundWebhookAttemptEntity[] | undefined;
    },
  ): InboundWebhookEventView {
    return {
      id: Number(entity.id),
      eventUid: entity.eventUid,
      providerId: Number(entity.providerId),
      providerCode: entity.providerCode,
      ...(options?.provider ? { providerName: options.provider.name } : {}),
      externalEventId: entity.externalEventId ?? null,
      eventType: entity.eventType ?? null,
      eventTimestamp: toIsoOrNull(entity.eventTimestamp),
      payloadHash: entity.payloadHash,
      headers: safeJsonParseObject<Record<string, string>>(entity.headersRedactedJson, {}),
      payload: safeJsonParseObject<Record<string, unknown>>(entity.payloadRedactedJson, {}),
      payloadSizeBytes: Number(entity.payloadSizeBytes ?? 0),
      payloadTruncated: Boolean(entity.payloadTruncated),
      sourceIpMasked: entity.sourceIpMasked ?? null,
      status: entity.status,
      statusName: getInboundWebhookEventStatusName(entity.status),
      rejectionReason: entity.rejectionReason ?? null,
      attemptCount: Number(entity.attemptCount ?? 0),
      maxAttempts: Number(entity.maxAttempts ?? 1),
      duplicateCount: Number(entity.duplicateCount ?? 0),
      lastDuplicateAt: toIsoOrNull(entity.lastDuplicateAt),
      lastHandlerName: entity.lastHandlerName ?? null,
      lastErrorCode: entity.lastErrorCode ?? null,
      lastErrorMessage: entity.lastErrorMessage ?? null,
      receivedAt:
        toIsoOrNull(entity.receivedAt) ?? toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      processedAt: toIsoOrNull(entity.processedAt),
      correlationId: entity.correlationId ?? null,
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
      ...(options?.attempts
        ? { attempts: options.attempts.map((a) => InboundWebhooksResponseMapper.toAttemptView(a)) }
        : {}),
    };
  }
}
