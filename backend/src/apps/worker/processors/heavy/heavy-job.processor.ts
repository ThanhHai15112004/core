import { Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ExportRegistryService,
  ImportRegistryService,
  ReportRegistryService,
  SearchRegistryService,
  defaultExportRegistry,
  defaultImportRegistry,
  defaultReportRegistry,
  defaultSearchRegistry,
  type ExportQueueWorkerExecutor,
  type ImportCellIssue,
  type ImportDuplicateStrategy,
  type ImportQueueWorkerExecutor,
  type ReportQueueWorkerExecutor,
  type SearchQueueWorkerExecutor,
} from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { QUEUE_PROFILES, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  UserExportService,
  UserImportService,
  UserReportService,
  UserSearchService,
  type BulkImportUserRowInput,
  type ListUsersQuery,
  type RunUserReportRequest,
} from '@modules/users/index.js';
import { FilesService } from '@modules/files/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

export interface HeavyQueueJobPayload {
  readonly operation?:
    | 'import'
    | 'export'
    | 'report'
    | 'search_sync'
    | 'search_rebuild'
    | 'media_process'
    | 'trash_cleanup'
    | string;
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
  readonly userIds?: readonly number[];
  readonly documentIds?: readonly (number | string)[];
  readonly profileCode?: string;
  readonly module?: string;
  readonly entityType?: string;
  readonly entityCode?: string;
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
    @Optional() private readonly userSearchService?: UserSearchService,
    @Optional() private readonly importRegistry?: ImportRegistryService,
    @Optional() private readonly exportRegistry?: ExportRegistryService,
    @Optional() private readonly reportRegistry?: ReportRegistryService,
    @Optional() private readonly searchRegistry?: SearchRegistryService,
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

    if (this.canExecuteUserSearchSync(envelope.topic, operation, payload)) {
      return this.handleUserSearchSync(envelope.topic, envelope.id, job, payload, operation);
    }

    if (this.canExecuteMediaProcess(envelope.topic, operation, payload)) {
      return this.handleMediaProcess(job, payload, total);
    }

    if (this.canExecuteTrashCleanup(envelope.topic, operation, payload)) {
      return this.handleTrashCleanup(job, total);
    }

    return this.handleChunkedProgress(envelope.topic, job, total, chunkSize);
  }

  /** 1. Xử lý topic `*.import` — Import dữ liệu hàng loạt theo từng chunk (điều phối động qua `ImportRegistryService`) */
  private async handleUserImport(
    topic: string,
    job: Job,
    payload: HeavyQueueJobPayload,
    chunkSize: number,
  ): Promise<HeavyHandlerResult> {
    const importExecutor = this.resolveImportExecutor(topic, payload);
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const resolvedRows: BulkImportUserRowInput[] =
      rawItems.length > 0
        ? (rawItems as BulkImportUserRowInput[])
        : ([
            ...importExecutor!.parseImportRows({
              skipDuplicates: payload.skipDuplicates ?? true,
              ...(payload.duplicateStrategy
                ? { duplicateStrategy: payload.duplicateStrategy }
                : {}),
              ...(payload.columnMapping ? { columnMapping: payload.columnMapping } : {}),
              ...(payload.csvContent ? { csvContent: payload.csvContent } : {}),
              ...(payload.xlsxBase64 ? { xlsxBase64: payload.xlsxBase64 } : {}),
            }),
          ] as BulkImportUserRowInput[]);

    const effectiveTotal = Math.max(1, resolvedRows.length);
    const historyRef = payload.historyId ?? String(job.id ?? '');
    const activeImportRegistry = this.importRegistry ?? defaultImportRegistry;
    let processed = 0;
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const accumulatedErrors: ImportCellIssue[] = [];

    for (let offset = 0; offset < effectiveTotal; offset += chunkSize) {
      const chunk = resolvedRows.slice(offset, offset + chunkSize);
      if (chunk.length > 0) {
        const chunkResult = await importExecutor!.executeChunkImport({
          items: chunk,
          skipDuplicates: payload.skipDuplicates ?? true,
          ...(payload.duplicateStrategy ? { duplicateStrategy: payload.duplicateStrategy } : {}),
          ...(payload.defaultPassword !== undefined
            ? { defaultPassword: payload.defaultPassword }
            : {}),
          ...(payload.actorId !== undefined ? { actorId: payload.actorId } : {}),
          options: { skipQueuePublish: true, skipHistoryRecord: true },
        });
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
        activeImportRegistry.updateImportHistory(historyRef, {
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

  /** 2. Xử lý topic `*.export` — Xuất danh sách lớn chạy nền qua Queue (điều phối động qua `ExportRegistryService` — Mục 8.3.4 & 8.3.5) */
  private async handleUserExport(
    topic: string,
    envelopeId: string,
    job: Job,
    payload: HeavyQueueJobPayload,
  ): Promise<HeavyHandlerResult> {
    const effectiveJobId = String(job.id ?? envelopeId);
    const exportExecutor = this.resolveExportExecutor(topic, payload);

    const exportResult = await exportExecutor!.executeExport({
      ...(payload.query ? { query: payload.query as Readonly<Record<string, unknown>> } : {}),
      ...(payload.format ? { format: payload.format } : {}),
      notifyOnComplete: payload.notifyOnComplete ?? true,
      ...(payload.actorId !== undefined ? { actorId: payload.actorId } : {}),
      ...(payload.actor ? { actor: payload.actor } : {}),
      ...(payload.historyId !== undefined ? { historyId: payload.historyId } : {}),
      jobId: effectiveJobId,
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

  /** 2.5. Xử lý topic `*.report` — Chạy báo cáo nặng chạy nền qua Queue (điều phối động qua `ReportRegistryService` — Mục 8.4.4 & 8.4.6) */
  private async handleUserReport(
    topic: string,
    envelopeId: string,
    job: Job,
    payload: HeavyQueueJobPayload,
  ): Promise<HeavyHandlerResult> {
    const effectiveJobId = String(job.id ?? envelopeId);
    const reportCode =
      payload.reportCode ?? payload.request?.reportCode ?? 'users.security_compliance';
    const reportExecutor = this.resolveReportExecutor(topic, payload);

    const reportResult = await reportExecutor!.executeReport({
      reportCode,
      ...(payload.request ? { request: payload.request as Readonly<Record<string, unknown>> } : {}),
      ...(payload.format ? { format: payload.format } : {}),
      ...(payload.actorId !== undefined ? { actorId: payload.actorId } : {}),
      ...(payload.actor ? { actor: payload.actor } : {}),
      ...(payload.historyId !== undefined ? { historyId: payload.historyId } : {}),
      jobId: effectiveJobId,
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

  /** 2.6. Xử lý topic `*.search_sync` & `*.search_rebuild` — Đồng bộ hoặc tạo lại Search Index qua Queue (điều phối động qua `SearchRegistryService` — Mục 8.5.4 & 8.5.5) */
  private async handleUserSearchSync(
    topic: string,
    envelopeId: string,
    job: Job,
    payload: HeavyQueueJobPayload,
    operation: string,
  ): Promise<HeavyHandlerResult> {
    const effectiveJobId = String(job.id ?? envelopeId);
    const isRebuild =
      operation === 'search_rebuild' ||
      topic.endsWith('.search_rebuild') ||
      topic === 'search.rebuild_index';

    const searchExecutor = this.resolveSearchExecutor(topic, payload);
    const documentIds = payload.documentIds ?? payload.userIds;

    const historyResult = await searchExecutor!.executeSearchJob({
      operation: isRebuild ? 'search_rebuild' : 'search_sync',
      ...(payload.module ? { module: payload.module } : {}),
      ...(payload.entityType ? { entityType: payload.entityType } : {}),
      ...(payload.entityCode ? { entityCode: payload.entityCode } : {}),
      ...(Array.isArray(documentIds) ? { documentIds } : {}),
      ...(payload.actorId !== undefined ? { actorId: payload.actorId } : {}),
      ...(payload.actor ? { actor: payload.actor } : {}),
      ...(payload.historyId !== undefined ? { historyId: payload.historyId } : {}),
      jobId: effectiveJobId,
    });

    const effectiveTotal = Math.max(1, historyResult.indexedCount);
    await this.reportProcessingStep(
      job,
      effectiveTotal,
      effectiveTotal,
      `Indexed ${historyResult.indexedCount} documents (${topic})`,
      {
        remaining: 0,
        successCount: historyResult.indexedCount,
      },
    );

    return {
      processed: effectiveTotal,
      total: effectiveTotal,
      extra: {
        historyId: historyResult.id,
        syncOperation: historyResult.operation,
        driverUsed: historyResult.driverUsed,
        indexedCount: historyResult.indexedCount,
        removedCount: historyResult.removedCount,
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

  /** Giải quyết động bộ thực thi Import theo Registry hoặc fallback service tiêm trực tiếp */
  private resolveImportExecutor(
    topic: string,
    payload: HeavyQueueJobPayload,
  ): ImportQueueWorkerExecutor<unknown> | undefined {
    const isUsersTarget =
      topic === 'users.import' ||
      (!payload.module && !payload.profileCode) ||
      payload.module === 'users' ||
      payload.profileCode === 'users';

    if (isUsersTarget && this.userImportService) {
      return {
        profileCode: 'users',
        module: 'users',
        topic: 'users.import',
        parseImportRows: (input) =>
          this.userImportService!.parseImportRows({
            skipDuplicates: input.skipDuplicates ?? true,
            ...(input.duplicateStrategy ? { duplicateStrategy: input.duplicateStrategy } : {}),
            ...(input.columnMapping
              ? {
                  columnMapping: Object.fromEntries(
                    Object.entries(input.columnMapping).filter(
                      (entry): entry is [string, string | number] => entry[1] !== null,
                    ),
                  ),
                }
              : {}),
            ...(input.csvContent ? { csvContent: input.csvContent } : {}),
            ...(input.xlsxBase64 ? { xlsxBase64: input.xlsxBase64 } : {}),
          }),
        executeChunkImport: (input) =>
          this.userImportService!.bulkImport(
            {
              items: (input.items ?? []) as BulkImportUserRowInput[],
              skipDuplicates: input.skipDuplicates ?? true,
              ...(input.duplicateStrategy ? { duplicateStrategy: input.duplicateStrategy } : {}),
              ...(input.defaultPassword !== undefined
                ? { defaultPassword: input.defaultPassword }
                : {}),
            },
            input.actorId,
            input.options ?? { skipQueuePublish: true, skipHistoryRecord: true },
          ),
      };
    }

    const activeRegistry = this.importRegistry ?? defaultImportRegistry;
    return activeRegistry.resolveWorkerExecutor({
      profileCode: payload.profileCode,
      module: payload.module,
      topic,
    });
  }

  /** Giải quyết động bộ thực thi Export theo Registry hoặc fallback service tiêm trực tiếp */
  private resolveExportExecutor(
    topic: string,
    payload: HeavyQueueJobPayload,
  ): ExportQueueWorkerExecutor | undefined {
    const isUsersTarget =
      topic === 'users.export' ||
      (!payload.module && !payload.profileCode) ||
      payload.module === 'users' ||
      payload.profileCode === 'users';

    if (isUsersTarget && this.userExportService) {
      return {
        profileCode: 'users',
        module: 'users',
        topic: 'users.export',
        executeExport: async (input) => {
          const exportQuery: ListUsersQuery = {
            sortBy: 'id',
            sortOrder: 'ASC',
            ...((input.query ?? {}) as Partial<ListUsersQuery>),
            ...(input.format === 'csv' || input.format === 'xlsx' || input.format === 'pdf'
              ? { format: input.format }
              : {}),
            async: false,
            notifyOnComplete: input.notifyOnComplete ?? true,
          };
          const effectiveActor: UserIdentity | undefined =
            (input.actor as UserIdentity | undefined) ??
            (input.actorId !== undefined
              ? { id: input.actorId, roles: [], permissions: ['users.export'] }
              : undefined);
          return this.userExportService!.exportUsersCsv(exportQuery, effectiveActor, {
            skipQueuePublish: true,
            ...(input.historyId !== undefined ? { existingHistoryId: input.historyId } : {}),
            jobId: input.jobId,
            forceNotify: input.notifyOnComplete !== false,
          });
        },
      };
    }

    const activeRegistry = this.exportRegistry ?? defaultExportRegistry;
    return activeRegistry.resolveWorkerExecutor({
      profileCode: payload.profileCode,
      module: payload.module,
      topic,
    });
  }

  /** Giải quyết động bộ thực thi Báo cáo theo Registry hoặc fallback service tiêm trực tiếp */
  private resolveReportExecutor(
    topic: string,
    payload: HeavyQueueJobPayload,
  ): ReportQueueWorkerExecutor | undefined {
    const reportCode = payload.reportCode ?? payload.request?.reportCode;
    const isUsersTarget =
      topic === 'users.report' ||
      (!payload.module && (!reportCode || reportCode.startsWith('users.'))) ||
      payload.module === 'users';

    if (isUsersTarget && this.userReportService) {
      return {
        module: 'users',
        topic: 'users.report',
        executeReport: async (input) => {
          const reportRequest: Partial<RunUserReportRequest> = {
            reportCode: input.reportCode || 'users.security_compliance',
            ...((input.request ?? {}) as Partial<RunUserReportRequest>),
            ...(input.format === 'csv' || input.format === 'xlsx' || input.format === 'pdf'
              ? { format: input.format }
              : {}),
            async: false,
          };
          const effectiveActor: UserIdentity | undefined =
            (input.actor as UserIdentity | undefined) ??
            (input.actorId !== undefined
              ? { id: input.actorId, roles: [], permissions: ['users.report'] }
              : undefined);
          return this.userReportService!.runReport(reportRequest, effectiveActor, {
            skipQueuePublish: true,
            ...(input.historyId !== undefined ? { existingHistoryId: input.historyId } : {}),
            jobId: input.jobId,
            executionMode: 'QUEUE',
            bypassPermissionCheck: effectiveActor === undefined,
          });
        },
      };
    }

    const activeRegistry = this.reportRegistry ?? defaultReportRegistry;
    return activeRegistry.resolveWorkerExecutor({
      reportCode,
      module: payload.module,
      topic,
    });
  }

  /** Giải quyết động bộ thực thi đồng bộ Search Index theo Registry hoặc fallback service tiêm trực tiếp */
  private resolveSearchExecutor(
    topic: string,
    payload: HeavyQueueJobPayload,
  ): SearchQueueWorkerExecutor | undefined {
    const isUsersTarget =
      topic === 'users.search_sync' ||
      topic === 'users.search_rebuild' ||
      (!payload.module && !payload.entityCode) ||
      payload.module === 'users' ||
      payload.entityCode?.startsWith('users.');

    if (isUsersTarget && this.userSearchService) {
      return {
        module: 'users',
        entityCode: 'users.account',
        syncTopic: 'users.search_sync',
        rebuildTopic: 'users.search_rebuild',
        executeSearchJob: async (input) => {
          const effectiveActor: UserIdentity | undefined =
            (input.actor as UserIdentity | undefined) ??
            (input.actorId !== undefined
              ? { id: input.actorId, roles: [], permissions: ['users.update', 'users.read'] }
              : undefined);

          if (input.operation === 'search_rebuild') {
            return this.userSearchService!.rebuildSearchIndex(
              {
                ...(input.module ? { module: input.module } : {}),
                ...(input.entityType ? { entityType: input.entityType } : {}),
                ...(input.entityCode ? { entityCode: input.entityCode } : {}),
                async: false,
              },
              effectiveActor,
              {
                skipQueuePublish: true,
                ...(input.historyId !== undefined ? { existingHistoryId: input.historyId } : {}),
                jobId: input.jobId,
                executionMode: 'QUEUE',
              },
            );
          }

          const numericIds = Array.isArray(input.documentIds)
            ? input.documentIds.map((id) => Number(id)).filter((id) => Number.isInteger(id))
            : undefined;

          return this.userSearchService!.syncUsersToSearchIndex(
            {
              ...(numericIds ? { userIds: numericIds } : {}),
              async: false,
            },
            effectiveActor,
            {
              skipQueuePublish: true,
              ...(input.historyId !== undefined ? { existingHistoryId: input.historyId } : {}),
              jobId: input.jobId,
              executionMode: 'QUEUE',
            },
          );
        },
      };
    }

    const activeRegistry = this.searchRegistry ?? defaultSearchRegistry;
    return activeRegistry.resolveWorkerExecutor({
      module: payload.module,
      entityCode: payload.entityCode,
      topic,
    });
  }

  /** Kiểm tra điều kiện chạy Import dữ liệu thật trong Worker (hỗ trợ mọi module đăng ký qua `ImportRegistryService`) */
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
      (operation === 'import' || topic.endsWith('.import')) &&
      Boolean(this.resolveImportExecutor(topic, payload)) &&
      payload.executeInWorker !== false &&
      hasInput
    );
  }

  /** Kiểm tra điều kiện chạy Export dữ liệu thật trong Worker (Mục 8.3.4 — hỗ trợ mọi module đăng ký qua `ExportRegistryService`) */
  private canExecuteUserExport(
    topic: string,
    operation: string,
    payload: HeavyQueueJobPayload,
  ): boolean {
    return (
      (operation === 'export' || topic.endsWith('.export')) &&
      Boolean(this.resolveExportExecutor(topic, payload)) &&
      payload.executeInWorker === true
    );
  }

  /** Kiểm tra điều kiện chạy Báo cáo nặng thật trong Worker (Mục 8.4.4 — hỗ trợ mọi module đăng ký qua `ReportRegistryService`) */
  private canExecuteUserReport(
    topic: string,
    operation: string,
    payload: HeavyQueueJobPayload,
  ): boolean {
    return (
      (operation === 'report' || topic.endsWith('.report')) &&
      Boolean(this.resolveReportExecutor(topic, payload)) &&
      payload.executeInWorker === true
    );
  }

  /** Kiểm tra điều kiện chạy đồng bộ / rebuild Search Index trong Worker (Mục 8.5.4 & 8.5.5 — hỗ trợ mọi module đăng ký qua `SearchRegistryService`) */
  private canExecuteUserSearchSync(
    topic: string,
    operation: string,
    payload: HeavyQueueJobPayload,
  ): boolean {
    return (
      (operation === 'search_sync' ||
        operation === 'search_rebuild' ||
        topic.endsWith('.search_sync') ||
        topic.endsWith('.search_rebuild') ||
        topic === 'search.index_sync' ||
        topic === 'search.rebuild_index') &&
      Boolean(this.resolveSearchExecutor(topic, payload)) &&
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
