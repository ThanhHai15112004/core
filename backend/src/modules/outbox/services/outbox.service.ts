import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  BadRequestAppException,
  DomainEventBusService,
  NotFoundAppException,
  OutboxPublisherService,
  SettingRegistryService,
  defaultDomainEventBus,
  defaultOutboxPublisher,
  defaultSettingRegistry,
  parseNumericUserId,
  type CreateDomainEventInput,
  type DomainEvent,
  type EnqueueOutboxEventOptions,
  type OutboxEnqueuedRecord,
  type OutboxMetricsSnapshot,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type {
  IOutboxPublicService,
  ListOutboxEventsInput,
  ReplayOutboxBatchInput,
  ReplayOutboxEventInput,
} from '../contracts/index.js';
import {
  OUTBOX_AUDIT_META,
  OUTBOX_DEFAULTS,
  OUTBOX_EVENT_STATUS,
  getOutboxEventStatusName,
} from '../enum/outbox.enum.js';
import { resolveOutboxRuntimeConfig } from '../helpers/outbox-config.helper.js';
import { OutboxEventRepository } from '../repositories/outbox-event.repository.js';
import { OutboxResponseMapper } from '../responses/outbox.response.js';
import type {
  OutboxDispatchBatchOptions,
  OutboxDispatchBatchResult,
  OutboxEventDetailView,
  OutboxEventView,
  OutboxLagAlertCheckResult,
  OutboxPurgeOptions,
  OutboxPurgeResult,
  OutboxReplayBatchItemResult,
  OutboxReplayBatchResult,
} from '../types/outbox.types.js';
import { OutboxRelayService } from './outbox-relay.service.js';

const MAX_CLEANUP_ITERATIONS = 50;

/**
 * Service trung tâm quản lý Transactional Outbox (Phase 11.2):
 * - Đăng ký writer & metrics provider vào `OutboxPublisherService` (`@packages/kernel`).
 * - Ghi sự kiện vào `outbox_events` ngay trong cùng transaction nghiệp vụ qua `TransactionManager` (ALS).
 * - Tra cứu/lọc sự kiện, xem độ trễ/tồn đọng, phát lại có quyền + Audit Log và dọn sự kiện cũ theo retention.
 */
@Injectable()
export class OutboxService implements IOutboxPublicService, OnModuleInit, OnModuleDestroy {
  private readonly outboxPublisher: OutboxPublisherService;
  private readonly domainEventBus: DomainEventBusService;
  private readonly settingRegistry: SettingRegistryService;
  private unregisterWriter: (() => void) | null = null;
  private unregisterMetrics: (() => void) | null = null;

  constructor(
    private readonly outboxRepo: OutboxEventRepository,
    private readonly relayService: OutboxRelayService,
    @Optional() private readonly transactionManager?: TransactionManager | null,
    @Optional()
    @Inject(OutboxPublisherService)
    outboxPublisher?: OutboxPublisherService,
    @Optional() domainEventBus?: DomainEventBusService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly auditLogService?: AuditLogService | null,
  ) {
    this.outboxPublisher = outboxPublisher ?? defaultOutboxPublisher;
    this.domainEventBus = domainEventBus ?? defaultDomainEventBus;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public onModuleInit(): void {
    this.unregisterWriter = this.outboxPublisher.registerWriter((event, options) =>
      this.enqueueEvent(event, options),
    );
    this.unregisterMetrics = this.outboxPublisher.registerMetricsProvider(() => this.getMetrics());
  }

  public onModuleDestroy(): void {
    this.unregisterWriter?.();
    this.unregisterWriter = null;
    this.unregisterMetrics?.();
    this.unregisterMetrics = null;
  }

  public async enqueueEvent<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    input: CreateDomainEventInput<TPayload> | DomainEvent<TPayload>,
    options?: EnqueueOutboxEventOptions,
  ): Promise<OutboxEnqueuedRecord> {
    if (
      options?.requireTransaction &&
      this.transactionManager &&
      !this.transactionManager.isInTransaction()
    ) {
      throw new BadRequestAppException('outbox.transactionRequired');
    }

    const event = this.domainEventBus.resolveEvent(input);
    const runtimeConfig = resolveOutboxRuntimeConfig(this.settingRegistry);
    const destinationQueue = options?.destinationQueue?.trim() || OUTBOX_DEFAULTS.DESTINATION_QUEUE;
    const destinationTopic = options?.destinationTopic?.trim() || OUTBOX_DEFAULTS.DESTINATION_TOPIC;
    const maxRetries = Math.max(
      1,
      Math.min(
        OUTBOX_DEFAULTS.MAX_RETRIES_CAP,
        Math.round(options?.maxRetries ?? runtimeConfig.maxRetries),
      ),
    );
    const partitionKey =
      options?.partitionKey !== undefined
        ? options.partitionKey
        : event.aggregateType && event.aggregateId
          ? `${event.aggregateType}:${event.aggregateId}`
          : null;

    if (!this.outboxRepo.isDatabaseReady()) {
      if (options?.requireTransaction) {
        throw new BadRequestAppException('outbox.databaseUnavailable');
      }
      return {
        id: null,
        eventId: event.id,
        eventType: event.type,
        dotName: event.metadata.dotName,
        status: OUTBOX_EVENT_STATUS.PENDING,
        statusName: getOutboxEventStatusName(OUTBOX_EVENT_STATUS.PENDING),
        destinationQueue,
        destinationTopic,
        persisted: false,
      };
    }

    const occurredAtDate = new Date(event.occurredAt);
    const saved = await this.outboxRepo.saveEntity({
      eventId: event.id,
      eventType: event.type,
      dotName: event.metadata.dotName,
      eventVersion: event.version,
      sourceModule: event.metadata.sourceModule,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      partitionKey: partitionKey ? partitionKey.slice(0, 200) : null,
      destinationQueue,
      destinationTopic,
      payloadJson: JSON.stringify(event.payload),
      metadataJson: JSON.stringify(event.metadata),
      headersJson: options?.headers ? JSON.stringify(options.headers) : null,
      requestId: event.metadata.requestId,
      correlationId: event.metadata.correlationId,
      causationId: event.metadata.causationId,
      actorId:
        event.metadata.actorId !== null && event.metadata.actorId !== undefined
          ? String(event.metadata.actorId)
          : null,
      occurredAt: Number.isNaN(occurredAtDate.getTime()) ? new Date() : occurredAtDate,
      status: OUTBOX_EVENT_STATUS.PENDING,
      attemptCount: 0,
      maxRetries,
      nextAttemptAt: options?.availableAt ?? null,
      lockedBy: null,
      lockedUntil: null,
      lastAttemptedAt: null,
      publishedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      deadLetteredAt: null,
      deadLetterReason: null,
      replayCount: 0,
      lastReplayedAt: null,
      lastReplayedBy: null,
    });

    return {
      id: Number(saved.id),
      eventId: saved.eventId,
      eventType: saved.eventType,
      dotName: saved.dotName,
      status: saved.status,
      statusName: getOutboxEventStatusName(saved.status),
      destinationQueue: saved.destinationQueue,
      destinationTopic: saved.destinationTopic,
      persisted: true,
    };
  }

  public async listEvents(
    query: ListOutboxEventsInput,
  ): Promise<PaginatedResult<OutboxEventView>> {
    const paged = await this.outboxRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((entity) => OutboxResponseMapper.toEventView(entity)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getEventById(id: number): Promise<OutboxEventDetailView> {
    const entity = await this.outboxRepo.findByIdSafe(Number(id));
    if (!entity) {
      throw new NotFoundAppException('outbox.eventNotFound', { id });
    }
    return OutboxResponseMapper.toEventDetailView(entity);
  }

  public async getMetrics(now?: Date): Promise<OutboxMetricsSnapshot> {
    return this.relayService.getMetrics(now);
  }

  /**
   * Phát lại thủ công một sự kiện Outbox (chỉ cho phép `FAILED` / `DEAD_LETTER`, hoặc `PUBLISHED` khi bật `force`).
   * Mọi thao tác đều ghi nhật ký Audit bất biến qua `AuditLogService`.
   */
  public async replayEvent(
    id: number,
    input: ReplayOutboxEventInput,
    actor?: UserIdentity,
  ): Promise<OutboxEventDetailView> {
    const existing = await this.outboxRepo.findByIdSafe(Number(id));
    if (!existing) {
      throw new NotFoundAppException('outbox.eventNotFound', { id });
    }

    const canReplay =
      existing.status === OUTBOX_EVENT_STATUS.FAILED ||
      existing.status === OUTBOX_EVENT_STATUS.DEAD_LETTER ||
      (existing.status === OUTBOX_EVENT_STATUS.PUBLISHED && input.force === true);

    if (!canReplay) {
      throw new BadRequestAppException('outbox.replayInvalidState', [
        {
          id,
          status: getOutboxEventStatusName(existing.status),
        },
      ]);
    }

    const beforeSnapshot = {
      status: existing.status,
      statusName: getOutboxEventStatusName(existing.status),
      attemptCount: existing.attemptCount,
      replayCount: existing.replayCount,
      lastErrorCode: existing.lastErrorCode,
      deadLetterReason: existing.deadLetterReason,
    };

    const now = new Date();
    const actorUserId = parseNumericUserId(actor?.id);
    existing.status = OUTBOX_EVENT_STATUS.PENDING;
    existing.attemptCount = 0;
    existing.nextAttemptAt = now;
    existing.lockedBy = null;
    existing.lockedUntil = null;
    existing.lastErrorCode = null;
    existing.lastErrorMessage = null;
    existing.deadLetteredAt = null;
    existing.deadLetterReason = null;
    existing.replayCount = (Number(existing.replayCount) || 0) + 1;
    existing.lastReplayedAt = now;
    existing.lastReplayedBy = actorUserId;

    const saved = await this.outboxRepo.saveEntity(existing);

    await this.auditLogService?.record({
      actorUserId,
      module: OUTBOX_AUDIT_META.MODULE,
      feature: OUTBOX_AUDIT_META.FEATURES.REPLAY,
      action: 'outbox.event.replay',
      resourceType: OUTBOX_AUDIT_META.RESOURCE_TYPES.EVENT,
      resourceId: Number(saved.id),
      beforeData: beforeSnapshot,
      afterData: {
        eventId: saved.eventId,
        eventType: saved.eventType,
        status: saved.status,
        statusName: getOutboxEventStatusName(saved.status),
        attemptCount: saved.attemptCount,
        replayCount: saved.replayCount,
        force: Boolean(input.force),
      },
      reason: input.reason.trim(),
    });

    return OutboxResponseMapper.toEventDetailView(saved);
  }

  public async replayBatch(
    input: ReplayOutboxBatchInput,
    actor?: UserIdentity,
  ): Promise<OutboxReplayBatchResult> {
    const uniqueIds = [...new Set(input.ids.map((id) => Number(id)).filter((id) => id > 0))];
    const results: OutboxReplayBatchItemResult[] = [];
    let replayedCount = 0;

    for (const id of uniqueIds) {
      try {
        const replayed = await this.replayEvent(
          id,
          { reason: input.reason, force: input.force },
          actor,
        );
        replayedCount += 1;
        results.push({ id, replayed: true, statusName: replayed.statusName });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ id, replayed: false, error: message });
      }
    }

    return {
      requestedCount: uniqueIds.length,
      replayedCount,
      skippedCount: uniqueIds.length - replayedCount,
      results,
    };
  }

  public async processPendingBatch(
    options?: OutboxDispatchBatchOptions,
  ): Promise<OutboxDispatchBatchResult> {
    return this.relayService.processBatch(options);
  }

  public async checkLagAndAlert(now?: Date): Promise<OutboxLagAlertCheckResult> {
    return this.relayService.checkLagAndAlert(now);
  }

  /**
   * Dọn các bản ghi `PUBLISHED` và `DEAD_LETTER` đã quá hạn theo chính sách lưu trữ.
   * Không bao giờ xóa bản ghi `PENDING`, `PROCESSING` hay `FAILED`.
   */
  public async purgeExpiredEvents(
    options?: OutboxPurgeOptions,
    actor?: UserIdentity,
  ): Promise<OutboxPurgeResult> {
    const runtimeConfig = resolveOutboxRuntimeConfig(this.settingRegistry);
    const now = options?.now ?? new Date();
    const publishedDays = Math.max(
      1,
      Math.min(365, Math.round(options?.publishedRetentionDays ?? runtimeConfig.retentionPublishedDays)),
    );
    const deadLetterDays = Math.max(
      1,
      Math.min(
        365,
        Math.round(options?.deadLetterRetentionDays ?? runtimeConfig.retentionDeadLetterDays),
      ),
    );
    const batchSize = Math.max(
      50,
      Math.min(10_000, Math.round(options?.batchSize ?? runtimeConfig.cleanupBatchSize)),
    );

    const publishedCutoff = new Date(now.getTime() - publishedDays * 24 * 60 * 60 * 1000);
    const deadLetterCutoff = new Date(now.getTime() - deadLetterDays * 24 * 60 * 60 * 1000);

    let deletedPublishedCount = 0;
    for (let i = 0; i < MAX_CLEANUP_ITERATIONS; i += 1) {
      const removed = await this.outboxRepo.purgeExpiredByStatus(
        OUTBOX_EVENT_STATUS.PUBLISHED,
        publishedCutoff,
        batchSize,
      );
      deletedPublishedCount += removed;
      if (removed < batchSize) break;
    }

    let deletedDeadLetterCount = 0;
    for (let i = 0; i < MAX_CLEANUP_ITERATIONS; i += 1) {
      const removed = await this.outboxRepo.purgeExpiredByStatus(
        OUTBOX_EVENT_STATUS.DEAD_LETTER,
        deadLetterCutoff,
        batchSize,
      );
      deletedDeadLetterCount += removed;
      if (removed < batchSize) break;
    }

    const totalDeletedCount = deletedPublishedCount + deletedDeadLetterCount;
    const result: OutboxPurgeResult = {
      deletedPublishedCount,
      deletedDeadLetterCount,
      totalDeletedCount,
      publishedCutoffAt: publishedCutoff.toISOString(),
      deadLetterCutoffAt: deadLetterCutoff.toISOString(),
      executedAt: now.toISOString(),
    };

    if (actor) {
      await this.auditLogService?.record({
        actorUserId: parseNumericUserId(actor.id),
        module: OUTBOX_AUDIT_META.MODULE,
        feature: OUTBOX_AUDIT_META.FEATURES.RETENTION,
        action: 'outbox.cleanup.manual',
        resourceType: OUTBOX_AUDIT_META.RESOURCE_TYPES.EVENT,
        resourceId: 0,
        beforeData: {
          publishedRetentionDays: publishedDays,
          deadLetterRetentionDays: deadLetterDays,
          batchSize,
        },
        afterData: result as unknown as Record<string, unknown>,
        reason: options?.reason?.trim() || 'Manual outbox retention cleanup',
      });
    }

    return result;
  }
}
