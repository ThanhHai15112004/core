import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import {
  defaultExportRegistry,
  defaultImportRegistry,
  defaultReportRegistry,
  type ImportCellIssue,
  type ImportDuplicateStrategy,
} from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { QUEUE_PROFILES, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  UserExportService,
  UserImportService,
  UserReportService,
  type BulkImportUserRowInput,
  type ListUsersQuery,
  type RunUserReportRequest,
} from '@modules/users/index.js';
import { FilesService } from '@modules/files/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

export interface HeavyQueueJobPayload {
  readonly operation?: 'import' | 'export' | 'report' | 'media_process' | 'trash_cleanup' | string;
  readonly executeInWorker?: boolean;
  readonly totalItems?: number;
  readonly chunkSize?: number;
  readonly items?: readonly unknown[];
  readonly csvContent?: string;
  readonly xlsxBase64?: string;
  readonly defaultPassword?: string;
  readonly skipDuplicates?: boolean;
  readonly duplicateStrategy?: ImportDuplicateStrategy;
  readonly columnMapping?: Record<string, string | number>;
  readonly fileName?: string;
  readonly historyId?: number;
  readonly actorId?: number;
  readonly actor?: UserIdentity;
  readonly query?: Partial<ListUsersQuery>;
  readonly reportCode?: string;
  readonly request?: Partial<RunUserReportRequest>;
  readonly filters?: Readonly<Record<string, unknown>>;
  readonly notifyOnComplete?: boolean;
  readonly fileId?: number | string | null;
  readonly format?: 'csv' | 'xlsx' | 'pdf' | string;
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
    @Optional() private readonly userExportService?: UserExportService,
    @Optional() private readonly userReportService?: UserReportService,
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

    if (this.canExecuteUserExport(envelope.topic, operation, payload)) {
      return this.handleUserExport(envelope.topic, envelope.id, job, payload);
    }

    if (this.canExecuteUserReport(envelope.topic, operation, payload)) {
      return this.handleUserReport(envelope.topic, envelope.id, job, payload);
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
            ...(payload.duplicateStrategy ? { duplicateStrategy: payload.duplicateStrategy } : {}),
            ...(payload.columnMapping ? { columnMapping: payload.columnMapping } : {}),
            ...(payload.csvContent ? { csvContent: payload.csvContent } : {}),
            ...(payload.xlsxBase64 ? { xlsxBase64: payload.xlsxBase64 } : {}),
          });

    const effectiveTotal = Math.max(1, resolvedRows.length);
    const historyRef = payload.historyId ?? String(job.id ?? '');
    let processed = 0;
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const accumulatedErrors: ImportCellIssue[] = [];

    for (let offset = 0; offset < effectiveTotal; offset += chunkSize) {
      const chunk = resolvedRows.slice(offset, offset + chunkSize);
      if (chunk.length > 0) {
        const chunkResult = await this.userImportService!.bulkImport(
          {
            items: chunk,
            skipDuplicates: payload.skipDuplicates ?? true,
            ...(payload.duplicateStrategy ? { duplicateStrategy: payload.duplicateStrategy } : {}),
            ...(payload.defaultPassword !== undefined
              ? { defaultPassword: payload.defaultPassword }
              : {}),
          },
          payload.actorId,
          { skipQueuePublish: true, skipHistoryRecord: true },
        );
        importedCount += chunkResult.importedCount;
        updatedCount += chunkResult.updatedCount ?? 0;
        skippedCount += chunkResult.skippedCount;
        failedCount += chunkResult.failedCount;
        for (const errItem of chunkResult.errors) {
          accumulatedErrors.push({
            row: offset + errItem.row,
            sheetRowNumber: offset + (errItem.sheetRowNumber ?? errItem.row + 1),
            column: errItem.column ?? errItem.field ?? null,
            columnLetter: errItem.columnLetter ?? null,
            field: errItem.field ?? null,
            code: errItem.code ?? 'VALIDATION_ERROR',
            value: errItem.value,
            message: errItem.message,
          });
        }
      }

      processed = Math.min(effectiveTotal, offset + chunkSize);
      const remainingRows = Math.max(0, effectiveTotal - processed);
      const successCount = importedCount + updatedCount;
      await this.reportProcessingStep(
        job,
        processed,
        effectiveTotal,
        `Processing ${processed}/${effectiveTotal} items (${topic})`,
        {
          remaining: remainingRows,
          successCount,
          createdCount: importedCount,
          updatedCount,
          skippedCount,
          failedCount,
        },
      );
      if (historyRef) {
        defaultImportRegistry.updateImportHistory(historyRef, {
          status: processed >= effectiveTotal ? 'COMPLETED' : 'PROCESSING',
          totalRows: resolvedRows.length,
          processedRows: Math.min(resolvedRows.length, processed),
          createdCount: importedCount,
          updatedCount,
          skippedCount,
          failedCount,
          errors: accumulatedErrors,
        });
      }
    }

    const remainingRows = 0;
    const successCount = importedCount + updatedCount;
    return {
      processed,
      total: effectiveTotal,
      extra: {
        importedCount,
        updatedCount,
        successCount,
        skippedCount,
        failedCount,
        remainingCount: remainingRows,
      },
    };
  }

  /** 2. Xử lý topic `users.export` — Xuất danh sách người dùng lớn chạy nền qua Queue (Mục 8.3.4 & 8.3.5) */
  private async handleUserExport(
    topic: string,
    envelopeId: string,
    job: Job,
    payload: HeavyQueueJobPayload,
  ): Promise<HeavyHandlerResult> {
    const effectiveJobId = String(job.id ?? envelopeId);
    const exportQuery: ListUsersQuery = {
      sortBy: 'id',
      sortOrder: 'ASC',
      ...(payload.query ?? {}),
      ...(payload.format === 'csv' || payload.format === 'xlsx' || payload.format === 'pdf'
        ? { format: payload.format }
        : {}),
      async: false,
      notifyOnComplete: payload.notifyOnComplete ?? true,
    };

    const effectiveActor: UserIdentity | undefined =
      payload.actor ??
      (payload.actorId !== undefined
        ? {
            id: payload.actorId,
            roles: [],
            permissions: ['users.export'],
          }
        : undefined);

    const exportResult = await this.userExportService!.exportUsersCsv(exportQuery, effectiveActor, {
      skipQueuePublish: true,
      ...(payload.historyId !== undefined ? { existingHistoryId: payload.historyId } : {}),
      jobId: effectiveJobId,
      forceNotify: payload.notifyOnComplete !== false,
    });

    const effectiveTotal = Math.max(1, exportResult.totalExported);
    await this.reportProcessingStep(
      job,
      effectiveTotal,
      effectiveTotal,
      `Exported ${exportResult.totalExported} items (${topic})`,
      {
        remaining: 0,
        successCount: exportResult.totalExported,
      },
    );

    return {
      processed: effectiveTotal,
      total: effectiveTotal,
      extra: {
        fileName: exportResult.fileName,
        format: exportResult.format,
        totalExported: exportResult.totalExported,
        historyId: exportResult.historyId,
        downloadToken: exportResult.downloadToken,
        downloadUrl: exportResult.downloadUrl,
        expiresAt: exportResult.expiresAt,
        notifiedAt: exportResult.notifiedAt,
      },
    };
  }

  /** 2.5. Xử lý topic `users.report` — Chạy báo cáo nặng chạy nền qua Queue (Mục 8.4.4 & 8.4.6) */
  private async handleUserReport(
    topic: string,
    envelopeId: string,
    job: Job,
    payload: HeavyQueueJobPayload,
  ): Promise<HeavyHandlerResult> {
    const effectiveJobId = String(job.id ?? envelopeId);
    const reportRequest: Partial<RunUserReportRequest> = {
      reportCode: payload.reportCode ?? payload.request?.reportCode ?? 'users.security_compliance',
      ...(payload.request ?? {}),
      ...(payload.format === 'csv' || payload.format === 'xlsx' || payload.format === 'pdf'
        ? { format: payload.format }
        : {}),
      async: false,
    };

    const effectiveActor: UserIdentity | undefined =
      payload.actor ??
      (payload.actorId !== undefined
        ? {
            id: payload.actorId,
            roles: [],
            permissions: ['users.report'],
          }
        : undefined);

    const reportResult = await this.userReportService!.runReport(reportRequest, effectiveActor, {
      skipQueuePublish: true,
      ...(payload.historyId !== undefined ? { existingHistoryId: payload.historyId } : {}),
      jobId: effectiveJobId,
      executionMode: 'QUEUE',
      bypassPermissionCheck: effectiveActor === undefined,
    });

    const effectiveTotal = Math.max(1, reportResult.totalRecords);
    await this.reportProcessingStep(
      job,
      effectiveTotal,
      effectiveTotal,
      `Generated report ${reportResult.reportCode} with ${reportResult.totalRecords} records (${topic})`,
      {
        remaining: 0,
        successCount: reportResult.totalRecords,
      },
    );

    return {
      processed: effectiveTotal,
      total: effectiveTotal,
      extra: {
        reportCode: reportResult.reportCode,
        historyId: reportResult.historyId,
        totalRecords: reportResult.totalRecords,
        dataSourceUsed: reportResult.dataSourceUsed,
        cacheHit: reportResult.cacheHit,
        downloadToken: reportResult.downloadToken,
        downloadUrl: reportResult.downloadUrl,
        expiresAt: reportResult.expiresAt,
        notifiedChannels: reportResult.notifiedChannels,
      },
    };
  }

  /** 3. Xử lý topic `files.media_process` — Kiểm tra toàn vẹn SHA-256 & xử lý tệp media */
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

  /** 4. Xử lý topic `files.trash_cleanup` — Dọn dẹp vĩnh viễn các tệp quá hạn trong thùng rác & file Export/Report tạm hết hạn */
  private async handleTrashCleanup(job: Job, total: number): Promise<HeavyHandlerResult> {
    const cleanupResult = await this.filesService!.purgeExpiredTrash(undefined, {
      skipQueuePublish: true,
    });
    const expiredExports = defaultExportRegistry.purgeExpiredArtifacts();
    const expiredReports = defaultReportRegistry.purgeExpiredReportArtifacts();
    await this.reportProcessingStep(
      job,
      total,
      total,
      `Purged ${cleanupResult.purgedCount} expired trashed files, ${expiredExports.purgedCount} expired export files, and ${expiredReports.purgedCount} expired report files`,
    );

    return {
      processed: total,
      total,
      extra: {
        purgedCount: cleanupResult.purgedCount,
        purgedExportCount: expiredExports.purgedCount,
        purgedReportCount: expiredReports.purgedCount,
      },
    };
  }

  /** 5. Xử lý mặc định theo từng chunk (Export hoặc job chỉ ghi nhận tiến độ) */
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

  /** Kiểm tra điều kiện chạy Export người dùng thật trong Worker (Mục 8.3.4) */
  private canExecuteUserExport(
    topic: string,
    operation: string,
    payload: HeavyQueueJobPayload,
  ): boolean {
    return (
      (operation === 'export' || topic === 'users.export') &&
      Boolean(this.userExportService) &&
      payload.executeInWorker === true
    );
  }

  /** Kiểm tra điều kiện chạy Báo cáo nặng người dùng thật trong Worker (Mục 8.4.4) */
  private canExecuteUserReport(
    topic: string,
    operation: string,
    payload: HeavyQueueJobPayload,
  ): boolean {
    return (
      (operation === 'report' || topic === 'users.report') &&
      Boolean(this.userReportService) &&
      payload.executeInWorker === true
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
    extraCounts?: {
      readonly remaining?: number | null;
      readonly successCount?: number | null;
      readonly createdCount?: number | null;
      readonly updatedCount?: number | null;
      readonly skippedCount?: number | null;
      readonly failedCount?: number | null;
    },
  ): Promise<void> {
    await this.reportJobProgress(job, {
      processed,
      total,
      ...(extraCounts ?? {}),
      step,
      completedPhases: ['Validate Input'],
      activePhase: 'Process Items',
    });
  }
}
