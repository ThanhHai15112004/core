import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { JOB_LOCK_DURATION_MS, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import { FilesService } from '@modules/files/index.js';
import { NotificationChannelsService } from '@modules/notifications/index.js';
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
    @Optional() private readonly filesService?: FilesService,
    @Optional() private readonly notificationChannelsService?: NotificationChannelsService,
  ) {
    super(config, metrics, progressTracker);
  }

  public get concurrency(): number {
    return this.config.runtime.worker.eventsConcurrency;
  }

  /** Điều phối sự kiện hệ thống sang hàm xử lý chuyên biệt theo từng topic */
  protected async handle(envelope: MessageEnvelope, _job: Job): Promise<unknown> {
    this.logger.log(
      `Processing message "${envelope.topic}" (${envelope.id}) from ${envelope.producer ?? 'unknown'}`,
    );

    if (envelope.topic === 'system.maintenance.tick') {
      return this.handleMaintenanceTick(envelope);
    }

    return this.handleGenericSystemEvent(envelope);
  }

  /** 1. Xử lý topic `system.maintenance.tick` — Dọn thùng rác quá hạn & retry các thông báo đến hạn */
  private async handleMaintenanceTick(envelope: MessageEnvelope): Promise<unknown> {
    let purgedTrashCount = 0;
    let retriedDeliveriesCount = 0;

    if (this.filesService) {
      const trashRes = await this.filesService.purgeExpiredTrash(undefined, {
        skipQueuePublish: true,
      });
      purgedTrashCount = trashRes.purgedCount;
    }

    if (this.notificationChannelsService) {
      const retryRes = await this.notificationChannelsService.retryDueDeliveries();
      retriedDeliveriesCount = retryRes.retriedCount;
    }

    return {
      handled: true,
      topic: envelope.topic,
      id: envelope.id,
      purgedTrashCount,
      retriedDeliveriesCount,
    };
  }

  /** 2. Xử lý các sự kiện nội bộ mặc định trên hàng đợi `system.events` */
  private handleGenericSystemEvent(envelope: MessageEnvelope): unknown {
    return {
      handled: true,
      topic: envelope.topic,
      id: envelope.id,
    };
  }
}
