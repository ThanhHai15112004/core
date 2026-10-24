import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { QUEUE_PROFILES, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

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

  constructor(
    config: CoreConfigService,
    metrics: MetricsRegistryService,
    @Optional() progressTracker?: JobProgressTrackerService,
  ) {
    super(config, metrics, progressTracker);
  }

  public get concurrency(): number {
    return this.config.runtime.worker.criticalConcurrency;
  }

  protected async handle(envelope: MessageEnvelope, job: Job): Promise<unknown> {
    if (this.progressTracker) {
      await this.progressTracker.updateProgress(job, {
        percent: 50,
        processed: 1,
        total: 1,
        step: `Executing critical task: ${envelope.topic}`,
      });
    }
    this.logger.log(
      `[CriticalQueue] Executed high-priority job "${envelope.topic}" (${envelope.id})`,
    );
    if (this.progressTracker) {
      await this.progressTracker.updateProgress(job, {
        percent: 100,
        processed: 1,
        total: 1,
        step: 'Completed',
      });
    }
    return {
      queue: this.queueName,
      topic: envelope.topic,
      completedAt: new Date().toISOString(),
    };
  }
}
