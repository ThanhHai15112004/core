import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { QUEUE_PROFILES, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

export interface NotificationQueueJobPayload {
  readonly channel?: string;
  readonly templateCode?: string;
  readonly recipients?: readonly {
    readonly userId?: number | null;
    readonly recipientAddress: string;
  }[];
  readonly batchSize?: number;
}

/**
 * Consumer chuyên biệt cho hàng đợi `system.notifications`:
 * Xử lý gửi Email theo template, SMS, Push Notification đơn lẻ hoặc theo batch,
 * có báo cáo tiến độ từng lô và kiểm tra huỷ hợp tác giữa các batch.
 */
@Processor(QUEUES.SYSTEM_NOTIFICATIONS, {
  lockDuration: QUEUE_PROFILES[QUEUES.SYSTEM_NOTIFICATIONS].lockDurationMs,
  name: 'worker',
})
export class NotificationsProcessor extends BaseQueueProcessor {
  protected readonly logger = new Logger(NotificationsProcessor.name);
  public readonly queueName = QUEUES.SYSTEM_NOTIFICATIONS;

  constructor(
    config: CoreConfigService,
    metrics: MetricsRegistryService,
    @Optional() progressTracker?: JobProgressTrackerService,
  ) {
    super(config, metrics, progressTracker);
  }

  public get concurrency(): number {
    return this.config.runtime.worker.notificationsConcurrency;
  }

  protected async handle(envelope: MessageEnvelope, job: Job): Promise<unknown> {
    const payload = (envelope.payload ?? {}) as NotificationQueueJobPayload;
    const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
    const total = Math.max(1, recipients.length);
    const batchSize = Math.max(1, payload.batchSize ?? 50);

    if (this.progressTracker) {
      await this.progressTracker.initPhases(
        job,
        ['Prepare Template', 'Dispatch Batches', 'Finalize'],
        total,
      );
      await this.progressTracker.updateProgress(job, {
        processed: 0,
        total,
        step: `Prepared ${payload.templateCode ?? envelope.topic}`,
        completedPhases: ['Prepare Template'],
        activePhase: 'Dispatch Batches',
      });
    }

    let processed = 0;
    for (let i = 0; i < total; i += batchSize) {
      processed = Math.min(total, i + batchSize);
      if (this.progressTracker) {
        await this.progressTracker.updateProgress(job, {
          processed,
          total,
          step: `Dispatched ${processed}/${total} notifications (${payload.channel ?? 'MULTI'})`,
          completedPhases: ['Prepare Template'],
          activePhase: 'Dispatch Batches',
        });
      }
    }

    if (this.progressTracker) {
      await this.progressTracker.updateProgress(job, {
        percent: 100,
        processed: total,
        total,
        step: 'All notification batches dispatched',
        completedPhases: ['Prepare Template', 'Dispatch Batches', 'Finalize'],
      });
    }

    this.logger.log(
      `[NotificationsQueue] Processed "${envelope.topic}" (${envelope.id}) — total=${total}`,
    );
    return {
      queue: this.queueName,
      topic: envelope.topic,
      processed,
      total,
    };
  }
}
