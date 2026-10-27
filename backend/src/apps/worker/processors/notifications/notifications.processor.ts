import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import {
  JobError,
  QUEUE_PROFILES,
  QUEUES,
  type MessageEnvelope,
} from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_ERROR_TYPE,
  NotificationChannelAdapterRegistry,
  type NotificationChannelCode,
  type INotificationChannelProviderAdapter,
} from '@modules/notifications/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

export interface NotificationQueueRecipient {
  readonly userId?: number | null;
  readonly recipientAddress: string;
}

export interface NotificationQueueJobPayload {
  readonly channel?: string;
  readonly providerCode?: string;
  readonly templateCode?: string;
  readonly subject?: string | null;
  readonly body?: string;
  readonly htmlBody?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly recipients?: readonly NotificationQueueRecipient[];
  readonly batchSize?: number;
}

interface NotificationBatchDispatchResult {
  readonly processed: number;
  readonly deliveredCount: number;
  readonly failedCount: number;
  readonly providerMessageIds: string[];
  readonly firstTransientError: string | null;
  readonly firstPermanentError: string | null;
}

const NOTIFICATION_JOB_PHASES = ['Prepare Template', 'Dispatch Batches', 'Finalize'] as const;

function resolveNotificationChannelCode(channel?: string): NotificationChannelCode {
  const upper = (channel ?? 'EMAIL').trim().toUpperCase();
  if (upper === 'SMS' || upper === '3') return NOTIFICATION_CHANNEL.SMS;
  if (upper === 'PUSH' || upper === '4') return NOTIFICATION_CHANNEL.PUSH;
  return NOTIFICATION_CHANNEL.EMAIL;
}

/**
 * Consumer chuyên biệt cho hàng đợi `system.notifications`:
 * Xử lý gửi Email theo template, SMS, Push Notification đơn lẻ hoặc theo batch qua `NotificationChannelAdapterRegistry`,
 * có báo cáo tiến độ từng lô và kiểm tra huỷ hợp tác giữa các batch.
 */
@Processor(QUEUES.SYSTEM_NOTIFICATIONS, {
  lockDuration: QUEUE_PROFILES[QUEUES.SYSTEM_NOTIFICATIONS].lockDurationMs,
  name: 'worker',
})
export class NotificationsProcessor extends BaseQueueProcessor {
  protected readonly logger = new Logger(NotificationsProcessor.name);
  public readonly queueName = QUEUES.SYSTEM_NOTIFICATIONS;
  private readonly adapterRegistry: NotificationChannelAdapterRegistry;

  constructor(
    config: CoreConfigService,
    metrics: MetricsRegistryService,
    @Optional() progressTracker?: JobProgressTrackerService,
    @Optional() adapterRegistry?: NotificationChannelAdapterRegistry,
  ) {
    super(config, metrics, progressTracker);
    this.adapterRegistry = adapterRegistry ?? new NotificationChannelAdapterRegistry();
  }

  public get concurrency(): number {
    return this.config.runtime.worker.notificationsConcurrency;
  }

  /** Điều phối gửi thông báo: khởi tạo phase -> gửi từng batch -> kiểm tra lỗi -> hoàn tất */
  protected async handle(envelope: MessageEnvelope, job: Job): Promise<unknown> {
    const payload = (envelope.payload ?? {}) as NotificationQueueJobPayload;
    const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
    const total = Math.max(1, recipients.length);
    const batchSize = Math.max(1, payload.batchSize ?? 50);

    await this.initJobPhases(
      job,
      NOTIFICATION_JOB_PHASES,
      total,
      `Prepared ${payload.templateCode ?? envelope.topic}`,
      ['Prepare Template'],
      'Dispatch Batches',
    );

    const outcome = await this.dispatchNotificationBatches(
      envelope,
      job,
      payload,
      recipients,
      total,
      batchSize,
    );

    this.assertBatchDeliverySuccess(outcome);

    await this.completeJobProgress(
      job,
      total,
      'All notification batches dispatched',
      NOTIFICATION_JOB_PHASES,
    );

    this.logger.log(
      `[NotificationsQueue] Processed "${envelope.topic}" (${envelope.id}) — total=${total}, delivered=${outcome.deliveredCount}, failed=${outcome.failedCount}`,
    );

    return {
      queue: this.queueName,
      topic: envelope.topic,
      processed: outcome.processed,
      total,
      deliveredCount: outcome.deliveredCount,
      failedCount: outcome.failedCount,
      providerMessageIds: outcome.providerMessageIds,
    };
  }

  /** Chia danh sách người nhận thành các lô (batch) và gửi tuần tự kèm cập nhật tiến độ */
  private async dispatchNotificationBatches(
    envelope: MessageEnvelope,
    job: Job,
    payload: NotificationQueueJobPayload,
    recipients: readonly NotificationQueueRecipient[],
    total: number,
    batchSize: number,
  ): Promise<NotificationBatchDispatchResult> {
    const channelCode = resolveNotificationChannelCode(payload.channel);
    const adapter = this.adapterRegistry.getAdapter(channelCode);
    const providerCode = (payload.providerCode ?? 'CONSOLE').trim().toUpperCase();

    let processed = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    const providerMessageIds: string[] = [];
    let firstTransientError: string | null = null;
    let firstPermanentError: string | null = null;

    for (let offset = 0; offset < total; offset += batchSize) {
      const batch = recipients.slice(offset, offset + batchSize);
      const batchResult = await this.sendSingleBatch(
        envelope,
        payload,
        batch,
        offset,
        channelCode,
        providerCode,
        adapter,
      );

      deliveredCount += batchResult.deliveredCount;
      failedCount += batchResult.failedCount;
      providerMessageIds.push(...batchResult.providerMessageIds);
      firstTransientError ??= batchResult.firstTransientError;
      firstPermanentError ??= batchResult.firstPermanentError;

      processed = Math.min(total, offset + batchSize);
      await this.reportJobProgress(job, {
        processed,
        total,
        step: `Dispatched ${processed}/${total} notifications (${payload.channel ?? 'MULTI'})`,
        completedPhases: ['Prepare Template'],
        activePhase: 'Dispatch Batches',
      });
    }

    return {
      processed,
      deliveredCount,
      failedCount,
      providerMessageIds,
      firstTransientError,
      firstPermanentError,
    };
  }

  /** Gửi thông báo cho từng người nhận trong 1 batch qua Channel Adapter */
  private async sendSingleBatch(
    envelope: MessageEnvelope,
    payload: NotificationQueueJobPayload,
    batch: readonly NotificationQueueRecipient[],
    batchOffset: number,
    channelCode: NotificationChannelCode,
    providerCode: string,
    adapter?: INotificationChannelProviderAdapter | null,
  ): Promise<Omit<NotificationBatchDispatchResult, 'processed'>> {
    if (!adapter || batch.length === 0) {
      return {
        deliveredCount: batch.length || 1,
        failedCount: 0,
        providerMessageIds: [],
        firstTransientError: null,
        firstPermanentError: null,
      };
    }

    let deliveredCount = 0;
    let failedCount = 0;
    const providerMessageIds: string[] = [];
    let firstTransientError: string | null = null;
    let firstPermanentError: string | null = null;

    for (let idx = 0; idx < batch.length; idx++) {
      const recipient = batch[idx]!;
      const sendRes = await adapter.send({
        channel: channelCode,
        providerCode,
        destination: recipient.recipientAddress,
        subject: payload.subject ?? payload.templateCode ?? envelope.topic,
        body:
          payload.body ??
          `Notification [${payload.templateCode ?? envelope.topic}] for ${recipient.recipientAddress}`,
        htmlBody: payload.htmlBody ?? null,
        idempotencyKey: `${envelope.id}:${recipient.userId ?? batchOffset + idx}:${recipient.recipientAddress}`,
        metadata: payload.metadata ?? null,
      });

      if (sendRes.success) {
        deliveredCount++;
        if (sendRes.providerMessageId) {
          providerMessageIds.push(sendRes.providerMessageId);
        }
        continue;
      }

      failedCount++;
      const isTransient =
        sendRes.errorType === NOTIFICATION_ERROR_TYPE.TRANSIENT ||
        sendRes.errorType === NOTIFICATION_ERROR_TYPE.RATE_LIMITED;

      if (isTransient) {
        firstTransientError ??=
          sendRes.errorMessage ?? 'Upstream notification provider temporary failure';
      } else {
        firstPermanentError ??= sendRes.errorMessage ?? 'Permanent notification delivery failure';
      }
    }

    return {
      deliveredCount,
      failedCount,
      providerMessageIds,
      firstTransientError,
      firstPermanentError,
    };
  }

  /** Kiểm tra lỗi sau khi gửi batch: ném lỗi Retryable nếu lỗi mạng, hoặc Unrecoverable nếu hỏng toàn bộ */
  private assertBatchDeliverySuccess(outcome: NotificationBatchDispatchResult): void {
    if (outcome.firstTransientError) {
      throw new JobError('UpstreamTimeout', outcome.firstTransientError, {
        retryable: true,
        dependency: 'http',
      });
    }

    if (outcome.firstPermanentError && outcome.deliveredCount === 0) {
      throw new JobError('ValidationError', outcome.firstPermanentError, {
        retryable: false,
        dependency: 'http',
      });
    }
  }
}
