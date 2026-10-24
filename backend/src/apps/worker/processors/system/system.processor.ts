import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { JOB_LOCK_DURATION_MS, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

/**
 * Consumer của queue `system.events` (`@nestjs/bullmq`). Mỗi job chạy trong correlation của envelope để lần theo
 * log; đếm `messages_consumed_total{queue,channel,result}` + histogram thời gian xử lý.
 */
@Processor(QUEUES.SYSTEM_EVENTS, { lockDuration: JOB_LOCK_DURATION_MS, name: 'worker' })
export class SystemProcessor extends BaseQueueProcessor {
  protected readonly logger = new Logger(SystemProcessor.name);
  public readonly queueName = QUEUES.SYSTEM_EVENTS;

  constructor(
    config: CoreConfigService,
    metrics: MetricsRegistryService,
    @Optional() progressTracker?: JobProgressTrackerService,
  ) {
    super(config, metrics, progressTracker);
  }

  public get concurrency(): number {
    return this.config.runtime.worker.eventsConcurrency;
  }

  /** Logic nghiệp vụ theo topic của sự kiện hệ thống */
  protected async handle(envelope: MessageEnvelope, _job: Job): Promise<unknown> {
    this.logger.log(
      `Processing message "${envelope.topic}" (${envelope.id}) from ${envelope.producer ?? 'unknown'}`,
    );
    return { handled: true, topic: envelope.topic, id: envelope.id };
  }
}
