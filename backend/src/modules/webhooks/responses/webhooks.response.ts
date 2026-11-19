import { safeJsonParseObject, safeJsonParseStringArray } from '@packages/kernel/index.js';
import {
  getWebhookDeliveryStatusName,
  getWebhookEndpointStatusName,
} from '../enum/webhooks.enum.js';
import type { WebhookDeliveryAttemptEntity } from '../entities/webhook-delivery-attempt.entity.js';
import type { WebhookDeliveryEntity } from '../entities/webhook-delivery.entity.js';
import type { WebhookEndpointEntity } from '../entities/webhook-endpoint.entity.js';
import type {
  WebhookDeliveryAttemptView,
  WebhookDeliveryView,
  WebhookEndpointView,
  WebhookEndpointWithSecretView,
} from '../types/webhooks.types.js';

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export class WebhooksResponseMapper {
  public static toEndpointView(entity: WebhookEndpointEntity): WebhookEndpointView {
    return {
      id: Number(entity.id),
      name: entity.name,
      description: entity.description ?? null,
      url: entity.targetUrl,
      events: safeJsonParseStringArray(entity.eventsJson),
      status: entity.status,
      statusName: getWebhookEndpointStatusName(entity.status),
      signingSecretPrefix: entity.signingSecretPrefix,
      customHeaders: safeJsonParseObject<Record<string, string>>(entity.customHeadersJson, {}),
      timeoutMs: Number(entity.timeoutMs),
      maxRetries: Number(entity.maxRetries),
      failureThreshold: Number(entity.failureThreshold),
      consecutiveFailures: Number(entity.consecutiveFailures ?? 0),
      disabledReason: entity.disabledReason ?? null,
      disabledAt: toIsoOrNull(entity.disabledAt),
      lastTriggeredAt: toIsoOrNull(entity.lastTriggeredAt),
      lastSuccessAt: toIsoOrNull(entity.lastSuccessAt),
      lastFailureAt: toIsoOrNull(entity.lastFailureAt),
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

  public static toEndpointWithSecretView(
    entity: WebhookEndpointEntity,
    signingSecret: string,
  ): WebhookEndpointWithSecretView {
    return {
      ...WebhooksResponseMapper.toEndpointView(entity),
      signingSecret,
    };
  }

  public static toAttemptView(entity: WebhookDeliveryAttemptEntity): WebhookDeliveryAttemptView {
    return {
      id: Number(entity.id),
      deliveryId: Number(entity.deliveryId),
      endpointId: Number(entity.endpointId),
      attemptNumber: Number(entity.attemptNumber),
      requestUrl: entity.requestUrl,
      requestHeaders: safeJsonParseObject<Record<string, string>>(entity.requestHeadersJson, {}),
      responseStatus:
        entity.responseStatus !== null && entity.responseStatus !== undefined
          ? Number(entity.responseStatus)
          : null,
      responseHeaders: safeJsonParseObject<Record<string, string>>(entity.responseHeadersJson, {}),
      responseBodySnippet: entity.responseBodySnippet ?? null,
      durationMs: Number(entity.durationMs ?? 0),
      isSuccess: Boolean(entity.isSuccess),
      errorCode: entity.errorCode ?? null,
      errorMessage: entity.errorMessage ?? null,
      attemptedAt:
        toIsoOrNull(entity.attemptedAt) ??
        toIsoOrNull(entity.createdAt) ??
        new Date().toISOString(),
    };
  }

  public static toDeliveryView(
    entity: WebhookDeliveryEntity,
    options?: {
      readonly endpoint?: WebhookEndpointEntity | null | undefined;
      readonly attempts?: readonly WebhookDeliveryAttemptEntity[] | undefined;
    },
  ): WebhookDeliveryView {
    return {
      id: Number(entity.id),
      deliveryUid: entity.deliveryUid,
      endpointId: Number(entity.endpointId),
      ...(options?.endpoint
        ? {
            endpointName: options.endpoint.name,
            endpointUrl: options.endpoint.targetUrl,
          }
        : {}),
      eventName: entity.eventName,
      eventId: entity.eventId,
      payload: safeJsonParseObject<Record<string, unknown>>(entity.payloadJson, {}),
      status: entity.status,
      statusName: getWebhookDeliveryStatusName(entity.status),
      triggerSource: entity.triggerSource,
      replayedFromDeliveryId:
        entity.replayedFromDeliveryId !== null && entity.replayedFromDeliveryId !== undefined
          ? Number(entity.replayedFromDeliveryId)
          : null,
      attemptCount: Number(entity.attemptCount ?? 0),
      maxAttempts: Number(entity.maxAttempts ?? 1),
      lastHttpStatus:
        entity.lastHttpStatus !== null && entity.lastHttpStatus !== undefined
          ? Number(entity.lastHttpStatus)
          : null,
      lastErrorCode: entity.lastErrorCode ?? null,
      lastErrorMessage: entity.lastErrorMessage ?? null,
      nextRetryAt: toIsoOrNull(entity.nextRetryAt),
      deliveredAt: toIsoOrNull(entity.deliveredAt),
      correlationId: entity.correlationId ?? null,
      requestedBy:
        entity.requestedBy !== null && entity.requestedBy !== undefined
          ? Number(entity.requestedBy)
          : null,
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
      ...(options?.attempts
        ? { attempts: options.attempts.map((a) => WebhooksResponseMapper.toAttemptView(a)) }
        : {}),
    };
  }
}
