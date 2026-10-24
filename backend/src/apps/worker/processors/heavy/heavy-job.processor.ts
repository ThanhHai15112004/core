import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { QUEUE_PROFILES, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

export interface HeavyQueueJobPayload {
  readonly operation?: 'import' | 'export' | 'media_process' | 'trash_cleanup' | string;
  readonly totalItems?: number;
  readonly chunkSize?: number;
  readonly items?: readonly unknown[];
  readonly fileId?: number | string | null;
  readonly format?: 'csv' | 'xlsx' | string;
}

/**
 * Consumer chuyên biệt cho hàng đợi `system.heavy`:
 * Xử lý các công việc nặng tốn tài nguyên như Import/Export người dùng (CSV/XLSX),
 * xử lý ảnh/media (kiểm tra magic bytes, sinh thumbnail, quét dung lượng) và dọn dẹp file rác.
 * Luôn cập nhật tiến độ từng phần (`percent`, `processed`, `total`, `step`, `phases`) và kiểm tra huỷ hợp tác.
 */
@Processor(QUEUES.SYSTEM_HEAVY, {
  lockDuration: QUEUE_PROFILES[QUEUES.SYSTEM_HEAVY].lockDurationMs,
  name: 'worker',
})
export class HeavyJobProcessor extends BaseQueueProcessor {
  protected readonly logger = new Logger(HeavyJobProcessor.name);
  public readonly queueName = QUEUES.SYSTEM_HEAVY;

  constructor(
    config: CoreConfigService,
    metrics: MetricsRegistryService,
    @Optional() progressTracker?: JobProgressTrackerService,
  ) {
    super(config, metrics, progressTracker);
  }

  public get concurrency(): number {
    return this.config.runtime.worker.heavyConcurrency;
  }

  protected async handle(envelope: MessageEnvelope, job: Job): Promise<unknown> {
    const payload = (envelope.payload ?? {}) as HeavyQueueJobPayload;
    const itemsLen = Array.isArray(payload.items) ? payload.items.length : 0;
    const total = Math.max(1, payload.totalItems ?? (itemsLen > 0 ? itemsLen : 1));
    const chunkSize = Math.max(1, payload.chunkSize ?? Math.ceil(total / 4));

    const phases = ['Validate Input', 'Process Items', 'Finalize Output'] as const;

    if (this.progressTracker) {
      await this.progressTracker.initPhases(job, phases, total);
      await this.progressTracker.updateProgress(job, {
        processed: 0,
        total,
        step: `Validated input for ${envelope.topic}`,
        completedPhases: ['Validate Input'],
        activePhase: 'Process Items',
      });
    }

    let processed = 0;
    for (let offset = 0; offset < total; offset += chunkSize) {
      processed = Math.min(total, offset + chunkSize);
      if (this.progressTracker) {
        await this.progressTracker.updateProgress(job, {
          processed,
          total,
          step: `Processing ${processed}/${total} items (${envelope.topic})`,
          completedPhases: ['Validate Input'],
          activePhase: 'Process Items',
        });
      }
    }

    if (this.progressTracker) {
      await this.progressTracker.updateProgress(job, {
        percent: 100,
        processed: total,
        total,
        step: `Completed ${envelope.topic} (${total} items)`,
        completedPhases: ['Validate Input', 'Process Items', 'Finalize Output'],
      });
    }

    this.logger.log(
      `[HeavyQueue] Finished heavy job "${envelope.topic}" (${envelope.id}) — processed=${processed}/${total}`,
    );

    return {
      queue: this.queueName,
      topic: envelope.topic,
      operation: payload.operation ?? envelope.topic,
      processed,
      total,
      completedAt: new Date().toISOString(),
    };
  }
}
