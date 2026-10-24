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
  type NotificationChannelProviderAdapter,
} from '@modules/notifications/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

export interface CriticalQueueRecipient {
  readonly userId?: number | null;
  readonly recipientAddress: string;
}

export interface CriticalQueueJobPayload {
  readonly channel?: string;
  readonly destination?: string;
  readonly code?: string;
  readonly templateCode?: string;
  readonly recipients?: readonly CriticalQueueRecipient[];
  readonly metadata?: Record<string, unknown> | null;
}

interface CriticalDeliveryResult {
  readonly deliveredCount: number;
  readonly providerMessageId: string | null;
}

/**
 * Consumer chuyên biệt cho hàng đợi `system.critical`:
 * Xử lý tức thời các công việc ưu tiên cao nhất như gửi mã OTP xác thực, cảnh báo bảo mật,
 * khoá/thu hồi phiên đăng nhập khẩn cấp.
 */
@Processor(QUEUES.SYSTEM_CRITICAL, {
  lockDuration: QUEUE_PROFILES[QUEUES.SYSTEM_CRITICAL].lockDurationMs,
  name: 'worker',
})
export class CriticalProcessor extends BaseQueueProcessor {
  protected readonly logger = new Logger(CriticalProcessor.name);
  public readonly queueName = QUEUES.SYSTEM_CRITICAL;
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
    return this.config.runtime.worker.criticalConcurrency;
  }

  /** Điều phối thực thi job khẩn cấp: báo cáo tiến độ -> xử lý theo topic -> hoàn tất */
  protected async handle(envelope: MessageEnvelope, job: Job): Promise<unknown> {
    const payload = (envelope.payload ?? {}) as CriticalQueueJobPayload;

    await this.reportJobProgress(job, {
      percent: 50,
      processed: 1,
      total: 1,
      step: `Executing critical task: ${envelope.topic}`,
    });

    const outcome = await this.dispatchCriticalTopic(envelope, payload);

    this.logger.log(
      `[CriticalQueue] Executed high-priority job "${envelope.topic}" (${envelope.id})`,
    );

    await this.completeJobProgress(job, 1, 'Completed');

    return {
      queue: this.queueName,
      topic: envelope.topic,
      deliveredCount: outcome.deliveredCount,
      providerMessageId: outcome.providerMessageId,
      completedAt: new Date().toISOString(),
    };
  }

  /** Phân nhánh xử lý các tác vụ khẩn cấp (OTP, Password Reset, Security Alert) */
  private async dispatchCriticalTopic(
    envelope: MessageEnvelope,
    payload: CriticalQueueJobPayload,
  ): Promise<CriticalDeliveryResult> {
    const recipients = this.resolveRecipients(payload);
    if (recipients.length === 0) {
      return { deliveredCount: 0, providerMessageId: null };
    }

    const channelCode = this.resolveChannelCode(payload.channel);
    const adapter = this.adapterRegistry.getAdapter(channelCode);
    if (!adapter) {
      return { deliveredCount: 0, providerMessageId: null };
    }

    return this.deliverCriticalMessages(envelope, payload, recipients, channelCode, adapter);
  }

  /** Gửi tức thời thông điệp khẩn cấp tới từng người nhận và phân loại lỗi Retryable / Permanent */
  private async deliverCriticalMessages(
    envelope: MessageEnvelope,
    payload: CriticalQueueJobPayload,
    recipients: readonly CriticalQueueRecipient[],
    channelCode: NotificationChannelCode,
    adapter: NotificationChannelProviderAdapter,
  ): Promise<CriticalDeliveryResult> {
    let deliveredCount = 0;
    let providerMessageId: string | null = null;

    for (const rec of recipients) {
      const res = await adapter.send({
        channel: channelCode,
        providerCode: 'CONSOLE',
        destination: rec.recipientAddress,
        subject: `[CRITICAL] ${payload.templateCode ?? envelope.topic}`,
        body: payload.code
          ? `Verification code: ${payload.code}`
          : `Critical security alert: ${envelope.topic}`,
        idempotencyKey: `${envelope.id}:${rec.recipientAddress}`,
        metadata: payload.metadata ?? null,
      });

      if (!res.success) {
        const retryable =
          res.errorType === NOTIFICATION_ERROR_TYPE.TRANSIENT ||
          res.errorType === NOTIFICATION_ERROR_TYPE.RATE_LIMITED;
        throw new JobError(
          retryable ? 'UpstreamTimeout' : 'ValidationError',
          res.errorMessage ?? 'Critical notification delivery failed',
          { retryable, dependency: 'http' },
        );
      }

      deliveredCount++;
      providerMessageId = res.providerMessageId;
    }

    return { deliveredCount, providerMessageId };
  }

  /** Chuẩn hóa danh sách người nhận từ `recipients` hoặc `destination` đơn lẻ */
  private resolveRecipients(payload: CriticalQueueJobPayload): readonly CriticalQueueRecipient[] {
    if (Array.isArray(payload.recipients) && payload.recipients.length > 0) {
      return payload.recipients;
    }
    if (payload.destination) {
      return [{ recipientAddress: payload.destination }];
    }
    return [];
  }

  /** Ánh xạ tên kênh truyền vào sang mã kênh chuẩn `NOTIFICATION_CHANNEL` */
  private resolveChannelCode(channel?: string): NotificationChannelCode {
    const channelUpper = (channel ?? 'EMAIL').trim().toUpperCase();
    if (channelUpper === 'SMS') return NOTIFICATION_CHANNEL.SMS;
    if (channelUpper === 'PUSH') return NOTIFICATION_CHANNEL.PUSH;
    return NOTIFICATION_CHANNEL.EMAIL;
  }
}
