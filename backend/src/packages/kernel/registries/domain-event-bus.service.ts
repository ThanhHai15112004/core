import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  DOMAIN_EVENT_CRITICALITY,
  type CreateDomainEventInput,
  type DomainEvent,
  type DomainEventContextResolver,
  type DomainEventCriticality,
  type DomainEventDispatchReport,
  type DomainEventHandler,
  type DomainEventHandlerExecutionResult,
  type DomainEventHandlerRegistration,
  type DomainEventHandlerStats,
  type DomainEventLogger,
  type DomainEventPublishOptions,
  type DomainEventRecentDispatch,
  type DomainEventRuntimeSnapshot,
  type IDomainEventBus,
} from '../contracts/domain-event.contract.js';
import { IDEMPOTENCY_OUTCOME, IDEMPOTENCY_SCOPE } from '../contracts/idempotency.contract.js';
import {
  DomainEventRequiredHandlerException,
  type RequiredHandlerFailureDetail,
} from '../errors/domain-event.exception.js';
import {
  IdempotencyInProgressException,
  IdempotencyPayloadMismatchException,
} from '../errors/idempotency.exception.js';
import {
  assertSafeDomainEventPayload,
  createDomainEvent,
  isDomainEventEnvelope,
  matchesDomainEventPattern,
  normalizeDomainEventType,
} from '../utils/domain-event.util.js';
import { computeIdempotencyFingerprint } from '../utils/idempotency.util.js';
import {
  IdempotencyRegistryService,
  defaultIdempotencyRegistry,
} from './idempotency-registry.service.js';

interface InternalHandlerEntry {
  readonly id: string;
  readonly module: string;
  readonly eventPattern: string;
  readonly criticality: DomainEventCriticality;
  readonly idempotent: boolean | undefined;
  readonly idempotencyTtlSec: number | undefined;
  readonly description: string | null;
  readonly registeredAt: string;
  readonly handler: DomainEventHandler<Record<string, unknown>>;
  invokedCount: number;
  succeededCount: number;
  skippedDuplicateCount: number;
  failedCount: number;
  lastInvokedAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

const MAX_RECENT_DISPATCHES = 50;

/**
 * Trung tâm phát & đăng ký Domain Event dùng chung toàn hệ thống (Phase 11.1).
 * - Tách rời hoàn toàn module phát và module nhận (không cần import chéo).
 * - Tự gắn `requestId`, `correlationId`, `actorId` qua `DomainEventContextResolver` (nối từ `LoggingModule`).
 * - Kiểm định tên event & payload sạch (chặn ORM Entity / secret) trước khi phát.
 * - Phân biệt rạch ròi lỗi handler bắt buộc (`required` -> log error + throw) và lỗi phụ (`optional` -> log warn, giữ luồng chính).
 */
@Injectable()
export class DomainEventBusService implements IDomainEventBus {
  private readonly fallbackLogger = new Logger(DomainEventBusService.name);
  private readonly handlers = new Map<string, InternalHandlerEntry>();
  private readonly recentDispatches: DomainEventRecentDispatch[] = [];
  private readonly recordedEvents: DomainEvent[] = [];
  private recordingEnabled = false;
  private contextResolver: DomainEventContextResolver | null = null;
  private customLogger: DomainEventLogger | null = null;
  private idempotencyRegistry: IdempotencyRegistryService;

  private totalPublished = 0;
  private totalHandlerInvocations = 0;
  private totalRequiredFailures = 0;
  private totalOptionalFailures = 0;

  constructor(
    @Optional() idempotencyRegistry?: IdempotencyRegistryService,
  ) {
    this.idempotencyRegistry = idempotencyRegistry ?? defaultIdempotencyRegistry;
  }

  /** Nối bộ chống xử lý trùng (`IdempotencyRegistryService`) cho Event Inbox (Phase 11.3). */
  public setIdempotencyRegistry(registry: IdempotencyRegistryService | null): void {
    this.idempotencyRegistry = registry ?? defaultIdempotencyRegistry;
  }

  /** Nối bộ giải ngữ cảnh hiện tại (`RequestContextService`) từ `@packages/logging`. */
  public setContextResolver(resolver: DomainEventContextResolver | null): void {
    this.contextResolver = resolver;
  }

  /** Nối structured logger tùy biến (hoặc spy logger trong test). */
  public setLogger(logger: DomainEventLogger | null): void {
    this.customLogger = logger;
  }

  /** Đăng ký Event Handler cho một module; trả về hàm hủy đăng ký. */
  public registerHandler<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    registration: DomainEventHandlerRegistration<TPayload>,
  ): () => void {
    const id = registration.id.trim();
    const moduleName = registration.module.trim().toLowerCase();
    const pattern = registration.eventPattern.trim();
    if (!id || !moduleName || !pattern) {
      throw new Error(
        'DomainEventBusService.registerHandler requires non-empty id, module, and eventPattern',
      );
    }

    const criticality = registration.criticality ?? DOMAIN_EVENT_CRITICALITY.OPTIONAL;
    const entry: InternalHandlerEntry = {
      id,
      module: moduleName,
      eventPattern: pattern,
      criticality,
      idempotent: registration.idempotent,
      idempotencyTtlSec: registration.idempotencyTtlSec,
      description: registration.description?.trim() || null,
      registeredAt: new Date().toISOString(),
      handler: registration.handler as DomainEventHandler<Record<string, unknown>>,
      invokedCount: 0,
      succeededCount: 0,
      skippedDuplicateCount: 0,
      failedCount: 0,
      lastInvokedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    };

    this.handlers.set(id, entry);
    return () => {
      if (this.handlers.get(id) === entry) {
        this.handlers.delete(id);
      }
    };
  }

  /** Hủy đăng ký Event Handler theo ID. */
  public unregisterHandler(handlerId: string): boolean {
    return this.handlers.delete(handlerId);
  }

  /** Liệt kê toàn bộ Event Handler đang đăng ký cùng thống kê chạy/lỗi. */
  public listHandlers(): readonly DomainEventHandlerStats[] {
    return [...this.handlers.values()].map((h) => ({
      id: h.id,
      module: h.module,
      eventPattern: h.eventPattern,
      criticality: h.criticality,
      description: h.description,
      registeredAt: h.registeredAt,
      invokedCount: h.invokedCount,
      succeededCount: h.succeededCount,
      skippedDuplicateCount: h.skippedDuplicateCount,
      failedCount: h.failedCount,
      lastInvokedAt: h.lastInvokedAt,
      lastErrorAt: h.lastErrorAt,
      lastErrorMessage: h.lastErrorMessage,
    }));
  }

  /** Lấy ảnh chụp trạng thái vận hành của DomainEventBus phục vụ System Console. */
  public getSnapshot(): DomainEventRuntimeSnapshot {
    return {
      totalPublished: this.totalPublished,
      totalHandlerInvocations: this.totalHandlerInvocations,
      totalRequiredFailures: this.totalRequiredFailures,
      totalOptionalFailures: this.totalOptionalFailures,
      handlers: this.listHandlers(),
      recentDispatches: [...this.recentDispatches],
    };
  }

  /**
   * Chuẩn hóa và kiểm định một Domain Event kèm ngữ cảnh hiện tại (`requestId`, `correlationId`, `actorId`)
   * mà chưa phát tới các handler (dùng chung cho Transactional Outbox Phase 11.2).
   */
  public resolveEvent<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    input: CreateDomainEventInput<TPayload> | DomainEvent<TPayload>,
  ): DomainEvent<TPayload> {
    const context = this.contextResolver?.();
    return isDomainEventEnvelope(input)
      ? this.normalizeExistingEvent(input, context)
      : createDomainEvent(input, context);
  }

  /**
   * Phát một Domain Event tới tất cả các handler khớp mẫu:
   * - Handler `required` chạy trước; nếu lỗi sẽ ghi log mức `error` và ném `DomainEventRequiredHandlerException`.
   * - Handler `optional` chạy tiếp; nếu lỗi chỉ ghi log mức `warn` và không làm hỏng luồng chính.
   */
  public async publish<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    input: CreateDomainEventInput<TPayload> | DomainEvent<TPayload>,
    options?: DomainEventPublishOptions,
  ): Promise<DomainEventDispatchReport<TPayload>> {
    const event = this.resolveEvent(input);

    this.totalPublished += 1;
    if (this.recordingEnabled) {
      this.recordedEvents.push(event);
    }

    const matched = [...this.handlers.values()].filter((entry) =>
      matchesDomainEventPattern(entry.eventPattern, event),
    );
    const requiredHandlers = matched.filter(
      (h) => h.criticality === DOMAIN_EVENT_CRITICALITY.REQUIRED,
    );
    const optionalHandlers = matched.filter(
      (h) => h.criticality === DOMAIN_EVENT_CRITICALITY.OPTIONAL,
    );

    const results: DomainEventHandlerExecutionResult[] = [];
    const requiredFailures: RequiredHandlerFailureDetail[] = [];
    let firstRequiredCause: unknown;
    let succeededCount = 0;
    let skippedDuplicateCount = 0;
    let failedRequiredCount = 0;
    let failedOptionalCount = 0;
    let cachedEventFingerprint: string | null = null;

    for (const entry of [...requiredHandlers, ...optionalHandlers]) {
      const startedAt = Date.now();
      entry.invokedCount += 1;
      entry.lastInvokedAt = new Date().toISOString();
      this.totalHandlerInvocations += 1;

      const shouldDeduplicate =
        this.idempotencyRegistry.isReady() &&
        (entry.idempotent === true ||
          (options?.enforceIdempotency === true && entry.idempotent !== false));

      let acquiredRecordId: number | null = null;
      let acquiredLockOwner: string | null = null;
      let acquiredLock = false;

      try {
        if (shouldDeduplicate) {
          if (cachedEventFingerprint === null) {
            cachedEventFingerprint = computeIdempotencyFingerprint({
              type: event.type,
              version: event.version,
              payload: event.payload,
            });
          }
          const lockOwner = event.metadata.correlationId ?? `evt:${event.id}`;
          const clientIdentifier =
            options?.clientIdentifier ?? `module:${event.metadata.sourceModule}`;
          const acquired = await this.idempotencyRegistry.acquire({
            scope: IDEMPOTENCY_SCOPE.EVENT,
            scopeTarget: entry.id,
            idempotencyKey: event.id,
            requestFingerprint: cachedEventFingerprint,
            ttlSec: entry.idempotencyTtlSec ?? options?.idempotencyTtlSec,
            lockOwner,
            clientIdentifier,
            correlationId: event.metadata.correlationId,
          });

          if (acquired.outcome === IDEMPOTENCY_OUTCOME.REPLAYED) {
            const durationMs = Math.max(0, Date.now() - startedAt);
            entry.skippedDuplicateCount += 1;
            skippedDuplicateCount += 1;
            results.push({
              handlerId: entry.id,
              module: entry.module,
              criticality: entry.criticality,
              status: 'skipped_duplicate',
              skippedReason: 'already_processed',
              durationMs,
            });
            continue;
          }

          if (acquired.outcome === IDEMPOTENCY_OUTCOME.PAYLOAD_MISMATCH) {
            throw new IdempotencyPayloadMismatchException({
              scope: IDEMPOTENCY_SCOPE.EVENT,
              scopeTarget: entry.id,
              idempotencyKey: event.id,
              reason: `Domain Event "${event.type}" (${event.id}) reused with mismatched payload`,
            });
          }

          if (acquired.outcome === IDEMPOTENCY_OUTCOME.IN_PROGRESS) {
            throw new IdempotencyInProgressException({
              scope: IDEMPOTENCY_SCOPE.EVENT,
              scopeTarget: entry.id,
              idempotencyKey: event.id,
              reason: `Domain Event "${event.type}" (${event.id}) is currently being processed by handler "${entry.id}"`,
            });
          }

          acquiredRecordId = acquired.recordId;
          acquiredLockOwner = acquired.lockOwner;
          acquiredLock = acquired.persisted;
        }

        await entry.handler(event);

        if (acquiredLock) {
          await this.idempotencyRegistry.complete({
            scope: IDEMPOTENCY_SCOPE.EVENT,
            scopeTarget: entry.id,
            idempotencyKey: event.id,
            recordId: acquiredRecordId,
            lockOwner: acquiredLockOwner,
            statusCode: 200,
            responseBody: {
              eventId: event.id,
              eventType: event.type,
              handlerId: entry.id,
              module: entry.module,
            },
          });
        }

        const durationMs = Math.max(0, Date.now() - startedAt);
        entry.succeededCount += 1;
        succeededCount += 1;
        results.push({
          handlerId: entry.id,
          module: entry.module,
          criticality: entry.criticality,
          status: 'succeeded',
          durationMs,
        });
      } catch (err) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const errorName = err instanceof Error ? err.name : 'Error';
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (acquiredLock) {
          await this.idempotencyRegistry
            .fail({
              scope: IDEMPOTENCY_SCOPE.EVENT,
              scopeTarget: entry.id,
              idempotencyKey: event.id,
              recordId: acquiredRecordId,
              lockOwner: acquiredLockOwner,
              errorCode: errorName.slice(0, 80),
              errorMessage: errorMessage.slice(0, 1000),
            })
            .catch(() => undefined);
        }

        entry.failedCount += 1;
        entry.lastErrorAt = new Date().toISOString();
        entry.lastErrorMessage = errorMessage;

        results.push({
          handlerId: entry.id,
          module: entry.module,
          criticality: entry.criticality,
          status: 'failed',
          durationMs,
          errorName,
          errorMessage,
        });

        const logMeta: Record<string, unknown> = {
          eventId: event.id,
          eventType: event.type,
          eventDotName: event.metadata.dotName,
          eventVersion: event.version,
          sourceModule: event.metadata.sourceModule,
          handlerId: entry.id,
          subscriberModule: entry.module,
          criticality: entry.criticality,
          requestId: event.metadata.requestId,
          correlationId: event.metadata.correlationId,
          durationMs,
          errorName,
          errorMessage,
        };

        if (entry.criticality === DOMAIN_EVENT_CRITICALITY.REQUIRED) {
          failedRequiredCount += 1;
          this.totalRequiredFailures += 1;
          requiredFailures.push({
            handlerId: entry.id,
            module: entry.module,
            errorName,
            errorMessage,
          });
          if (firstRequiredCause === undefined) {
            firstRequiredCause = err;
          }
          this.logError(
            `[DomainEvent][REQUIRED_FAILED] ${event.type} (${event.id}) failed in required handler "${entry.id}" (${entry.module}): ${errorMessage}`,
            logMeta,
          );
        } else {
          failedOptionalCount += 1;
          this.totalOptionalFailures += 1;
          this.logWarn(
            `[DomainEvent][OPTIONAL_FAILED] ${event.type} (${event.id}) failed in optional handler "${entry.id}" (${entry.module}): ${errorMessage}`,
            logMeta,
          );
        }
      }
    }

    this.pushRecentDispatch({
      id: event.id,
      type: event.type,
      dotName: event.metadata.dotName,
      version: event.version,
      sourceModule: event.metadata.sourceModule,
      occurredAt: event.occurredAt,
      requestId: event.metadata.requestId,
      correlationId: event.metadata.correlationId,
      matchedHandlers: matched.length,
      succeededCount,
      skippedDuplicateCount,
      failedRequiredCount,
      failedOptionalCount,
    });

    if (requiredFailures.length > 0) {
      throw new DomainEventRequiredHandlerException({
        eventId: event.id,
        eventType: event.type,
        failures: requiredFailures,
        cause: firstRequiredCause,
      });
    }

    return {
      event,
      matchedHandlers: matched.length,
      succeededCount,
      skippedDuplicateCount,
      failedRequiredCount,
      failedOptionalCount,
      results,
    };
  }

  /** Bật chế độ ghi nhận các sự kiện đã phát (dùng cho test harness). */
  public startRecording(): void {
    this.recordingEnabled = true;
    this.recordedEvents.length = 0;
  }

  /** Tắt chế độ ghi nhận sự kiện. */
  public stopRecording(): void {
    this.recordingEnabled = false;
  }

  /** Trả về danh sách sự kiện đã phát kể từ khi bật ghi nhận. */
  public getRecordedEvents(): readonly DomainEvent[] {
    return [...this.recordedEvents];
  }

  /** Xóa danh sách sự kiện đã ghi nhận. */
  public clearRecordedEvents(): void {
    this.recordedEvents.length = 0;
  }

  /** Đặt lại toàn bộ trạng thái nội bộ (chỉ dùng trong unit/integration test). */
  public resetForTesting(): void {
    this.handlers.clear();
    this.recentDispatches.length = 0;
    this.recordedEvents.length = 0;
    this.recordingEnabled = false;
    this.totalPublished = 0;
    this.totalHandlerInvocations = 0;
    this.totalRequiredFailures = 0;
    this.totalOptionalFailures = 0;
    this.customLogger = null;
  }

  private normalizeExistingEvent<TPayload extends Record<string, unknown>>(
    event: DomainEvent<TPayload>,
    context?: {
      readonly requestId?: string | null | undefined;
      readonly correlationId?: string | null | undefined;
      readonly actorId?: string | number | null | undefined;
    },
  ): DomainEvent<TPayload> {
    const { type, dotName } = normalizeDomainEventType(event.type, event.metadata.dotName);
    const safePayload = assertSafeDomainEventPayload(event.payload as TPayload);
    const requestId = event.metadata.requestId ?? context?.requestId ?? null;
    const correlationId = event.metadata.correlationId ?? context?.correlationId ?? requestId;
    const actorId = event.metadata.actorId ?? context?.actorId ?? null;

    return Object.freeze({
      ...event,
      type,
      payload: safePayload,
      metadata: Object.freeze({
        ...event.metadata,
        dotName,
        requestId,
        correlationId,
        actorId,
      }),
    });
  }

  private pushRecentDispatch(item: DomainEventRecentDispatch): void {
    this.recentDispatches.unshift(item);
    if (this.recentDispatches.length > MAX_RECENT_DISPATCHES) {
      this.recentDispatches.length = MAX_RECENT_DISPATCHES;
    }
  }

  private logWarn(message: string, meta: Record<string, unknown>): void {
    if (this.customLogger) {
      this.customLogger.warn(message, meta);
      return;
    }
    this.fallbackLogger.warn(`${message} ${JSON.stringify(meta)}`);
  }

  private logError(message: string, meta: Record<string, unknown>): void {
    if (this.customLogger) {
      this.customLogger.error(message, meta);
      return;
    }
    this.fallbackLogger.error(`${message} ${JSON.stringify(meta)}`);
  }
}

export const defaultDomainEventBus = new DomainEventBusService();
