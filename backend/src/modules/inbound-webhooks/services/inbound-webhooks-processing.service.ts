import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParseObject,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { BaseMessagePublisherProvider, JobError, QUEUES } from '@packages/messaging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  INBOUND_WEBHOOKS_QUEUE_TOPICS,
  INBOUND_WEBHOOK_EVENT_STATUS,
  getInboundWebhookEventStatusName,
} from '../enum/inbound-webhooks.enum.js';
import type { InboundWebhookProviderEntity } from '../entities/inbound-webhook-provider.entity.js';
import { resolveInboundWebhookRuntimeConfig } from '../helpers/inbound-webhook-config.helper.js';
import { InboundWebhookAttemptRepository } from '../repositories/inbound-webhook-attempt.repository.js';
import { InboundWebhookEventRepository } from '../repositories/inbound-webhook-event.repository.js';
import { InboundWebhookProviderRepository } from '../repositories/inbound-webhook-provider.repository.js';
import type {
  ListInboundWebhookEventsQuery,
  ReprocessInboundWebhookEventRequest,
} from '../requests/inbound-webhooks.requests.js';
import { InboundWebhooksResponseMapper } from '../responses/inbound-webhooks.response.js';
import type {
  InboundWebhookEventView,
  ProcessQueuedInboundWebhookContext,
  ProcessQueuedInboundWebhookResult,
  QueuedInboundWebhookJobPayload,
} from '../types/inbound-webhooks.types.js';
import { InboundWebhookHandlerRegistry } from './inbound-webhook-handler.registry.js';

@Injectable()
export class InboundWebhooksProcessingService {
  private readonly logger = new Logger(InboundWebhooksProcessingService.name);
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly providerRepo: InboundWebhookProviderRepository,
    private readonly eventRepo: InboundWebhookEventRepository,
    private readonly attemptRepo: InboundWebhookAttemptRepository,
    private readonly handlerRegistry: InboundWebhookHandlerRegistry,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public async listEvents(
    query: ListInboundWebhookEventsQuery,
  ): Promise<PaginatedResult<InboundWebhookEventView>> {
    const paged = await this.eventRepo.listPaginated({
      page: query.page,
      limit: query.limit,
      countMode: query.countMode,
      providerCode: query.providerCode,
      eventType: query.eventType,
      status: query.status,
      search: query.search,
    });

    const providerIds = paged.data.map((item) => Number(item.providerId));
    const providers = await this.providerRepo.findByIds(providerIds);
    const providerMap = new Map<number, InboundWebhookProviderEntity>(
      providers.map((p) => [Number(p.id), p]),
    );

    return createPaginatedResult(
      paged.data.map((ev) =>
        InboundWebhooksResponseMapper.toEventView(ev, {
          provider: providerMap.get(Number(ev.providerId)) ?? null,
        }),
      ),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getEventById(id: number): Promise<InboundWebhookEventView> {
    const event = await this.eventRepo.findByIdSafe(Number(id));
    if (!event) {
      throw new NotFoundAppException('inbound-webhooks.eventNotFound', { id });
    }
    const [provider, attempts] = await Promise.all([
      this.providerRepo.findByIdSafe(Number(event.providerId)),
      this.attemptRepo.findByEventId(Number(event.id)),
    ]);
    return InboundWebhooksResponseMapper.toEventView(event, { provider, attempts });
  }

  public async processQueuedEvent(
    payload: QueuedInboundWebhookJobPayload,
    context?: ProcessQueuedInboundWebhookContext,
  ): Promise<ProcessQueuedInboundWebhookResult> {
    const eventId = Number(payload.inboundEventId);
    const event = await this.eventRepo.findByIdSafe(eventId);
    if (!event) {
      return {
        eventId,
        providerCode: payload.providerCode ?? 'unknown',
        status: 'SKIPPED',
        handlerName: 'none',
        attemptNumber: context?.attemptNumber ?? 1,
        skipped: true,
        reason: 'event_not_found',
      };
    }

    if (
      event.status === INBOUND_WEBHOOK_EVENT_STATUS.PROCESSED ||
      event.status === INBOUND_WEBHOOK_EVENT_STATUS.REJECTED
    ) {
      return {
        eventId: Number(event.id),
        providerCode: event.providerCode,
        status: 'SKIPPED',
        handlerName: event.lastHandlerName ?? 'none',
        attemptNumber: Number(event.attemptCount ?? 0),
        skipped: true,
        reason: 'already_terminal',
      };
    }

    const attemptNumber = Math.max(
      1,
      context?.attemptNumber ?? Number(event.attemptCount ?? 0) + 1,
    );
    const maxAttempts = Math.max(1, context?.maxAttempts ?? Number(event.maxAttempts ?? 1));

    event.status = INBOUND_WEBHOOK_EVENT_STATUS.PROCESSING;
    await this.eventRepo.saveEntity(event);

    const registered = this.handlerRegistry.resolveHandler(event.providerCode, event.eventType);
    const handlerName = registered?.name ?? 'default.recorded';
    const startedAtMs = Date.now();

    try {
      const headersObj = safeJsonParseObject<Record<string, string>>(event.headersRedactedJson, {});
      const payloadObj = safeJsonParseObject<Record<string, unknown>>(
        event.payloadRedactedJson,
        {},
      );

      let summary: Record<string, unknown> = {
        mode: registered ? 'handler' : 'recorded_only',
        eventType: event.eventType ?? null,
      };

      if (registered) {
        const handlerRes = await registered.handle({
          eventId: Number(event.id),
          eventUid: event.eventUid,
          providerCode: event.providerCode,
          externalEventId: event.externalEventId ?? event.eventUid,
          eventType: event.eventType ?? null,
          eventTimestamp: event.eventTimestamp ?? null,
          payload: payloadObj,
          headers: headersObj,
          correlationId: event.correlationId ?? null,
          attemptNumber,
        });
        if (handlerRes?.summary) {
          summary = handlerRes.summary;
        }
      }

      const finishedAt = new Date();
      const durationMs = Math.max(0, Date.now() - startedAtMs);

      await this.attemptRepo.saveEntity({
        eventId: Number(event.id),
        providerId: Number(event.providerId),
        providerCode: event.providerCode,
        attemptNumber,
        handlerName,
        isSuccess: true,
        durationMs,
        resultSummaryJson: JSON.stringify(summary),
        errorCode: null,
        errorMessage: null,
        attemptedAt: finishedAt,
      });

      event.status = INBOUND_WEBHOOK_EVENT_STATUS.PROCESSED;
      event.attemptCount = attemptNumber;
      event.lastHandlerName = handlerName;
      event.lastErrorCode = null;
      event.lastErrorMessage = null;
      event.processedAt = finishedAt;
      await this.eventRepo.saveEntity(event);

      const provider = await this.providerRepo.findByIdSafe(Number(event.providerId));
      if (provider) {
        provider.lastProcessedAt = finishedAt;
        await this.providerRepo.saveEntity(provider);
      }

      return {
        eventId: Number(event.id),
        providerCode: event.providerCode,
        status: getInboundWebhookEventStatusName(event.status),
        handlerName,
        attemptNumber,
      };
    } catch (err) {
      const finishedAt = new Date();
      const durationMs = Math.max(0, Date.now() - startedAtMs);
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorCode = this.extractErrorCode(err);
      const retryable = this.isRetryableError(err);
      const willRetry = retryable && attemptNumber < maxAttempts;

      await this.attemptRepo.saveEntity({
        eventId: Number(event.id),
        providerId: Number(event.providerId),
        providerCode: event.providerCode,
        attemptNumber,
        handlerName,
        isSuccess: false,
        durationMs,
        resultSummaryJson: null,
        errorCode,
        errorMessage: errorMessage.slice(0, 1000),
        attemptedAt: finishedAt,
      });

      event.attemptCount = attemptNumber;
      event.lastHandlerName = handlerName;
      event.lastErrorCode = errorCode;
      event.lastErrorMessage = errorMessage.slice(0, 1000);
      event.status = willRetry
        ? INBOUND_WEBHOOK_EVENT_STATUS.QUEUED
        : INBOUND_WEBHOOK_EVENT_STATUS.FAILED;
      await this.eventRepo.saveEntity(event);

      if (willRetry) {
        throw new JobError('InboundWebhookTransientError', errorMessage, {
          retryable: true,
          cause: err,
        });
      }

      throw new JobError(
        retryable ? 'InboundWebhookRetriesExhausted' : 'InboundWebhookPermanentError',
        errorMessage,
        {
          retryable: false,
          cause: err,
        },
      );
    }
  }

  public async reprocessEvent(
    eventId: number,
    input: ReprocessInboundWebhookEventRequest,
    actor?: UserIdentity,
  ): Promise<InboundWebhookEventView> {
    const event = await this.eventRepo.findByIdSafe(Number(eventId));
    if (!event) {
      throw new NotFoundAppException('inbound-webhooks.eventNotFound', { id: eventId });
    }

    if (event.status !== INBOUND_WEBHOOK_EVENT_STATUS.FAILED) {
      throw new BadRequestAppException('inbound-webhooks.eventNotReprocessable', [{ id: eventId }]);
    }

    const runtimeConfig = resolveInboundWebhookRuntimeConfig(this.settingRegistry);
    event.status = INBOUND_WEBHOOK_EVENT_STATUS.QUEUED;
    event.attemptCount = 0;
    event.lastErrorCode = null;
    event.lastErrorMessage = null;
    const saved = await this.eventRepo.saveEntity(event);

    if (!this.messagePublisher) {
      saved.status = INBOUND_WEBHOOK_EVENT_STATUS.FAILED;
      saved.lastErrorCode = 'QUEUE_PUBLISHER_UNAVAILABLE';
      saved.lastErrorMessage = 'Message publisher is not available';
      await this.eventRepo.saveEntity(saved);
      throw new BadRequestAppException('inbound-webhooks.queuePublishFailed', [
        { eventId: Number(saved.id) },
      ]);
    }

    try {
      await this.messagePublisher.publish(
        INBOUND_WEBHOOKS_QUEUE_TOPICS.EVENT_PROCESS,
        {
          inboundEventId: Number(saved.id),
          eventUid: saved.eventUid,
          providerCode: saved.providerCode,
        },
        QUEUES.SYSTEM_EVENTS,
        {
          attempts: Math.max(1, Number(saved.maxAttempts || 1 + runtimeConfig.defaultMaxRetries)),
          backoff: 'exponential',
          backoffDelayMs: runtimeConfig.retryBaseDelayMs,
          idempotencyKey: `inbound-webhook-reprocess:${saved.eventUid}:${Date.now()}`,
          index: {
            inboundEventId: Number(saved.id),
            providerCode: saved.providerCode,
            reprocess: 1,
          },
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      saved.status = INBOUND_WEBHOOK_EVENT_STATUS.FAILED;
      saved.lastErrorCode = 'QUEUE_PUBLISH_FAILED';
      saved.lastErrorMessage = msg.slice(0, 1000);
      await this.eventRepo.saveEntity(saved);
      this.logger.warn(`Failed to re-enqueue inbound webhook event #${saved.id}: ${msg}`);
      throw new BadRequestAppException('inbound-webhooks.queuePublishFailed', [
        { eventId: Number(saved.id) },
      ]);
    }

    const actorUserId = parseNumericUserId(actor?.id);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'inbound-webhooks',
      feature: 'events',
      action: 'REPROCESS',
      resourceType: 'inbound_webhook_event',
      resourceId: String(saved.id),
      beforeData: { status: INBOUND_WEBHOOK_EVENT_STATUS.FAILED },
      afterData: { status: INBOUND_WEBHOOK_EVENT_STATUS.QUEUED },
      reason: input.reason?.trim() || 'Manually reprocessed failed inbound webhook event',
    });

    return this.getEventById(Number(saved.id));
  }

  private extractErrorCode(err: unknown): string {
    if (err && typeof err === 'object' && 'code' in err) {
      const raw = (err as { code?: unknown }).code;
      if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().slice(0, 80);
      }
    }
    if (err instanceof Error && err.name) {
      return err.name.slice(0, 80);
    }
    return 'INBOUND_PROCESSING_ERROR';
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof JobError) {
      return err.retryable ?? true;
    }
    if (
      err instanceof BadRequestAppException ||
      err instanceof NotFoundAppException ||
      err instanceof ForbiddenAppException ||
      err instanceof ConflictAppException
    ) {
      return false;
    }
    return true;
  }
}
