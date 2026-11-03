import { Injectable, Optional } from '@nestjs/common';
import {
  ExportRegistryService,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  defaultExportRegistry,
  resolveExportContentType,
  resolveExportFormat,
  safeJsonParseObject,
  type ExportFormat,
  type ExportHistoryQueryFilter,
  type ExportHistoryRecord,
  type ExportProgressSnapshot,
  type IPdfExportAdapter,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import { UserExportService, UsersService } from '@modules/users/index.js';
import { OrganizationsService } from '@modules/organizations/index.js';
import { CodesService } from '@modules/codes/index.js';
import type { IExportsPublicService } from '../contracts/index.js';
import type { ExportHistoryEntity } from '../entities/export-history.entity.js';
import { ExportHistoryRepository } from '../repositories/export-history.repository.js';
import type {
  ExecuteExportQuery,
  ListExportHistoriesQuery,
  UpdateExportHistoryRequest,
} from '../requests/exports.requests.js';
import type { ExecuteExportResponse } from '../responses/exports.response.js';

@Injectable()
export class ExportsService implements IExportsPublicService {
  private readonly exportRegistry: ExportRegistryService;

  constructor(
    @Optional() private readonly historyRepository?: ExportHistoryRepository,
    @Optional() exportRegistry?: ExportRegistryService,
    @Optional() private readonly userExportService?: UserExportService,
    @Optional() private readonly usersService?: UsersService,
    @Optional() private readonly organizationsService?: OrganizationsService,
    @Optional() private readonly codesService?: CodesService,
  ) {
    this.exportRegistry = exportRegistry ?? defaultExportRegistry;
    this.ensureDefaultExecutorsRegistered();
  }

  private ensureDefaultExecutorsRegistered(): void {
    if (
      this.userExportService &&
      !this.exportRegistry.resolveWorkerExecutor({ profileCode: 'users' })
    ) {
      this.exportRegistry.registerWorkerExecutor({
        profileCode: 'users',
        module: 'users',
        topic: 'users.export',
        requiredPermission: 'users.export',
        executeExport: async (input) => {
          const query = (input.query ?? {}) as ExecuteExportQuery;
          if (this.usersService) {
            await this.usersService.verifySensitiveActionStepUp(
              (input.actor as UserIdentity | undefined)?.id ?? input.actorId,
              query.stepUpToken,
              query.requireStepUp,
              'users.export',
            );
          }
          return this.userExportService!.exportUsersCsv(
            query,
            input.actor as UserIdentity | undefined,
          );
        },
      });
    }

    if (
      this.organizationsService &&
      !this.exportRegistry.resolveWorkerExecutor({ profileCode: 'organizations' })
    ) {
      this.exportRegistry.registerWorkerExecutor({
        profileCode: 'organizations',
        module: 'organizations',
        topic: 'organizations.export',
        requiredPermission: 'organizations.read',
        executeExport: async (input) => {
          const query = (input.query ?? {}) as ExecuteExportQuery;
          const format: 'csv' | 'xlsx' = input.format === 'xlsx' ? 'xlsx' : 'csv';
          const orgStatus =
            query.status === 1 || query.status === 2 || query.status === 3
              ? query.status
              : undefined;
          const res = await this.organizationsService!.exportUnits(
            {
              ...(query.search ? { search: query.search } : {}),
              ...(orgStatus !== undefined ? { status: orgStatus } : {}),
              format,
            },
            input.actorId,
            { skipHistoryRecord: true },
          );
          return {
            fileName: res.fileName,
            contentType: res.contentType,
            format: res.format,
            totalExported: res.totalExported,
            csvContent: res.csvContent,
            xlsxBase64: res.xlsxBase64,
          };
        },
      });
    }

    if (this.codesService && !this.exportRegistry.resolveWorkerExecutor({ profileCode: 'codes' })) {
      this.exportRegistry.registerWorkerExecutor({
        profileCode: 'codes',
        module: 'codes',
        topic: 'codes.export',
        requiredPermission: 'codes.read',
        executeExport: async (input) => {
          const query = (input.query ?? {}) as ExecuteExportQuery;
          const format: 'csv' | 'xlsx' = input.format === 'xlsx' ? 'xlsx' : 'csv';
          const res = await this.codesService!.exportCodes(
            {
              ...(query.search ? { search: query.search } : {}),
              format,
            },
            input.actorId,
            { skipHistoryRecord: true },
          );
          return {
            fileName: res.fileName,
            contentType: res.contentType,
            format: res.format,
            totalExported: res.totalExported,
            csvContent: res.csvContent,
            xlsxBase64: res.xlsxBase64,
          };
        },
      });
    }
  }

  /** 8.3.3 — Đăng ký hoặc thay thế Pluggable PDF Adapter dùng chung */
  public registerPdfAdapter(adapter: IPdfExportAdapter): void {
    this.exportRegistry.registerPdfAdapter(adapter);
  }

  /**
   * 8.3.1 → 8.3.8 — Thực thi Xuất dữ liệu theo `profileCode` qua `ExportRegistryService` (Excel `.xlsx`, CSV `.csv` hoặc PDF `.pdf`),
   * giữ đúng bộ lọc & Data Scope, hỗ trợ chạy nền qua Queue và lưu lịch sử vào bảng `export_histories`.
   */
  public async executeExport(
    profileCode: string,
    query: ExecuteExportQuery,
    actor?: UserIdentity,
  ): Promise<ExecuteExportResponse> {
    this.ensureDefaultExecutorsRegistered();
    const cleanProfile = profileCode.trim().toLowerCase();

    const executor =
      this.exportRegistry.resolveWorkerExecutor({ profileCode: cleanProfile }) ??
      defaultExportRegistry.resolveWorkerExecutor({ profileCode: cleanProfile });
    if (!executor) {
      throw new NotFoundAppException('exports.profileNotFound', { profileCode: cleanProfile });
    }

    this.assertProfilePermission(executor.requiredPermission, actor);

    if (cleanProfile === 'users' && this.usersService) {
      await this.usersService.verifySensitiveActionStepUp(
        actor?.id,
        query.stepUpToken,
        query.requireStepUp,
        'users.export',
      );
    }

    const jobResult = await executor.executeExport({
      query: query as unknown as Readonly<Record<string, unknown>>,
      format: query.format,
      notifyOnComplete: query.notifyOnComplete,
      ...(actor?.id !== undefined ? { actorId: actor.id } : {}),
      actor,
      jobId: `exp_${Date.now()}`,
    });

    const resolvedFormat = resolveExportFormat(jobResult.format ?? query.format, 'csv');
    const resolvedContentType = jobResult.contentType ?? resolveExportContentType(resolvedFormat);

    if (typeof jobResult.historyId === 'number') {
      const memRecord =
        this.exportRegistry.getHistoryById(jobResult.historyId) ??
        defaultExportRegistry.getHistoryById(jobResult.historyId);
      const response: ExecuteExportResponse = {
        fileName: jobResult.fileName ?? `${cleanProfile}_export.${resolvedFormat}`,
        contentType: resolvedContentType,
        format: resolvedFormat,
        totalExported: jobResult.totalExported,
        ...(jobResult.maxRowsAllowed !== undefined
          ? { maxRowsAllowed: jobResult.maxRowsAllowed }
          : {}),
        ...(jobResult.appliedLimitPolicy !== undefined
          ? { appliedLimitPolicy: jobResult.appliedLimitPolicy }
          : {}),
        csvContent: jobResult.csvContent ?? '',
        xlsxBase64: jobResult.xlsxBase64 ?? '',
        ...(jobResult.pdfBase64 !== undefined ? { pdfBase64: jobResult.pdfBase64 } : {}),
        historyId: jobResult.historyId,
        jobId: jobResult.jobId ?? memRecord?.jobId ?? null,
        status: jobResult.status ?? memRecord?.status ?? 'COMPLETED',
        downloadToken: jobResult.downloadToken ?? memRecord?.downloadToken ?? null,
        downloadUrl: jobResult.downloadUrl ?? memRecord?.downloadUrl ?? null,
        expiresAt: jobResult.expiresAt ?? memRecord?.expiresAt ?? null,
        notifiedAt: jobResult.notifiedAt ?? memRecord?.notifiedAt ?? null,
      };
      if (memRecord) {
        await this.persistHistoryRecordToDb(memRecord, response);
      }
      return response;
    }

    const started = this.exportRegistry.startExportHistory({
      profileCode: executor.profileCode,
      module: executor.module,
      fileName: jobResult.fileName ?? `${cleanProfile}_export.${resolvedFormat}`,
      format: resolvedFormat,
      actorId: actor?.id ?? null,
      filters: query as unknown as Readonly<Record<string, unknown>>,
      totalExported: jobResult.totalExported,
      processedRows: jobResult.totalExported,
      status: 'COMPLETED',
    });
    const artifactBuffer =
      resolvedFormat === 'xlsx'
        ? Buffer.from(jobResult.xlsxBase64 ?? '', 'base64')
        : resolvedFormat === 'pdf'
          ? Buffer.from(jobResult.pdfBase64 ?? '', 'base64')
          : Buffer.from(jobResult.csvContent ?? '', 'utf8');
    const artifact = this.exportRegistry.storeTemporaryArtifact({
      profileCode: executor.profileCode,
      module: executor.module,
      fileName: started.fileName,
      format: resolvedFormat,
      contentType: resolvedContentType,
      totalExported: jobResult.totalExported,
      buffer: artifactBuffer,
      actorId: actor?.id ?? null,
      historyId: started.id,
      jobId: started.jobId,
      baseDownloadPath: '/api/v1/exports/downloads',
    });

    const response: ExecuteExportResponse = {
      fileName: started.fileName,
      contentType: resolvedContentType,
      format: resolvedFormat,
      totalExported: jobResult.totalExported,
      csvContent: jobResult.csvContent ?? '',
      xlsxBase64: jobResult.xlsxBase64 ?? '',
      ...(jobResult.pdfBase64 !== undefined ? { pdfBase64: jobResult.pdfBase64 } : {}),
      historyId: started.id,
      jobId: started.jobId,
      status: 'COMPLETED',
      downloadToken: artifact.token,
      downloadUrl: artifact.downloadUrl,
      expiresAt: artifact.expiresAt,
    };
    const memRecord = this.exportRegistry.getHistoryById(started.id) ?? started;
    await this.persistHistoryRecordToDb(memRecord, response);
    return response;
  }

  private assertProfilePermission(requiredPermission?: string, actor?: UserIdentity): void {
    if (!requiredPermission || !actor || !Array.isArray(actor.permissions)) {
      return;
    }
    const perms = new Set(actor.permissions);
    if (
      perms.has('*') ||
      perms.has('system.admin') ||
      perms.has('exports.execute') ||
      perms.has('exports.manage') ||
      perms.has(requiredPermission)
    ) {
      return;
    }
    throw new ForbiddenAppException(HTTP_ERROR_CODE.FORBIDDEN, [
      {
        requiredPermissions: ['exports.execute', requiredPermission],
        missingPermissions: [requiredPermission],
      },
    ]);
  }

  /** 8.3.4 — Xem tiến độ thực thi Export theo `jobId` hoặc `historyId` */
  public getJobProgress(jobIdOrHistoryId: string | number): ExportProgressSnapshot {
    const progress = this.exportRegistry.getProgress(jobIdOrHistoryId);
    if (!progress) {
      throw new NotFoundAppException('exports.exportJobNotFound', { id: jobIdOrHistoryId });
    }
    return progress;
  }

  /** 8.3.7 — Tra cứu danh sách lịch sử Export (từ bảng `export_histories` kết hợp Registry) */
  public async listHistories(query?: ListExportHistoriesQuery): Promise<ExportHistoryRecord[]> {
    const filter: ExportHistoryQueryFilter = {
      ...(query?.profileCode ? { profileCode: query.profileCode } : {}),
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query?.format ? { format: query.format } : {}),
      ...(query?.status ? { status: query.status } : {}),
      ...(query?.includeExpired !== undefined ? { includeExpired: query.includeExpired } : {}),
      ...(query?.limit !== undefined ? { limit: query.limit } : {}),
    };

    const memList = this.exportRegistry.listHistories(filter);
    if (!this.historyRepository) {
      return memList;
    }

    const dbEntities = await this.historyRepository.listFiltered(filter).catch(() => []);
    if (dbEntities.length === 0) {
      return memList;
    }

    const byId = new Map<number, ExportHistoryRecord>();
    for (const entity of dbEntities) {
      const mapped = this.mapEntityToRecord(entity);
      byId.set(mapped.id, mapped);
    }
    for (const mem of memList) {
      if (!byId.has(mem.id)) {
        byId.set(mem.id, mem);
      }
    }

    const limit = Math.max(1, Math.min(200, query?.limit ?? 50));
    return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, limit);
  }

  /** 8.3.7 — Xem chi tiết 1 bản ghi lịch sử Export theo ID */
  public async getHistoryById(historyId: number): Promise<ExportHistoryRecord> {
    const mem = this.exportRegistry.getHistoryById(historyId);
    if (mem) {
      return mem;
    }

    if (this.historyRepository) {
      const entity = await this.historyRepository.findById(historyId).catch(() => null);
      if (entity) {
        return this.mapEntityToRecord(entity);
      }
    }

    throw new NotFoundAppException('exports.exportHistoryNotFound', { id: historyId });
  }

  /** Cập nhật thông tin hoặc trạng thái của một bản ghi lịch sử Export (Sửa) */
  public async updateHistory(
    historyId: number,
    patch: UpdateExportHistoryRequest,
  ): Promise<ExportHistoryRecord> {
    const updatedMem = this.exportRegistry.updateExportHistory(historyId, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.fileName !== undefined ? { fileName: patch.fileName } : {}),
      ...(patch.totalExported !== undefined ? { totalExported: patch.totalExported } : {}),
      ...(patch.processedRows !== undefined ? { processedRows: patch.processedRows } : {}),
      ...(patch.isExpired !== undefined ? { isExpired: patch.isExpired } : {}),
      ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
    });

    if (updatedMem) {
      await this.persistHistoryRecordToDb(updatedMem);
      return updatedMem;
    }

    if (this.historyRepository) {
      const updatedDb = await this.historyRepository
        .updateById(historyId, {
          ...(patch.status !== undefined
            ? {
                status: patch.status === 'CANCELLED' ? 'FAILED' : patch.status,
              }
            : {}),
          ...(patch.fileName !== undefined ? { fileName: patch.fileName } : {}),
          ...(patch.totalExported !== undefined ? { totalExported: patch.totalExported } : {}),
          ...(patch.processedRows !== undefined ? { processedRows: patch.processedRows } : {}),
          ...(patch.isExpired !== undefined ? { isExpired: patch.isExpired } : {}),
          ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        })
        .catch(() => null);

      if (updatedDb) {
        return this.mapEntityToRecord(updatedDb);
      }
    }

    throw new NotFoundAppException('exports.exportHistoryNotFound', { id: historyId });
  }

  /** Xóa một bản ghi lịch sử Export và thu hồi tệp tạm liên quan khỏi Registry & Database (Xóa) */
  public async deleteHistory(historyId: number): Promise<{
    readonly deleted: true;
    readonly id: number;
  }> {
    const deletedMem = this.exportRegistry.deleteHistory(historyId);
    const deletedDb = this.historyRepository
      ? await this.historyRepository.deleteById(historyId).catch(() => false)
      : false;

    if (!deletedMem && !deletedDb) {
      throw new NotFoundAppException('exports.exportHistoryNotFound', { id: historyId });
    }

    return { deleted: true, id: historyId };
  }

  /**
   * 8.3.5 & 8.3.8 — Tải xuống file Export qua đường dẫn tạm thời (`token`).
   * Tự động thu hồi khi quá hạn `expiresAt` và trả lỗi `exports.exportFileExpired`.
   */
  public async downloadTemporaryExport(
    token: string,
    now: Date = new Date(),
  ): Promise<{
    readonly token: string;
    readonly downloadUrl: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly format: ExportFormat;
    readonly totalExported: number;
    readonly sizeBytes: number;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly csvContent?: string;
    readonly xlsxBase64?: string;
    readonly pdfBase64?: string;
  }> {
    if (this.exportRegistry.getTemporaryArtifactByToken(token, now)) {
      return this.exportRegistry.formatTemporaryArtifactDownload(token, {
        now,
        expiredErrorKey: 'exports.exportFileExpired',
      });
    }

    if (this.historyRepository) {
      const entity = await this.historyRepository.findByToken(token).catch(() => null);
      if (entity && !entity.isExpired && entity.expiresAt && entity.filePayloadBase64) {
        if (entity.expiresAt.getTime() <= now.getTime()) {
          await this.historyRepository
            .saveEntity({
              id: entity.id,
              isExpired: true,
              status: 'EXPIRED',
              downloadUrl: null,
              filePayloadBase64: null,
            })
            .catch(() => null);
          throw new NotFoundAppException('exports.exportFileExpired', { token });
        }

        const buf = Buffer.from(entity.filePayloadBase64, 'base64');
        return {
          token: entity.downloadToken ?? token,
          downloadUrl: entity.downloadUrl ?? `/api/v1/exports/downloads/${token}`,
          fileName: entity.fileName,
          contentType: entity.contentType ?? 'application/octet-stream',
          format: entity.format,
          totalExported: entity.totalExported,
          sizeBytes: entity.fileSizeBytes || buf.byteLength,
          createdAt: entity.startedAt.toISOString(),
          expiresAt: entity.expiresAt.toISOString(),
          ...(entity.format === 'csv'
            ? { csvContent: buf.toString('utf8') }
            : entity.format === 'xlsx'
              ? { xlsxBase64: entity.filePayloadBase64 }
              : { pdfBase64: entity.filePayloadBase64 }),
        };
      }
    }

    throw new NotFoundAppException('exports.exportFileExpired', { token });
  }

  /** 8.3.8 — Dọn dẹp toàn bộ các file Export tạm thời đã hết hạn (`expiresAt <= now`) */
  public async purgeExpiredExports(now: Date = new Date()): Promise<{
    readonly purgedCount: number;
    readonly purgedTokens: readonly string[];
    readonly purgedHistoryIds: readonly number[];
  }> {
    const memPurged = this.exportRegistry.purgeExpiredArtifacts(now);
    if (this.historyRepository) {
      await this.historyRepository.markExpiredByNow(now).catch(() => 0);
    }
    return memPurged;
  }

  /** Lưu đồng bộ bản ghi lịch sử Export xuống bảng `export_histories` */
  public async persistHistoryRecordToDb(
    record: ExportHistoryRecord,
    payload?: ExecuteExportResponse,
  ): Promise<void> {
    if (!this.historyRepository) return;
    try {
      const existing = record.downloadToken
        ? await this.historyRepository.findByToken(record.downloadToken)
        : record.jobId
          ? await this.historyRepository.findByJobId(record.jobId)
          : await this.historyRepository.findById(record.id);

      let payloadBase64: string | null = null;
      if (payload) {
        if (record.format === 'csv' && payload.csvContent) {
          payloadBase64 = Buffer.from(payload.csvContent, 'utf8').toString('base64');
        } else if (record.format === 'xlsx' && payload.xlsxBase64) {
          payloadBase64 = payload.xlsxBase64;
        } else if (record.format === 'pdf' && payload.pdfBase64) {
          payloadBase64 = payload.pdfBase64;
        }
      }

      await this.historyRepository.saveEntity({
        ...(existing ? { id: existing.id } : {}),
        profileCode: record.profileCode,
        module: record.module,
        fileName: record.fileName,
        format: record.format,
        status: record.status,
        jobId: record.jobId,
        actorId: record.actorId,
        filtersJson: JSON.stringify(record.filters ?? {}),
        totalExported: record.totalExported,
        processedRows: record.processedRows,
        maxRowsApplied: record.maxRowsApplied,
        downloadToken: record.downloadToken,
        downloadUrl: record.downloadUrl,
        contentType: payload?.contentType ?? null,
        fileSizeBytes: payloadBase64 ? Buffer.from(payloadBase64, 'base64').byteLength : 0,
        filePayloadBase64: payloadBase64,
        expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
        isExpired: record.isExpired,
        notifiedAt: record.notifiedAt ? new Date(record.notifiedAt) : null,
        errorMessage: record.errorMessage,
        startedAt: new Date(record.createdAt),
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
      });
    } catch {
      // Fallback an toàn cho môi trường test không bật DB
    }
  }

  private mapEntityToRecord(entity: ExportHistoryEntity): ExportHistoryRecord {
    const filters = safeJsonParseObject<Record<string, unknown>>(entity.filtersJson);
    return {
      id: Number(entity.id),
      jobId: entity.jobId,
      profileCode: entity.profileCode,
      module: entity.module,
      fileName: entity.fileName,
      format: entity.format,
      actorId: entity.actorId,
      status: entity.status,
      filters,
      totalExported: entity.totalExported,
      processedRows: entity.processedRows,
      maxRowsApplied: entity.maxRowsApplied,
      downloadToken: entity.downloadToken,
      downloadUrl: entity.downloadUrl,
      expiresAt:
        entity.expiresAt instanceof Date
          ? entity.expiresAt.toISOString()
          : entity.expiresAt
            ? String(entity.expiresAt)
            : null,
      isExpired: entity.isExpired,
      notifiedAt:
        entity.notifiedAt instanceof Date
          ? entity.notifiedAt.toISOString()
          : entity.notifiedAt
            ? String(entity.notifiedAt)
            : null,
      errorMessage: entity.errorMessage,
      createdAt:
        entity.startedAt instanceof Date
          ? entity.startedAt.toISOString()
          : String(entity.startedAt),
      completedAt:
        entity.completedAt instanceof Date
          ? entity.completedAt.toISOString()
          : entity.completedAt
            ? String(entity.completedAt)
            : null,
    };
  }
}
