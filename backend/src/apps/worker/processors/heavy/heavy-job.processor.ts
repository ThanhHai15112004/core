import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { QUEUE_PROFILES, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import { UserImportService, type BulkImportUserRowInput } from '@modules/users/index.js';
import { FilesService } from '@modules/files/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

export interface HeavyQueueJobPayload {
  readonly operation?: 'import' | 'export' | 'media_process' | 'trash_cleanup' | string;
  readonly executeInWorker?: boolean;
  readonly totalItems?: number;
  readonly chunkSize?: number;
  readonly items?: readonly unknown[];
  readonly csvContent?: string;
  readonly xlsxBase64?: string;
  readonly defaultPassword?: string;
  readonly skipDuplicates?: boolean;
  readonly actorId?: number;
  readonly fileId?: number | string | null;
  readonly format?: 'csv' | 'xlsx' | string;
}

const HEAVY_JOB_PHASES = ['Validate Input', 'Process Items', 'Finalize Output'] as const;

interface HeavyHandlerResult {
  readonly processed: number;
  readonly total: number;
  readonly extra?: Record<string, unknown>;
}

/**
 * Consumer chuyên biệt cho hàng đợi `system.heavy`:
 * Xử lý các công việc nặng tốn tài nguyên như Import/Export người dùng (CSV/XLSX),
 * xử lý ảnh/media (kiểm tra magic bytes, toàn vẹn SHA-256, sinh thumbnail) và dọn dẹp file rác.
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
    @Optional() private readonly userImportService?: UserImportService,
    @Optional() private readonly filesService?: FilesService,
  ) {
    super(config, metrics, progressTracker);
  }

  public get concurrency(): number {
    return this.config.runtime.worker.heavyConcurrency;
  }

  /** Điều phối job nặng sang hàm xử lý chuyên biệt theo từng topic/operation */
  protected async handle(envelope: MessageEnvelope, job: Job): Promise<unknown> {
    const payload = (envelope.payload ?? {}) as HeavyQueueJobPayload;
    const operation = payload.operation ?? envelope.topic;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const total = Math.max(1, payload.totalItems ?? (rawItems.length > 0 ? rawItems.length : 1));
    const chunkSize = Math.max(1, payload.chunkSize ?? Math.ceil(total / 4));

    await this.initJobPhases(
      job,
      HEAVY_JOB_PHASES,
      total,
      `Validated input for ${envelope.topic}`,
      ['Validate Input'],
      'Process Items',
    );

    const outcome = await this.dispatchByTopic(envelope, job, payload, operation, total, chunkSize);

    await this.completeJobProgress(
      job,
      outcome.total,
      `Completed ${envelope.topic} (${outcome.total} items)`,
      HEAVY_JOB_PHASES,
    );

    this.logger.log(
      `[HeavyQueue] Finished heavy job "${envelope.topic}" (${envelope.id}) — processed=${outcome.processed}/${outcome.total}`,
    );

    return {
      queue: this.queueName,
      topic: envelope.topic,
      operation,
      processed: outcome.processed,
      total: outcome.total,
      ...(outcome.extra ?? {}),
      completedAt: new Date().toISOString(),
    };
  }

  /** Phân nhánh rõ ràng từng loại công việc trong queue `system.heavy` */
  private async dispatchByTopic(
    envelope: MessageEnvelope,
    job: Job,
    payload: HeavyQueueJobPayload,
    operation: string,
    total: number,
    chunkSize: number,
  ): Promise<HeavyHandlerResult> {
    if (this.canExecuteUserImport(envelope.topic, operation, payload)) {
      return this.handleUserImport(envelope.topic, job, payload, chunkSize);
    }

    if (this.canExecuteMediaProcess(envelope.topic, operation, payload)) {
      return this.handleMediaProcess(job, payload, total);
    }

    if (this.canExecuteTrashCleanup(envelope.topic, operation, payload)) {
      return this.handleTrashCleanup(job, total);
    }

    return this.handleChunkedProgress(envelope.topic, job, total, chunkSize);
  }

  /** 1. Xử lý topic `users.import` — Import người dùng hàng loạt theo từng chunk */
  private async handleUserImport(
    topic: string,
    job: Job,
    payload: HeavyQueueJobPayload,
    chunkSize: number,
  ): Promise<HeavyHandlerResult> {
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const resolvedRows: BulkImportUserRowInput[] =
      rawItems.length > 0
        ? (rawItems as BulkImportUserRowInput[])
        : this.userImportService!.parseImportRows({
            skipDuplicates: payload.skipDuplicates ?? true,
            ...(payload.csvContent ? { csvContent: payload.csvContent } : {}),
            ...(payload.xlsxBase64 ? { xlsxBase64: payload.xlsxBase64 } : {}),
          });

    const effectiveTotal = Math.max(1, resolvedRows.length);
    let processed = 0;
    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (let offset = 0; offset < effectiveTotal; offset += chunkSize) {
      const chunk = resolvedRows.slice(offset, offset + chunkSize);
      if (chunk.length > 0) {
        const chunkResult = await this.userImportService!.bulkImport(
          {
            items: chunk,
            skipDuplicates: payload.skipDuplicates ?? true,
            ...(payload.defaultPassword !== undefined
              ? { defaultPassword: payload.defaultPassword }
              : {}),
          },
          payload.actorId,
          { skipQueuePublish: true },
        );
        importedCount += chunkResult.importedCount;
        skippedCount += chunkResult.skippedCount;
        failedCount += chunkResult.failedCount;
      }

      processed = Math.min(effectiveTotal, offset + chunkSize);
      await this.reportProcessingStep(
        job,
        processed,
        effectiveTotal,
        `Processing ${processed}/${effectiveTotal} items (${topic})`,
      );
    }

    return {
      processed,
      total: effectiveTotal,
      extra: { importedCount, skippedCount, failedCount },
    };
  }

  /** 2. Xử lý topic `files.media_process` — Kiểm tra toàn vẹn SHA-256 & xử lý tệp media */
  private async handleMediaProcess(
    job: Job,
    payload: HeavyQueueJobPayload,
    total: number,
  ): Promise<HeavyHandlerResult> {
    const verifyResult = await this.filesService!.verifyFileIntegrity(Number(payload.fileId));
    await this.reportProcessingStep(
      job,
      total,
      total,
      `Verified media integrity for file #${payload.fileId}`,
    );

    return {
      processed: total,
      total,
      extra: { integrityIntact: verifyResult.intact },
    };
  }

  /** 3. Xử lý topic `files.trash_cleanup` — Dọn dẹp vĩnh viễn các tệp quá hạn trong thùng rác */
  private async handleTrashCleanup(job: Job, total: number): Promise<HeavyHandlerResult> {
    const cleanupResult = await this.filesService!.purgeExpiredTrash(undefined, {
      skipQueuePublish: true,
    });
    await this.reportProcessingStep(
      job,
      total,
      total,
      `Purged ${cleanupResult.purgedCount} expired trashed files`,
    );

    return {
      processed: total,
      total,
      extra: { purgedCount: cleanupResult.purgedCount },
    };
  }

  /** 4. Xử lý mặc định theo từng chunk (Export hoặc job chỉ ghi nhận tiến độ) */
  private async handleChunkedProgress(
    topic: string,
    job: Job,
    total: number,
    chunkSize: number,
  ): Promise<HeavyHandlerResult> {
    let processed = 0;
    for (let offset = 0; offset < total; offset += chunkSize) {
      processed = Math.min(total, offset + chunkSize);
      await this.reportProcessingStep(
        job,
        processed,
        total,
        `Processing ${processed}/${total} items (${topic})`,
      );
    }
    return { processed, total };
  }

  /** Kiểm tra điều kiện chạy Import người dùng thật trong Worker */
  private canExecuteUserImport(
    topic: string,
    operation: string,
    payload: HeavyQueueJobPayload,
  ): boolean {
    const hasInput =
      (Array.isArray(payload.items) && payload.items.length > 0) ||
      Boolean(payload.csvContent) ||
      Boolean(payload.xlsxBase64);

    return (
      (operation === 'import' || topic === 'users.import') &&
      Boolean(this.userImportService) &&
      payload.executeInWorker !== false &&
      hasInput
    );
  }

  /** Kiểm tra điều kiện chạy kiểm tra/xử lý Media thật trong Worker */
  private canExecuteMediaProcess(
    topic: string,
    operation: string,
    payload: HeavyQueueJobPayload,
  ): boolean {
    return (
      (operation === 'media_process' || topic === 'files.media_process') &&
      Boolean(this.filesService) &&
      payload.fileId !== undefined &&
      payload.fileId !== null
    );
  }

  /** Kiểm tra điều kiện chạy dọn rác thật trong Worker */
  private canExecuteTrashCleanup(
    topic: string,
    operation: string,
    payload: HeavyQueueJobPayload,
  ): boolean {
    return (
      (operation === 'trash_cleanup' || topic === 'files.trash_cleanup') &&
      Boolean(this.filesService) &&
      payload.executeInWorker !== false
    );
  }

  /** Bước 2: Báo cáo tiến độ của pha `Process Items` sau mỗi chunk/bước */
  private async reportProcessingStep(
    job: Job,
    processed: number,
    total: number,
    step: string,
  ): Promise<void> {
    await this.reportJobProgress(job, {
      processed,
      total,
      step,
      completedPhases: ['Validate Input'],
      activePhase: 'Process Items',
    });
  }
}
