import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParseObject,
  safeJsonParseStringArray,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  HttpNetworkError,
  HttpStatusError,
  HttpTimeoutError,
  type HttpClientContract,
} from '@packages/http-client/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { BaseMessagePublisherProvider, JobError, QUEUES } from '@packages/messaging/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  defaultFieldEncryptionService,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
  NOTIFICATIONS_PUBLIC_SERVICE,
  type INotificationsPublicService,
  type NotificationChannelName,
} from '@modules/notifications/contracts/index.js';
import {
  WEBHOOKS_QUEUE_TOPICS,
  WEBHOOK_DEFAULTS,
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_ENDPOINT_STATUS,
  WEBHOOK_HEADERS,
  WEBHOOK_TRIGGER_SOURCE,
  getWebhookDeliveryStatusName,
} from '../enum/webhooks.enum.js';
import type { WebhookDeliveryEntity } from '../entities/webhook-delivery.entity.js';
import type { WebhookEndpointEntity } from '../entities/webhook-endpoint.entity.js';
import { resolveWebhookRuntimeConfig } from '../helpers/webhook-config.helper.js';
import { matchesWebhookEvent } from '../helpers/webhook-event-matcher.helper.js';
import {
  redactWebhookHeaders,
  sanitizeWebhookResponseSnippet,
} from '../helpers/webhook-redaction.helper.js';
import { signWebhookPayload } from '../helpers/webhook-signature.helper.js';
import {
  assertWebhookUrlSafe,
  validateWebhookUrlSsrf,
  type WebhookDnsLookupFn,
} from '../helpers/webhook-ssrf.helper.js';
import { WebhookDeliveryAttemptRepository } from '../repositories/webhook-delivery-attempt.repository.js';
import { WebhookDeliveryRepository } from '../repositories/webhook-delivery.repository.js';
import { WebhookEndpointRepository } from '../repositories/webhook-endpoint.repository.js';
import type {
  ListWebhookDeliveriesQuery,
  ReplayWebhookDeliveryRequest,
  SendWebhookTestEventRequest,
} from '../requests/webhooks.requests.js';
import { WebhooksResponseMapper } from '../responses/webhooks.response.js';
import type {
  DispatchWebhookEventInput,
  DispatchWebhookEventResult,
  ProcessQueuedWebhookDeliveryContext,
  ProcessQueuedWebhookDeliveryResult,
  QueuedWebhookDeliveryJobPayload,
  WebhookDeliveryView,
  WebhookRuntimeConfig,
} from '../types/webhooks.types.js';

interface FailureClassification {
  readonly httpStatus: number | null;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly responseSnippet: string | null;
  readonly durationMs: number;
  readonly retryable: boolean;
}

@Injectable()
export class WebhooksDeliveryService {
  private readonly logger = new Logger(WebhooksDeliveryService.name);
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;
  private readonly httpClient: HttpClientContract | undefined;
  private dnsLookupOverride: WebhookDnsLookupFn | undefined;

  constructor(
    private readonly endpointRepo: WebhookEndpointRepository,
    private readonly deliveryRepo: WebhookDeliveryRepository,
    private readonly attemptRepo: WebhookDeliveryAttemptRepository,
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    httpClient?: HttpClientContract,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsPublicService?: INotificationsPublicService | null,
    @Optional() baseHttpClientFallback?: BaseHttpClientProvider,
  ) {
    this.httpClient = httpClient ?? baseHttpClientFallback;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
  }

  public setDnsLookupForTesting(fn?: WebhookDnsLookupFn): void {
    this.dnsLookupOverride = fn;
  }

  public async listDeliveries(
    query: ListWebhookDeliveriesQuery,
  ): Promise<PaginatedResult<WebhookDeliveryView>> {
    const paged = await this.deliveryRepo.listPaginated({
      page: query.page,
      limit: query.limit,
      countMode: query.countMode,
      endpointId: query.endpointId,
      eventName: query.eventName,
      status: query.status,
      triggerSource: query.triggerSource,
      search: query.search,
    });

    const endpointIds = paged.data.map((item) => Number(item.endpointId));
    const endpoints = await this.endpointRepo.findByIds(endpointIds);
    const endpointMap = new Map<number, WebhookEndpointEntity>(
      endpoints.map((ep) => [Number(ep.id), ep]),
    );

    return createPaginatedResult(
      paged.data.map((d) =>
        WebhooksResponseMapper.toDeliveryView(d, {
          endpoint: endpointMap.get(Number(d.endpointId)) ?? null,
        }),
      ),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getDeliveryById(id: number): Promise<WebhookDeliveryView> {
    const delivery = await this.deliveryRepo.findByIdSafe(Number(id));
    if (!delivery) {
      throw new NotFoundAppException('webhooks.deliveryNotFound', { id });
    }
    const [endpoint, attempts] = await Promise.all([
      this.endpointRepo.findByIdSafe(Number(delivery.endpointId)),
      this.attemptRepo.findByDeliveryId(Number(delivery.id)),
    ]);
    return WebhooksResponseMapper.toDeliveryView(delivery, { endpoint, attempts });
  }

  public async dispatchEvent(
    input: DispatchWebhookEventInput,
  ): Promise<DispatchWebhookEventResult> {
    const eventName = input.eventName.trim().toLowerCase();
    const eventId = input.eventId?.trim() || `evt_${randomUUID()}`;
    const correlationId =
      input.correlationId?.trim() ||
      RequestContextService.currentCorrelationId() ||
      `corr_${randomUUID()}`;
    const runtimeConfig = resolveWebhookRuntimeConfig(this.settingRegistry);

    const activeEndpoints = await this.endpointRepo.findAllActive();
    const matched = activeEndpoints.filter((ep) =>
      matchesWebhookEvent(safeJsonParseStringArray(ep.eventsJson), eventName),
    );

    const deliveryIds: number[] = [];
    let queuedCount = 0;
    let failedEnqueueCount = 0;

    for (const endpoint of matched) {
      const maxAttempts =
        1 + Math.max(0, Number(endpoint.maxRetries ?? runtimeConfig.defaultMaxRetries));
      const delivery = await this.createDeliveryRecord({
        endpointId: Number(endpoint.id),
        eventName,
        eventId,
        payload: input.payload ?? {},
        triggerSource: WEBHOOK_TRIGGER_SOURCE.EVENT,
        replayedFromDeliveryId: null,
        maxAttempts,
        correlationId,
        requestedBy: input.requestedBy ?? null,
      });

      const dId = Number(delivery.id);
      deliveryIds.push(dId);

      const enqueued = await this.enqueueDeliveryJob(delivery, endpoint, runtimeConfig);
      if (enqueued) {
        queuedCount += 1;
      } else {
        failedEnqueueCount += 1;
      }
    }

    return {
      eventName,
      eventId,
      matchedEndpointsCount: matched.length,
      queuedCount,
      failedEnqueueCount,
      deliveryIds,
    };
  }

  public async sendTestEvent(
    endpointId: number,
    input: SendWebhookTestEventRequest,
    actor?: UserIdentity,
  ): Promise<WebhookDeliveryView> {
    const endpoint = await this.endpointRepo.findByIdSafe(Number(endpointId));
    if (!endpoint) {
      throw new NotFoundAppException('webhooks.endpointNotFound', { id: endpointId });
    }
    if (endpoint.status !== WEBHOOK_ENDPOINT_STATUS.ACTIVE) {
      throw new BadRequestAppException('webhooks.endpointNotActiveForTest', [{ id: endpointId }]);
    }

    const runtimeConfig = resolveWebhookRuntimeConfig(this.settingRegistry);
    await assertWebhookUrlSafe(endpoint.targetUrl, {
      allowHttpInDev: runtimeConfig.allowHttpInDev,
      dnsLookup: this.dnsLookupOverride,
    });

    const actorUserId = parseNumericUserId(actor?.id);
    const correlationId = RequestContextService.currentCorrelationId() ?? `corr_${randomUUID()}`;
    const delivery = await this.createDeliveryRecord({
      endpointId: Number(endpoint.id),
      eventName: input.eventName.trim().toLowerCase(),
      eventId: `evt_test_${randomUUID()}`,
      payload: input.payload ?? { message: 'Test webhook delivery' },
      triggerSource: WEBHOOK_TRIGGER_SOURCE.TEST,
      replayedFromDeliveryId: null,
      maxAttempts: 1,
      correlationId,
      requestedBy: actorUserId,
    });

    const enqueued = await this.enqueueDeliveryJob(delivery, endpoint, runtimeConfig);
    if (!enqueued) {
      throw new BadRequestAppException('webhooks.queuePublishFailed', [
        { deliveryId: Number(delivery.id) },
      ]);
    }

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'webhooks',
      feature: 'endpoints',
      action: 'TEST',
      resourceType: 'webhook_endpoint',
      resourceId: String(endpoint.id),
      beforeData: null,
      afterData: {
        deliveryId: Number(delivery.id),
        deliveryUid: delivery.deliveryUid,
        eventName: delivery.eventName,
      },
      reason: 'Triggered test webhook delivery',
    });

    const refreshed = (await this.deliveryRepo.findByIdSafe(Number(delivery.id))) ?? delivery;
    return WebhooksResponseMapper.toDeliveryView(refreshed, { endpoint });
  }

  public async replayDelivery(
    deliveryId: number,
    input: ReplayWebhookDeliveryRequest,
    actor?: UserIdentity,
  ): Promise<WebhookDeliveryView> {
    const original = await this.deliveryRepo.findByIdSafe(Number(deliveryId));
    if (!original) {
      throw new NotFoundAppException('webhooks.deliveryNotFound', { id: deliveryId });
    }

    if (
      original.status === WEBHOOK_DELIVERY_STATUS.PENDING ||
      original.status === WEBHOOK_DELIVERY_STATUS.RETRYING
    ) {
      throw new BadRequestAppException('webhooks.deliveryNotReplayable', [{ id: deliveryId }]);
    }

    const endpoint = await this.endpointRepo.findByIdSafe(Number(original.endpointId));
    if (!endpoint) {
      throw new NotFoundAppException('webhooks.endpointNotFound', {
        id: Number(original.endpointId),
      });
    }

    if (endpoint.status !== WEBHOOK_ENDPOINT_STATUS.ACTIVE) {
      throw new BadRequestAppException('webhooks.endpointNotActiveForReplay', [
        { id: Number(endpoint.id) },
      ]);
    }

    const runtimeConfig = resolveWebhookRuntimeConfig(this.settingRegistry);
    await assertWebhookUrlSafe(endpoint.targetUrl, {
      allowHttpInDev: runtimeConfig.allowHttpInDev,
      dnsLookup: this.dnsLookupOverride,
    });

    const actorUserId = parseNumericUserId(actor?.id);
    const correlationId =
      RequestContextService.currentCorrelationId() ??
      original.correlationId ??
      `corr_${randomUUID()}`;
    const maxAttempts =
      1 + Math.max(0, Number(endpoint.maxRetries ?? runtimeConfig.defaultMaxRetries));

    const replayed = await this.createDeliveryRecord({
      endpointId: Number(endpoint.id),
      eventName: original.eventName,
      eventId: original.eventId,
      payload: safeJsonParseObject<Record<string, unknown>>(original.payloadJson, {}),
      triggerSource: WEBHOOK_TRIGGER_SOURCE.MANUAL_REPLAY,
      replayedFromDeliveryId: Number(original.id),
      maxAttempts,
      correlationId,
      requestedBy: actorUserId,
    });

    const enqueued = await this.enqueueDeliveryJob(replayed, endpoint, runtimeConfig);
    if (!enqueued) {
      throw new BadRequestAppException('webhooks.queuePublishFailed', [
        { deliveryId: Number(replayed.id) },
      ]);
    }

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'webhooks',
      feature: 'deliveries',
      action: 'REPLAY',
      resourceType: 'webhook_delivery',
      resourceId: String(replayed.id),
      beforeData: {
        originalDeliveryId: Number(original.id),
        originalDeliveryUid: original.deliveryUid,
        originalStatus: getWebhookDeliveryStatusName(original.status),
      },
      afterData: {
        replayedDeliveryId: Number(replayed.id),
        replayedDeliveryUid: replayed.deliveryUid,
        endpointId: Number(endpoint.id),
        eventName: replayed.eventName,
      },
      reason: input.reason?.trim() || 'Manual webhook delivery replay',
    });

    const refreshed = (await this.deliveryRepo.findByIdSafe(Number(replayed.id))) ?? replayed;
    return WebhooksResponseMapper.toDeliveryView(refreshed, { endpoint });
  }

  public async processQueuedDelivery(
    payload: QueuedWebhookDeliveryJobPayload,
    context?: ProcessQueuedWebhookDeliveryContext,
  ): Promise<ProcessQueuedWebhookDeliveryResult> {
    const deliveryId = Number(payload.deliveryId);
    const delivery = await this.deliveryRepo.findByIdSafe(deliveryId);
    if (!delivery) {
      return {
        deliveryId,
        endpointId: 0,
        status: 'SKIPPED',
        httpStatus: null,
        attemptNumber: 0,
        skipped: true,
        reason: 'delivery_not_found',
      };
    }

    if (
      delivery.status === WEBHOOK_DELIVERY_STATUS.DELIVERED ||
      delivery.status === WEBHOOK_DELIVERY_STATUS.CANCELLED
    ) {
      return {
        deliveryId: Number(delivery.id),
        endpointId: Number(delivery.endpointId),
        status: 'SKIPPED',
        httpStatus: delivery.lastHttpStatus ?? null,
        attemptNumber: Number(delivery.attemptCount ?? 0),
        skipped: true,
        reason: 'already_finalized',
      };
    }

    const endpoint = await this.endpointRepo.findByIdSafe(Number(delivery.endpointId));
    if (!endpoint) {
      delivery.status = WEBHOOK_DELIVERY_STATUS.CANCELLED;
      delivery.lastErrorCode = 'ENDPOINT_NOT_FOUND';
      delivery.lastErrorMessage = 'Target webhook endpoint no longer exists';
      delivery.nextRetryAt = null;
      await this.deliveryRepo.saveEntity(delivery);
      return {
        deliveryId: Number(delivery.id),
        endpointId: Number(delivery.endpointId),
        status: 'SKIPPED',
        httpStatus: null,
        attemptNumber: Number(delivery.attemptCount ?? 0),
        skipped: true,
        reason: 'endpoint_not_found',
      };
    }

    if (endpoint.status !== WEBHOOK_ENDPOINT_STATUS.ACTIVE) {
      delivery.status = WEBHOOK_DELIVERY_STATUS.CANCELLED;
      delivery.lastErrorCode = 'ENDPOINT_NOT_ACTIVE';
      delivery.lastErrorMessage = 'Webhook endpoint is paused or auto-disabled';
      delivery.nextRetryAt = null;
      await this.deliveryRepo.saveEntity(delivery);
      return {
        deliveryId: Number(delivery.id),
        endpointId: Number(endpoint.id),
        status: 'SKIPPED',
        httpStatus: null,
        attemptNumber: Number(delivery.attemptCount ?? 0),
        skipped: true,
        reason: 'endpoint_not_active',
      };
    }

    const runtimeConfig = resolveWebhookRuntimeConfig(this.settingRegistry);
    const attemptNumber = Math.max(
      1,
      context?.attemptNumber ?? Number(delivery.attemptCount ?? 0) + 1,
    );
    const maxAttempts = Math.max(1, context?.maxAttempts ?? Number(delivery.maxAttempts ?? 1));
    const now = new Date();

    // Bảo vệ SSRF lớp 2 ngay trước khi gửi HTTP (chống DNS Rebinding)
    const ssrfCheck = await validateWebhookUrlSsrf(endpoint.targetUrl, {
      allowHttpInDev: runtimeConfig.allowHttpInDev,
      dnsLookup: this.dnsLookupOverride,
    });
    if (!ssrfCheck.safe) {
      const reason = ssrfCheck.reason ?? 'Blocked by SSRF policy before delivery';
      await this.recordAttempt({
        delivery,
        endpoint,
        attemptNumber,
        requestHeaders: {},
        responseStatus: null,
        responseHeaders: {},
        responseBodySnippet: null,
        durationMs: 0,
        isSuccess: false,
        errorCode: 'SSRF_BLOCKED',
        errorMessage: reason,
        attemptedAt: now,
      });

      delivery.status = WEBHOOK_DELIVERY_STATUS.FAILED;
      delivery.attemptCount = attemptNumber;
      delivery.lastErrorCode = 'SSRF_BLOCKED';
      delivery.lastErrorMessage = reason.slice(0, 1000);
      delivery.nextRetryAt = null;
      await this.deliveryRepo.saveEntity(delivery);

      await this.handleFinalFailureOnEndpoint(
        endpoint,
        delivery,
        'SSRF_BLOCKED',
        reason,
        runtimeConfig,
        now,
      );

      throw new JobError('SsrfBlocked', reason, {
        retryable: false,
        dependency: 'http',
      });
    }

    const plainSecret = this.encryptionService.decrypt(endpoint.signingSecretEncrypted);
    const occurredAt =
      delivery.createdAt instanceof Date
        ? delivery.createdAt.toISOString()
        : new Date(delivery.createdAt ?? now).toISOString();
    const rawBody = JSON.stringify({
      id: delivery.eventId,
      deliveryId: delivery.deliveryUid,
      event: delivery.eventName,
      occurredAt,
      data: safeJsonParseObject<Record<string, unknown>>(delivery.payloadJson, {}),
    });

    const sig = signWebhookPayload(rawBody, plainSecret);
    const customHeaders = safeJsonParseObject<Record<string, string>>(
      endpoint.customHeadersJson,
      {},
    );
    const requestHeaders: Record<string, string> = {
      ...customHeaders,
      'Content-Type': 'application/json',
      'User-Agent': WEBHOOK_DEFAULTS.USER_AGENT,
      [WEBHOOK_HEADERS.ID]: delivery.deliveryUid,
      [WEBHOOK_HEADERS.EVENT]: delivery.eventName,
      [WEBHOOK_HEADERS.TIMESTAMP]: String(sig.timestamp),
      [WEBHOOK_HEADERS.SIGNATURE]: sig.signature,
      [WEBHOOK_HEADERS.ATTEMPT]: String(attemptNumber),
      ...(delivery.correlationId
        ? { [WEBHOOK_HEADERS.CORRELATION_ID]: delivery.correlationId }
        : {}),
    };
    const redactedRequestHeaders = redactWebhookHeaders(requestHeaders);

    if (!this.httpClient) {
      throw new JobError('HttpClientUnavailable', 'HttpClientContract is not configured', {
        retryable: false,
        dependency: 'http',
      });
    }

    try {
      const timeoutMs = Number(endpoint.timeoutMs) || runtimeConfig.defaultTimeoutMs;
      const res = await this.httpClient.requestRaw<string, string>(
        'POST',
        endpoint.targetUrl,
        rawBody,
        {
          service: 'webhooks',
          headers: requestHeaders,
          timeoutMs,
          responseType: 'text',
          redirect: 'manual',
          retry: { maxRetries: 0 },
          skipCircuitBreaker: true,
          idempotencyKey: delivery.deliveryUid,
          ...(delivery.correlationId ? { traceId: delivery.correlationId } : {}),
        },
      );

      const finishedAt = new Date();
      await this.recordAttempt({
        delivery,
        endpoint,
        attemptNumber,
        requestHeaders: redactedRequestHeaders,
        responseStatus: res.status,
        responseHeaders: redactWebhookHeaders(res.headers),
        responseBodySnippet: sanitizeWebhookResponseSnippet(
          res.data,
          runtimeConfig.maxResponseSnippetLength,
        ),
        durationMs: Math.max(0, Math.round(res.durationMs)),
        isSuccess: true,
        errorCode: null,
        errorMessage: null,
        attemptedAt: finishedAt,
      });

      delivery.status = WEBHOOK_DELIVERY_STATUS.DELIVERED;
      delivery.attemptCount = attemptNumber;
      delivery.lastHttpStatus = res.status;
      delivery.lastErrorCode = null;
      delivery.lastErrorMessage = null;
      delivery.nextRetryAt = null;
      delivery.deliveredAt = finishedAt;
      await this.deliveryRepo.saveEntity(delivery);

      endpoint.consecutiveFailures = 0;
      endpoint.lastTriggeredAt = finishedAt;
      endpoint.lastSuccessAt = finishedAt;
      await this.endpointRepo.saveEntity(endpoint);

      return {
        deliveryId: Number(delivery.id),
        endpointId: Number(endpoint.id),
        status: 'DELIVERED',
        httpStatus: res.status,
        attemptNumber,
      };
    } catch (err) {
      const finishedAt = new Date();
      const failure = this.classifyFailure(err, runtimeConfig.maxResponseSnippetLength);

      await this.recordAttempt({
        delivery,
        endpoint,
        attemptNumber,
        requestHeaders: redactedRequestHeaders,
        responseStatus: failure.httpStatus,
        responseHeaders: {},
        responseBodySnippet: failure.responseSnippet,
        durationMs: failure.durationMs,
        isSuccess: false,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        attemptedAt: finishedAt,
      });

      const willRetry = failure.retryable && attemptNumber < maxAttempts;
      delivery.attemptCount = attemptNumber;
      delivery.lastHttpStatus = failure.httpStatus;
      delivery.lastErrorCode = failure.errorCode;
      delivery.lastErrorMessage = failure.errorMessage.slice(0, 1000);

      if (willRetry) {
        const delayMs = runtimeConfig.retryBaseDelayMs * 2 ** Math.max(0, attemptNumber - 1);
        delivery.status = WEBHOOK_DELIVERY_STATUS.RETRYING;
        delivery.nextRetryAt = new Date(finishedAt.getTime() + delayMs);
        await this.deliveryRepo.saveEntity(delivery);

        endpoint.lastTriggeredAt = finishedAt;
        endpoint.lastFailureAt = finishedAt;
        await this.endpointRepo.saveEntity(endpoint);

        throw new JobError('WebhookDeliveryTransientError', failure.errorMessage, {
          retryable: true,
          dependency: 'http',
          cause: err,
        });
      }

      delivery.status = WEBHOOK_DELIVERY_STATUS.FAILED;
      delivery.nextRetryAt = null;
      await this.deliveryRepo.saveEntity(delivery);

      await this.handleFinalFailureOnEndpoint(
        endpoint,
        delivery,
        failure.errorCode,
        failure.errorMessage,
        runtimeConfig,
        finishedAt,
      );

      throw new JobError(
        failure.retryable ? 'WebhookDeliveryRetriesExhausted' : 'WebhookDeliveryPermanentError',
        failure.errorMessage,
        {
          retryable: failure.retryable,
          dependency: 'http',
          cause: err,
        },
      );
    }
  }

  private classifyFailure(err: unknown, maxSnippetLength: number): FailureClassification {
    if (err instanceof HttpStatusError) {
      const status = err.status ?? 0;
      if (status >= 300 && status < 400) {
        return {
          httpStatus: status,
          errorCode: 'WEBHOOK_REDIRECT_BLOCKED',
          errorMessage: `HTTP redirect (${status}) is blocked for outbound webhooks`,
          responseSnippet: sanitizeWebhookResponseSnippet(err.responseSnippet, maxSnippetLength),
          durationMs: Math.max(0, Math.round(err.durationMs)),
          retryable: false,
        };
      }
      const isRetryableStatus =
        status === 408 || status === 429 || (status >= 500 && status <= 599);
      return {
        httpStatus: status,
        errorCode: `HTTP_${status}`,
        errorMessage: err.message,
        responseSnippet: sanitizeWebhookResponseSnippet(err.responseSnippet, maxSnippetLength),
        durationMs: Math.max(0, Math.round(err.durationMs)),
        retryable: isRetryableStatus,
      };
    }

    if (err instanceof HttpTimeoutError) {
      return {
        httpStatus: null,
        errorCode: 'HTTP_TIMEOUT',
        errorMessage: err.message,
        responseSnippet: null,
        durationMs: Math.max(0, Math.round(err.durationMs)),
        retryable: true,
      };
    }

    if (err instanceof HttpNetworkError) {
      return {
        httpStatus: null,
        errorCode: 'HTTP_NETWORK_ERROR',
        errorMessage: err.message,
        responseSnippet: null,
        durationMs: Math.max(0, Math.round(err.durationMs)),
        retryable: true,
      };
    }

    const msg = err instanceof Error ? err.message : String(err);
    return {
      httpStatus: null,
      errorCode: 'WEBHOOK_DELIVERY_ERROR',
      errorMessage: msg,
      responseSnippet: null,
      durationMs: 0,
      retryable: false,
    };
  }

  private async handleFinalFailureOnEndpoint(
    endpoint: WebhookEndpointEntity,
    delivery: WebhookDeliveryEntity,
    errorCode: string,
    errorMessage: string,
    runtimeConfig: WebhookRuntimeConfig,
    now: Date,
  ): Promise<void> {
    if (delivery.triggerSource === WEBHOOK_TRIGGER_SOURCE.TEST) {
      endpoint.lastTriggeredAt = now;
      endpoint.lastFailureAt = now;
      await this.endpointRepo.saveEntity(endpoint);
      return;
    }

    const prevFailures = Number(endpoint.consecutiveFailures ?? 0);
    const nextFailures = prevFailures + 1;
    const threshold = Math.max(
      1,
      Number(endpoint.failureThreshold ?? runtimeConfig.defaultFailureThreshold),
    );

    endpoint.consecutiveFailures = nextFailures;
    endpoint.lastTriggeredAt = now;
    endpoint.lastFailureAt = now;

    const shouldAutoDisable =
      nextFailures >= threshold && endpoint.status === WEBHOOK_ENDPOINT_STATUS.ACTIVE;

    if (shouldAutoDisable) {
      endpoint.status = WEBHOOK_ENDPOINT_STATUS.AUTO_DISABLED;
      endpoint.disabledAt = now;
      endpoint.disabledReason =
        `Auto-disabled after ${nextFailures} consecutive failed deliveries (last error: ${errorCode})`.slice(
          0,
          500,
        );
    }

    const savedEndpoint = await this.endpointRepo.saveEntity(endpoint);

    if (!shouldAutoDisable) {
      return;
    }

    await this.auditLogService?.record({
      actorType: 'SYSTEM',
      module: 'webhooks',
      feature: 'endpoints',
      action: 'AUTO_DISABLE',
      resourceType: 'webhook_endpoint',
      resourceId: String(savedEndpoint.id),
      beforeData: {
        status: 'ACTIVE',
        consecutiveFailures: prevFailures,
      },
      afterData: {
        status: 'AUTO_DISABLED',
        consecutiveFailures: nextFailures,
        failureThreshold: threshold,
        disabledReason: savedEndpoint.disabledReason,
        lastDeliveryId: Number(delivery.id),
      },
      reason: savedEndpoint.disabledReason ?? 'Consecutive failure threshold reached',
    });

    await this.notifyAdminsEndpointDisabled(
      savedEndpoint,
      delivery,
      errorCode,
      errorMessage,
      runtimeConfig,
      now,
    );
  }

  private async notifyAdminsEndpointDisabled(
    endpoint: WebhookEndpointEntity,
    delivery: WebhookDeliveryEntity,
    errorCode: string,
    errorMessage: string,
    runtimeConfig: WebhookRuntimeConfig,
    now: Date,
  ): Promise<void> {
    if (!this.notificationsPublicService) {
      return;
    }

    const channels = runtimeConfig.alertChannels.filter(
      (ch): ch is NotificationChannelName =>
        ch === 'IN_APP' || ch === 'EMAIL' || ch === 'SMS' || ch === 'PUSH' || ch === 'DOCUMENT',
    );

    try {
      await this.notificationsPublicService.dispatch({
        title: `Webhook Endpoint bị tự động khóa: ${endpoint.name}`,
        content: `Endpoint "${endpoint.name}" (${endpoint.targetUrl}) đã tự động khóa sau ${endpoint.consecutiveFailures} lần gửi thất bại liên tiếp. Sự kiện cuối: ${delivery.eventName}, lỗi: ${errorCode} (${errorMessage.slice(0, 200)}).`,
        category: NOTIFICATION_CATEGORY.SYSTEM,
        priority: NOTIFICATION_PRIORITY.HIGH,
        targetType: NOTIFICATION_TARGET_TYPE.ROLE,
        roleCodes: [...runtimeConfig.alertAdminRoles],
        channels: channels.length > 0 ? channels : ['IN_APP', 'EMAIL'],
        actionUrl: '/webhooks',
        referenceModule: 'webhooks',
        referenceType: 'webhook_endpoint',
        referenceId: String(endpoint.id),
        idempotencyKey: `webhook:auto-disabled:${endpoint.id}:${now.toISOString()}`,
        metadata: {
          endpointId: Number(endpoint.id),
          endpointName: endpoint.name,
          consecutiveFailures: endpoint.consecutiveFailures,
          lastDeliveryId: Number(delivery.id),
          lastErrorCode: errorCode,
        },
        forceDeliver: true,
      });
    } catch (notifyErr) {
      const msg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
      this.logger.warn(
        `Failed to send auto-disable notification for webhook endpoint #${endpoint.id}: ${msg}`,
      );
    }
  }

  private async createDeliveryRecord(params: {
    readonly endpointId: number;
    readonly eventName: string;
    readonly eventId: string;
    readonly payload: Record<string, unknown>;
    readonly triggerSource: WebhookDeliveryEntity['triggerSource'];
    readonly replayedFromDeliveryId: number | null;
    readonly maxAttempts: number;
    readonly correlationId: string | null;
    readonly requestedBy: number | null;
  }): Promise<WebhookDeliveryEntity> {
    return this.deliveryRepo.saveEntity({
      deliveryUid: `whd_${randomUUID().replace(/-/g, '')}`,
      endpointId: params.endpointId,
      eventName: params.eventName,
      eventId: params.eventId,
      payloadJson: JSON.stringify(params.payload),
      status: WEBHOOK_DELIVERY_STATUS.PENDING,
      triggerSource: params.triggerSource,
      replayedFromDeliveryId: params.replayedFromDeliveryId,
      attemptCount: 0,
      maxAttempts: params.maxAttempts,
      lastHttpStatus: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextRetryAt: null,
      deliveredAt: null,
      correlationId: params.correlationId,
      requestedBy: params.requestedBy,
    });
  }

  private async enqueueDeliveryJob(
    delivery: WebhookDeliveryEntity,
    endpoint: WebhookEndpointEntity,
    runtimeConfig: WebhookRuntimeConfig,
  ): Promise<boolean> {
    if (!this.messagePublisher) {
      delivery.status = WEBHOOK_DELIVERY_STATUS.FAILED;
      delivery.lastErrorCode = 'QUEUE_PUBLISHER_UNAVAILABLE';
      delivery.lastErrorMessage = 'Message publisher is not available';
      await this.deliveryRepo.saveEntity(delivery);
      return false;
    }

    try {
      const jobPayload: QueuedWebhookDeliveryJobPayload = {
        deliveryId: Number(delivery.id),
      };
      await this.messagePublisher.publish(
        WEBHOOKS_QUEUE_TOPICS.DELIVERY_SEND,
        jobPayload,
        QUEUES.SYSTEM_EVENTS,
        {
          attempts: Number(delivery.maxAttempts),
          backoff: 'exponential',
          backoffDelayMs: runtimeConfig.retryBaseDelayMs,
          timeoutMs: (Number(endpoint.timeoutMs) || runtimeConfig.defaultTimeoutMs) + 5_000,
          idempotencyKey: delivery.deliveryUid,
          index: {
            deliveryId: Number(delivery.id),
            endpointId: Number(endpoint.id),
            eventName: delivery.eventName,
          },
        },
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      delivery.status = WEBHOOK_DELIVERY_STATUS.FAILED;
      delivery.lastErrorCode = 'QUEUE_PUBLISH_FAILED';
      delivery.lastErrorMessage = msg.slice(0, 1000);
      await this.deliveryRepo.saveEntity(delivery);
      this.logger.warn(
        `Failed to enqueue webhook delivery #${delivery.id} (${delivery.eventName}): ${msg}`,
      );
      return false;
    }
  }

  private async recordAttempt(params: {
    readonly delivery: WebhookDeliveryEntity;
    readonly endpoint: WebhookEndpointEntity;
    readonly attemptNumber: number;
    readonly requestHeaders: Record<string, string>;
    readonly responseStatus: number | null;
    readonly responseHeaders: Record<string, string>;
    readonly responseBodySnippet: string | null;
    readonly durationMs: number;
    readonly isSuccess: boolean;
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
    readonly attemptedAt: Date;
  }): Promise<void> {
    await this.attemptRepo.saveEntity({
      deliveryId: Number(params.delivery.id),
      endpointId: Number(params.endpoint.id),
      attemptNumber: params.attemptNumber,
      requestUrl: params.endpoint.targetUrl,
      requestHeadersJson: JSON.stringify(params.requestHeaders),
      responseStatus: params.responseStatus,
      responseHeadersJson: JSON.stringify(params.responseHeaders),
      responseBodySnippet: params.responseBodySnippet,
      durationMs: params.durationMs,
      isSuccess: params.isSuccess,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage ? params.errorMessage.slice(0, 1000) : null,
      attemptedAt: params.attemptedAt,
    });
  }
}
