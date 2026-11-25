import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import type { Counter, Gauge, Histogram } from 'prom-client';
import {
  OUTBOX_LAG_STATUS,
  SettingRegistryService,
  defaultSettingRegistry,
  safeJsonParseObject,
  type DomainEvent,
  type OutboxMetricsSnapshot,
} from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
  NOTIFICATIONS_PUBLIC_SERVICE,
  type INotificationsPublicService,
  type NotificationChannelName,
} from '@modules/notifications/contracts/index.js';
import { OUTBOX_TRANSPORT_PORT, type IOutboxTransport } from '../contracts/index.js';
import type { OutboxEventEntity } from '../entities/outbox-event.entity.js';
import {
  classifyOutboxDispatchError,
  computeOutboxRetryDelayMs,
  resolveOutboxRuntimeConfig,
} from '../helpers/outbox-config.helper.js';
import { evaluateOutboxLagSnapshot } from '../helpers/outbox-metrics.helper.js';
import { OutboxEventRepository } from '../repositories/outbox-event.repository.js';
import type {
  OutboxDispatchBatchOptions,
  OutboxDispatchBatchResult,
  OutboxLagAlertCheckResult,
} from '../types/outbox.types.js';
import { BullMqOutboxTransport } from './outbox-transport.service.js';

const ALERT_COOLDOWN_REDIS_KEY = 'outbox:lag-alert:cooldown';

/**
 * Worker Relay Service của Transactional Outbox (Phase 11.2):
 * - Claim theo lô với lease lock an toàn cho nhiều Worker chạy song song.
 * - Gửi sự kiện ra Queue/Broker qua `IOutboxTransport` (mặc định BullMQ).
 * - Đánh dấu `PUBLISHED` / `FAILED` (exponential backoff + jitter, có giới hạn retry) / `DEAD_LETTER`.
 * - Cập nhật metric độ trễ Prometheus & gửi cảnh báo quản trị (có cooldown) khi tồn đọng hoặc phát sinh Dead Letter.
 */
@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly transport: IOutboxTransport;
  private readonly settingRegistry: SettingRegistryService;
  private readonly dispatchCounter: Counter<'result'> | undefined;
  private readonly publishLagHistogram: Histogram<string> | undefined;
  private readonly backlogGauge: Gauge<'status'> | undefined;
  private readonly oldestPendingAgeGauge: Gauge<string> | undefined;

  private pollTimer: NodeJS.Timeout | null = null;
  private pollingActive = false;
  private inFlight = false;
  private currentTickPromise: Promise<void> | null = null;
  private lastAlertSentAtMs = 0;

  constructor(
    private readonly outboxRepo: OutboxEventRepository,
    @Optional()
    @Inject(OUTBOX_TRANSPORT_PORT)
    transport?: IOutboxTransport,
    @Optional() defaultTransport?: BullMqOutboxTransport,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() metrics?: MetricsRegistryService,
    @Optional() private readonly redis?: RedisService | null,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsPublicService?: INotificationsPublicService | null,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {
    this.transport = transport ?? defaultTransport ?? new BullMqOutboxTransport();
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.dispatchCounter = metrics?.counter(
      'outbox_dispatch_total',
      'Total outbox events processed by result',
      ['result'],
    );
    this.publishLagHistogram = metrics?.histogram(
      'outbox_publish_lag_seconds',
      'Lag in seconds from outbox event creation to successful publish',
      [],
      [0.05, 0.1, 0.5, 1, 2.5, 5, 15, 30, 60, 300],
    );
    this.backlogGauge = metrics?.gauge(
      'outbox_backlog_events',
      'Current number of outbox events by status',
      ['status'],
    );
    this.oldestPendingAgeGauge = metrics?.gauge(
      'outbox_oldest_pending_age_seconds',
      'Age in seconds of the oldest unpublished outbox event',
    );
  }

  public onModuleDestroy(): void {
    this.stopPolling();
  }

  /** Bắt đầu vòng poll Outbox (chỉ gọi trong Worker runtime, không chạy trong API/test). */
  public startPolling(workerId?: string): void {
    if (this.pollingActive) return;
    this.pollingActive = true;
    const resolvedWorkerId = workerId || this.defaultWorkerId();
    this.logger.log(`Outbox relay polling started (workerId=${resolvedWorkerId})`);
    this.scheduleNextTick(resolvedWorkerId, 250);
  }

  /** Dừng êm vòng poll khi Worker shutdown. */
  public stopPolling(): void {
    this.pollingActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Dừng vòng poll và chờ batch hiện tại đang gửi (nếu có) hoàn tất trước khi tắt Worker. */
  public async stopPollingAndDrain(timeoutMs = 15_000): Promise<void> {
    this.stopPolling();
    const pending = this.currentTickPromise;
    if (!pending) return;
    let timer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        pending,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(100, timeoutMs));
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private scheduleNextTick(workerId: string, delayMs: number): void {
    if (!this.pollingActive) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      const tick = this.runPollTick(workerId).finally(() => {
        if (this.currentTickPromise === tick) {
          this.currentTickPromise = null;
        }
      });
      this.currentTickPromise = tick;
    }, delayMs);
    this.pollTimer.unref();
  }

  private async runPollTick(workerId: string): Promise<void> {
    if (!this.pollingActive) return;
    const config = resolveOutboxRuntimeConfig(this.settingRegistry);
    let nextDelay = config.pollIntervalMs;

    if (!this.inFlight) {
      this.inFlight = true;
      try {
        const res = await this.processBatch({ workerId, batchSize: config.batchSize });
        // Nếu vừa xử lý đủ một lô đầy, poll tiếp nhanh hơn để xả backlog nhanh.
        if (res.claimedCount >= config.batchSize) {
          nextDelay = Math.min(200, config.pollIntervalMs);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Outbox relay poll tick failed: ${msg}`);
      } finally {
        this.inFlight = false;
      }
    }

    this.scheduleNextTick(workerId, nextDelay);
  }

  /** Claim và gửi 1 lô sự kiện Outbox đến hạn ra Queue/Broker. */
  public async processBatch(
    options: OutboxDispatchBatchOptions = {},
  ): Promise<OutboxDispatchBatchResult> {
    const startedAt = Date.now();
    const config = resolveOutboxRuntimeConfig(this.settingRegistry);
    const workerId = options.workerId?.trim() || this.defaultWorkerId();
    const batchSize = options.batchSize ?? config.batchSize;
    const now = options.now ?? new Date();

    const claimed = await this.outboxRepo.claimNextBatch(
      workerId,
      batchSize,
      config.leaseTimeoutMs,
      now,
    );

    let publishedCount = 0;
    let failedCount = 0;
    let deadLetteredCount = 0;

    for (const row of claimed) {
      const outcome = await this.dispatchSingle(row, workerId, config, now);
      if (outcome === 'published') publishedCount += 1;
      else if (outcome === 'dead_letter') deadLetteredCount += 1;
      else failedCount += 1;
    }

    return {
      workerId,
      claimedCount: claimed.length,
      publishedCount,
      failedCount,
      deadLetteredCount,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  private async dispatchSingle(
    row: OutboxEventEntity,
    workerId: string,
    config: ReturnType<typeof resolveOutboxRuntimeConfig>,
    baseNow: Date,
  ): Promise<'published' | 'failed' | 'dead_letter'> {
    const attemptNumber = (Number(row.attemptCount) || 0) + 1;
    const maxRetries = Math.max(1, Number(row.maxRetries) || config.maxRetries);

    try {
      const domainEvent = this.reconstructDomainEvent(row);
      const headers = this.parseHeaders(row.headersJson);

      await this.transport.dispatch({
        outboxId: Number(row.id),
        event: domainEvent,
        destinationQueue: row.destinationQueue,
        destinationTopic: row.destinationTopic,
        partitionKey: row.partitionKey ?? null,
        headers,
        attemptNumber,
      });

      const publishedAt = new Date(Math.max(Date.now(), baseNow.getTime()));
      await this.outboxRepo.markPublished(Number(row.id), workerId, attemptNumber, publishedAt);
      this.dispatchCounter?.inc({ result: 'published' });

      if (row.createdAt) {
        const lagSec = Math.max(0, (publishedAt.getTime() - row.createdAt.getTime()) / 1000);
        this.publishLagHistogram?.observe(lagSec);
      }

      return 'published';
    } catch (err) {
      const classified = classifyOutboxDispatchError(err);
      const attemptedAt = new Date(Math.max(Date.now(), baseNow.getTime()));
      const exhausted = classified.permanent || attemptNumber >= maxRetries;

      if (exhausted) {
        const reason = classified.permanent
          ? `Permanent dispatch error (${classified.code}): ${classified.message}`
          : `Max retries exhausted (${attemptNumber}/${maxRetries}): ${classified.message}`;

        await this.outboxRepo.markDeadLetter({
          id: Number(row.id),
          workerId,
          attemptCount: attemptNumber,
          attemptedAt,
          errorCode: classified.code,
          errorMessage: classified.message,
          reason,
        });
        this.dispatchCounter?.inc({ result: 'dead_letter' });
        this.logger.error(
          `[Outbox][DEAD_LETTER] id=${row.id} eventId=${row.eventId} type=${row.eventType} attempts=${attemptNumber}/${maxRetries} code=${classified.code}: ${classified.message}`,
        );
        return 'dead_letter';
      }

      const delayMs = computeOutboxRetryDelayMs(attemptNumber, config);
      const nextAttemptAt = new Date(attemptedAt.getTime() + delayMs);
      await this.outboxRepo.markFailed({
        id: Number(row.id),
        workerId,
        attemptCount: attemptNumber,
        nextAttemptAt,
        attemptedAt,
        errorCode: classified.code,
        errorMessage: classified.message,
      });
      this.dispatchCounter?.inc({ result: 'failed' });
      this.logger.warn(
        `[Outbox][RETRY_SCHEDULED] id=${row.id} eventId=${row.eventId} type=${row.eventType} attempt=${attemptNumber}/${maxRetries} nextIn=${delayMs}ms code=${classified.code}: ${classified.message}`,
      );
      return 'failed';
    }
  }

  /** Đọc metrics độ trễ & tồn đọng hiện tại, đồng bộ sang Prometheus gauges. */
  public async getMetrics(now: Date = new Date()): Promise<OutboxMetricsSnapshot> {
    const config = resolveOutboxRuntimeConfig(this.settingRegistry);
    const raw = await this.outboxRepo.getRawMetrics(now);
    const snapshot = evaluateOutboxLagSnapshot(raw, config, now);

    this.backlogGauge?.set({ status: 'pending' }, snapshot.pendingCount);
    this.backlogGauge?.set({ status: 'processing' }, snapshot.processingCount);
    this.backlogGauge?.set({ status: 'failed' }, snapshot.failedCount);
    this.backlogGauge?.set({ status: 'dead_letter' }, snapshot.deadLetterCount);
    this.oldestPendingAgeGauge?.set(snapshot.oldestPendingAgeSec ?? 0);

    return snapshot;
  }

  /** Kiểm tra độ trễ/tồn đọng Outbox và gửi cảnh báo quản trị nếu vượt ngưỡng (có cooldown). */
  public async checkLagAndAlert(now: Date = new Date()): Promise<OutboxLagAlertCheckResult> {
    const config = resolveOutboxRuntimeConfig(this.settingRegistry);
    const metrics = await this.getMetrics(now);

    if (metrics.lagStatus === OUTBOX_LAG_STATUS.HEALTHY || metrics.alertReasons.length === 0) {
      return {
        metrics,
        alerted: false,
        skippedByCooldown: false,
        reasons: [],
      };
    }

    const acquired = await this.acquireAlertCooldown(config.alertCooldownSec, now);
    if (!acquired) {
      return {
        metrics,
        alerted: false,
        skippedByCooldown: true,
        reasons: metrics.alertReasons,
      };
    }

    this.logger.warn(
      `[Outbox][LAG_ALERT][${metrics.lagStatus}] pending=${metrics.pendingCount} failed=${metrics.failedCount} dlq=${metrics.deadLetterCount} oldestAgeSec=${metrics.oldestPendingAgeSec ?? 'n/a'} reasons=${metrics.alertReasons.join('; ')}`,
    );

    if (this.notificationsPublicService) {
      const channels = config.alertChannels.filter(
        (ch): ch is NotificationChannelName =>
          ch === 'IN_APP' || ch === 'EMAIL' || ch === 'SMS' || ch === 'PUSH' || ch === 'DOCUMENT',
      );
      try {
        await this.notificationsPublicService.dispatch({
          title: `[Outbox ${metrics.lagStatus}] Cảnh báo tồn đọng / Dead Letter sự kiện`,
          content: `Outbox đang có ${metrics.pendingCount} Pending, ${metrics.failedCount} Failed, ${metrics.deadLetterCount} Dead Letter (sự kiện lâu nhất: ${metrics.oldestPendingAgeSec ?? 0}s). Nguyên nhân: ${metrics.alertReasons.join('; ')}.`,
          category: NOTIFICATION_CATEGORY.SYSTEM,
          priority:
            metrics.lagStatus === OUTBOX_LAG_STATUS.CRITICAL
              ? NOTIFICATION_PRIORITY.URGENT
              : NOTIFICATION_PRIORITY.HIGH,
          targetType: NOTIFICATION_TARGET_TYPE.ROLE,
          roleCodes: [...config.alertAdminRoles],
          channels: channels.length > 0 ? channels : ['IN_APP', 'EMAIL'],
          actionUrl: '/outbox',
          referenceModule: 'outbox',
          referenceType: 'outbox_lag_alert',
          referenceId: metrics.lagStatus,
          idempotencyKey: `outbox:lag-alert:${metrics.lagStatus}:${Math.floor(now.getTime() / (config.alertCooldownSec * 1000))}`,
          metadata: {
            lagStatus: metrics.lagStatus,
            pendingCount: metrics.pendingCount,
            failedCount: metrics.failedCount,
            deadLetterCount: metrics.deadLetterCount,
            oldestPendingAgeSec: metrics.oldestPendingAgeSec,
            reasons: metrics.alertReasons,
          },
          forceDeliver: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to dispatch outbox lag alert notification: ${msg}`);
      }
    }

    return {
      metrics,
      alerted: true,
      skippedByCooldown: false,
      reasons: metrics.alertReasons,
    };
  }

  private async acquireAlertCooldown(cooldownSec: number, now: Date): Promise<boolean> {
    if (this.redis?.isReady()) {
      try {
        const res = await this.redis.client.set(
          ALERT_COOLDOWN_REDIS_KEY,
          now.toISOString(),
          'EX',
          cooldownSec,
          'NX',
        );
        return res === 'OK';
      } catch {
        // fallback local memory
      }
    }

    const nowMs = now.getTime();
    if (nowMs - this.lastAlertSentAtMs < cooldownSec * 1000) {
      return false;
    }
    this.lastAlertSentAtMs = nowMs;
    return true;
  }

  private reconstructDomainEvent(row: OutboxEventEntity): DomainEvent {
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(row.payloadJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Outbox payload_json must be a JSON object');
      }
      payload = parsed as Record<string, unknown>;
    } catch (err) {
      const invalid = new Error(
        `Invalid outbox payload_json for event #${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      ) as Error & { code?: string; permanent?: boolean };
      invalid.code = 'INVALID_OUTBOX_PAYLOAD';
      invalid.permanent = true;
      throw invalid;
    }

    const rawMeta = safeJsonParseObject(row.metadataJson) ?? {};
    const occurredAt =
      row.occurredAt instanceof Date
        ? row.occurredAt.toISOString()
        : new Date(row.occurredAt).toISOString();

    return Object.freeze({
      id: row.eventId,
      type: row.eventType,
      version: Number(row.eventVersion) || 1,
      occurredAt,
      aggregateId: row.aggregateId ?? null,
      aggregateType: row.aggregateType ?? null,
      payload: Object.freeze(payload),
      metadata: Object.freeze({
        requestId:
          row.requestId ?? (typeof rawMeta['requestId'] === 'string' ? rawMeta['requestId'] : null),
        correlationId:
          row.correlationId ??
          (typeof rawMeta['correlationId'] === 'string' ? rawMeta['correlationId'] : null),
        causationId:
          row.causationId ??
          (typeof rawMeta['causationId'] === 'string' ? rawMeta['causationId'] : null),
        actorId:
          row.actorId ??
          (typeof rawMeta['actorId'] === 'string' || typeof rawMeta['actorId'] === 'number'
            ? rawMeta['actorId']
            : null),
        sourceModule: row.sourceModule,
        dotName: row.dotName,
      }),
    });
  }

  private parseHeaders(headersJson: string | null): Record<string, string> {
    if (!headersJson) return {};
    const parsed = safeJsonParseObject(headersJson) ?? {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }

  private defaultWorkerId(): string {
    const base = this.identity?.id ?? `worker-${process.pid}`;
    return `${base}:${randomUUID().slice(0, 8)}`;
  }
}
