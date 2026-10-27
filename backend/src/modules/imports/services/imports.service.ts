import { Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import {
  BadRequestAppException,
  ImportRegistryService,
  NotFoundAppException,
  SettingRegistryService,
  buildImportPreviewResult,
  buildImportTemplateFile,
  defaultImportRegistry,
  defaultSettingRegistry,
  extractMappedRowsFromMatrix,
  parseCsvToMatrix,
  parseXlsxToMatrix,
  resolveImportColumnMapping,
  resolveImportDuplicateStrategy,
  safeJsonParse,
  safeJsonParseObject,
  validateImportRowsAndCells,
  type ImportCellIssue,
  type ImportHistoryQueryFilter,
  type ImportHistoryRecord,
  type ImportPreviewResult,
  type ImportProfileHandler,
  type ImportProgressSnapshot,
} from '@packages/kernel/index.js';
import {
  UserExportService,
  UserImportService,
  type BulkImportUsersRequest,
} from '@modules/users/index.js';
import { OrganizationsService } from '@modules/organizations/index.js';
import { CodesService } from '@modules/codes/index.js';
import type { IImportsPublicService } from '../contracts/index.js';
import type { ImportHistoryEntity } from '../entities/import-history.entity.js';
import { ImportHistoryRepository } from '../repositories/import-history.repository.js';
import type {
  ExecuteImportRequest,
  ListImportHistoriesQuery,
  PreviewImportRequest,
  UpdateImportHistoryRequest,
} from '../requests/imports.requests.js';
import type { ExecuteImportResultResponse } from '../responses/imports.response.js';

@Injectable()
export class ImportsService implements IImportsPublicService {
  private readonly importRegistry: ImportRegistryService;
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    @Optional() private readonly historyRepository?: ImportHistoryRepository,
    @Optional() importRegistry?: ImportRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly userImportService?: UserImportService,
    @Optional() private readonly userExportService?: UserExportService,
    @Optional() private readonly organizationsService?: OrganizationsService,
    @Optional() private readonly codesService?: CodesService,
  ) {
    this.importRegistry = importRegistry ?? defaultImportRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.ensureDefaultProfilesRegistered();
  }

  private ensureDefaultProfilesRegistered(): void {
    if (!this.importRegistry.getProfile('organizations')) {
      this.importRegistry.registerProfile({
        profileCode: 'organizations',
        module: 'organizations',
        uniqueKeyFields: ['code'],
        columns: [
          { field: 'code', header: 'Mã đơn vị', required: true, aliases: ['code', 'ma_don_vi'] },
          { field: 'name', header: 'Tên đơn vị', required: true, aliases: ['name', 'ten_don_vi'] },
          {
            field: 'type',
            header: 'Loại đơn vị',
            required: false,
            aliases: ['type', 'loai_don_vi'],
          },
          {
            field: 'parentCode',
            header: 'Mã đơn vị cha',
            required: false,
            aliases: ['parent_code', 'ma_cha'],
          },
        ],
        rowSchema: z.object({
          code: z.string().trim().min(1),
          name: z.string().trim().min(1),
          type: z.union([z.string(), z.number()]).optional(),
          parentCode: z.string().optional(),
        }),
      });
    }

    if (!this.importRegistry.getProfile('codes')) {
      this.importRegistry.registerProfile({
        profileCode: 'codes',
        module: 'codes',
        uniqueKeyFields: ['typeCode', 'code'],
        columns: [
          {
            field: 'typeCode',
            header: 'Nhóm danh mục',
            required: true,
            aliases: ['type_code', 'nhom'],
          },
          {
            field: 'numericCode',
            header: 'Mã số',
            required: true,
            aliases: ['numeric_code', 'ma_so'],
          },
          { field: 'code', header: 'Mã định danh', required: true, aliases: ['code', 'ma_code'] },
          { field: 'name', header: 'Tên hiển thị', required: true, aliases: ['name', 'ten'] },
        ],
        rowSchema: z.object({
          typeCode: z.string().trim().min(1),
          numericCode: z.coerce.number().int(),
          code: z.string().trim().min(1),
          name: z.string().trim().min(1),
        }),
      });
    }
  }

  /** Đăng ký một cấu hình Import nghiệp vụ của module vào `ImportRegistryService` */
  public registerProfile<TRow = Record<string, unknown>>(
    handler: ImportProfileHandler<TRow>,
  ): void {
    this.importRegistry.registerProfile(handler);
  }

  /** Danh sách các cấu hình Import đã đăng ký của toàn bộ module */
  public listProfiles(): ReadonlyArray<{ readonly profileCode: string; readonly module: string }> {
    this.ensureDefaultProfilesRegistered();
    return this.importRegistry.listProfiles().map((p) => ({
      profileCode: p.profileCode,
      module: p.module,
    }));
  }

  /** Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) theo `profileCode` (Mục 8.2.1 & 8.2.2) */
  public exportImportTemplate(
    profileCode: string,
    format: 'csv' | 'xlsx' = 'xlsx',
  ): {
    readonly fileName: string;
    readonly contentType: string;
    readonly format: 'csv' | 'xlsx' | 'pdf';
    readonly totalExported: number;
    readonly csvContent: string;
    readonly xlsxBase64: string;
  } {
    const cleanProfile = profileCode.trim().toLowerCase();
    if (cleanProfile === 'users' && this.userExportService) {
      return this.userExportService.exportImportTemplate(format);
    }
    if (cleanProfile === 'organizations' && this.organizationsService) {
      return this.organizationsService.exportImportTemplate(format);
    }
    if (cleanProfile === 'codes' && this.codesService) {
      return this.codesService.exportImportTemplate(format);
    }

    const profile = this.importRegistry.getProfile(cleanProfile);
    if (!profile) {
      throw new NotFoundAppException('imports.profileNotFound', { profileCode: cleanProfile });
    }

    return buildImportTemplateFile({
      fileBaseName: `mau_import_${cleanProfile}`,
      format,
      columns: profile.columns,
    });
  }

  /**
   * 8.2.3, 8.2.4, 8.2.5 — Xem trước dữ liệu trước khi nhập (Preview / Dry-run):
   * Ánh xạ cột (`columnMapping`), dòng mẫu và kiểm tra lỗi theo từng dòng/cột.
   */
  public async previewImport(
    profileCode: string,
    dto: PreviewImportRequest,
  ): Promise<ImportPreviewResult> {
    const cleanProfile = profileCode.trim().toLowerCase();
    const defaultPreviewLimit = this.settingRegistry.getNumber(
      'imports.preview_sample_limit',
      undefined,
      20,
    );

    if (cleanProfile === 'users' && this.userImportService) {
      return this.userImportService.previewImport({
        ...(dto.items ? { items: dto.items as unknown as BulkImportUsersRequest['items'] } : {}),
        ...(dto.csvContent ? { csvContent: dto.csvContent } : {}),
        ...(dto.xlsxBase64 ? { xlsxBase64: dto.xlsxBase64 } : {}),
        ...(dto.columnMapping ? { columnMapping: dto.columnMapping } : {}),
        ...(dto.duplicateStrategy ? { duplicateStrategy: dto.duplicateStrategy } : {}),
        skipDuplicates: dto.skipDuplicates ?? true,
        previewLimit: dto.previewLimit ?? defaultPreviewLimit,
      });
    }

    const profile = this.importRegistry.getProfile(cleanProfile);
    if (!profile) {
      throw new NotFoundAppException('imports.profileNotFound', { profileCode: cleanProfile });
    }

    const duplicateStrategy = resolveImportDuplicateStrategy(
      dto.duplicateStrategy,
      dto.skipDuplicates,
    );

    let matrix: string[][];
    if (dto.xlsxBase64) {
      try {
        matrix = parseXlsxToMatrix(dto.xlsxBase64);
      } catch (err: unknown) {
        throw new BadRequestAppException('imports.invalidXlsxFile', [
          err instanceof Error ? err.message : 'Unable to parse .xlsx file',
        ]);
      }
    } else if (dto.csvContent) {
      matrix = parseCsvToMatrix(dto.csvContent);
    } else {
      const items = dto.items ?? [];
      const headers = profile.columns.map((c) => c.header);
      matrix = [
        headers,
        ...items.map((item) => profile.columns.map((c) => String(item[c.field] ?? ''))),
      ];
    }

    const mapping = resolveImportColumnMapping(matrix, profile.columns, dto.columnMapping);
    const extractedRows = extractMappedRowsFromMatrix(matrix, mapping);
    const candidateRows = extractedRows.map(
      (r) => r.rawByField as Readonly<Record<string, unknown>>,
    );
    const { validRows, issues } = validateImportRowsAndCells(
      candidateRows,
      extractedRows,
      mapping,
      profile.rowSchema,
      profile.uniqueKeyFields,
    );
    const existingDuplicates = profile.findExistingDuplicates
      ? await profile.findExistingDuplicates(validRows)
      : new Map();

    return buildImportPreviewResult({
      profileCode: cleanProfile,
      mapping,
      extractedRows,
      validRows,
      validationIssues: issues,
      existingDuplicates,
      duplicateStrategy,
      previewLimit: dto.previewLimit ?? defaultPreviewLimit,
    });
  }

  /**
   * 8.2.1 → 8.2.9 — Thực thi Nhập dữ liệu hàng loạt theo `profileCode`
   * và đồng bộ bản ghi lịch sử vào bảng Database `import_histories`.
   */
  public async executeImport(
    profileCode: string,
    dto: ExecuteImportRequest,
    actorId?: number,
  ): Promise<ExecuteImportResultResponse> {
    const cleanProfile = profileCode.trim().toLowerCase();
    const maxBatchRows = this.settingRegistry.getNumber(
      'imports.max_rows_per_batch',
      undefined,
      10000,
    );
    if (dto.items && dto.items.length > maxBatchRows) {
      throw new BadRequestAppException('imports.invalidXlsxFile', [
        `Exceeds maximum allowed rows (${maxBatchRows})`,
      ]);
    }

    if (cleanProfile === 'users' && this.userImportService) {
      const result = await this.userImportService.bulkImport(
        {
          ...(dto.items ? { items: dto.items as unknown as BulkImportUsersRequest['items'] } : {}),
          ...(dto.csvContent ? { csvContent: dto.csvContent } : {}),
          ...(dto.xlsxBase64 ? { xlsxBase64: dto.xlsxBase64 } : {}),
          ...(dto.fileName ? { fileName: dto.fileName } : {}),
          ...(dto.columnMapping ? { columnMapping: dto.columnMapping } : {}),
          ...(dto.duplicateStrategy ? { duplicateStrategy: dto.duplicateStrategy } : {}),
          skipDuplicates: dto.skipDuplicates ?? true,
          ...(dto.defaultPassword ? { defaultPassword: dto.defaultPassword } : {}),
          async: dto.async ?? false,
        },
        actorId,
      );

      if (result.historyId) {
        const memRecord = this.importRegistry.getHistoryById(result.historyId);
        if (memRecord) {
          await this.persistHistoryRecordToDb(memRecord);
        }
      }

      return result;
    }

    if (cleanProfile === 'organizations' && this.organizationsService) {
      const duplicateStrategy = resolveImportDuplicateStrategy(
        dto.duplicateStrategy,
        dto.skipDuplicates,
      );
      const format = dto.xlsxBase64 ? 'xlsx' : dto.csvContent ? 'csv' : 'json';
      const orgResult = await this.organizationsService.bulkImportUnits({
        ...(dto.items ? { items: dto.items as never } : {}),
        ...(dto.csvContent ? { csvContent: dto.csvContent } : {}),
        ...(dto.xlsxBase64 ? { xlsxBase64: dto.xlsxBase64 } : {}),
        skipDuplicates: dto.skipDuplicates ?? true,
      });

      const started = this.importRegistry.startImportHistory({
        profileCode: 'organizations',
        module: 'organizations',
        fileName: dto.fileName ?? `organizations_import.${format}`,
        format,
        duplicateStrategy,
        columnMapping: dto.columnMapping ?? null,
        totalRows: orgResult.totalRows,
        actorId: actorId ?? null,
        status: orgResult.failedCount > 0 ? 'PARTIAL' : 'COMPLETED',
      });
      const updated =
        this.importRegistry.updateImportHistory(started.id, {
          status: orgResult.failedCount > 0 ? 'PARTIAL' : 'COMPLETED',
          totalRows: orgResult.totalRows,
          processedRows: orgResult.totalRows,
          createdCount: orgResult.importedCount,
          updatedCount: orgResult.updatedCount,
          skippedCount: orgResult.skippedCount,
          failedCount: orgResult.failedCount,
        }) ?? started;
      await this.persistHistoryRecordToDb(updated);

      return {
        totalRows: orgResult.totalRows,
        importedCount: orgResult.importedCount,
        updatedCount: orgResult.updatedCount,
        successCount: orgResult.importedCount + orgResult.updatedCount,
        skippedCount: orgResult.skippedCount,
        failedCount: orgResult.failedCount,
        remainingCount: 0,
        duplicateStrategy,
        historyId: updated.id,
        jobId: updated.jobId,
        status: updated.status,
        importedUserIds: [],
        updatedUserIds: [],
        errors: orgResult.errors.map((e) => ({
          row: e.row,
          identifier: e.identifier,
          message: e.message,
        })),
      };
    }

    if (cleanProfile === 'codes' && this.codesService) {
      const duplicateStrategy = resolveImportDuplicateStrategy(
        dto.duplicateStrategy,
        dto.skipDuplicates,
      );
      const format = dto.xlsxBase64 ? 'xlsx' : dto.csvContent ? 'csv' : 'json';
      const codeResult = await this.codesService.bulkImportCodeValues({
        ...(dto.items ? { items: dto.items as never } : {}),
        ...(dto.csvContent ? { csvContent: dto.csvContent } : {}),
        ...(dto.xlsxBase64 ? { xlsxBase64: dto.xlsxBase64 } : {}),
        skipDuplicates: dto.skipDuplicates ?? true,
      });

      const started = this.importRegistry.startImportHistory({
        profileCode: 'codes',
        module: 'codes',
        fileName: dto.fileName ?? `codes_import.${format}`,
        format,
        duplicateStrategy,
        columnMapping: dto.columnMapping ?? null,
        totalRows: codeResult.totalRows,
        actorId: actorId ?? null,
        status: codeResult.failedCount > 0 ? 'PARTIAL' : 'COMPLETED',
      });
      const updated =
        this.importRegistry.updateImportHistory(started.id, {
          status: codeResult.failedCount > 0 ? 'PARTIAL' : 'COMPLETED',
          totalRows: codeResult.totalRows,
          processedRows: codeResult.totalRows,
          createdCount: codeResult.importedCount,
          updatedCount: 0,
          skippedCount: codeResult.skippedCount,
          failedCount: codeResult.failedCount,
        }) ?? started;
      await this.persistHistoryRecordToDb(updated);

      return {
        totalRows: codeResult.totalRows,
        importedCount: codeResult.importedCount,
        updatedCount: 0,
        successCount: codeResult.importedCount,
        skippedCount: codeResult.skippedCount,
        failedCount: codeResult.failedCount,
        remainingCount: 0,
        duplicateStrategy,
        historyId: updated.id,
        jobId: updated.jobId,
        status: updated.status,
        importedUserIds: [],
        updatedUserIds: [],
        errors: codeResult.errors.map((e) => ({
          row: e.row,
          identifier: e.identifier,
          message: e.message,
        })),
      };
    }

    throw new NotFoundAppException('imports.profileNotFound', { profileCode: cleanProfile });
  }

  /** 8.2.8 — Xem tiến độ Import theo `jobId` hoặc `historyId` */
  public getJobProgress(jobIdOrHistoryId: string | number): ImportProgressSnapshot {
    const progress = this.importRegistry.getProgress(jobIdOrHistoryId);
    if (!progress) {
      throw new NotFoundAppException('imports.importJobNotFound', { id: jobIdOrHistoryId });
    }
    return progress;
  }

  /** 8.2.9 — Truy vấn danh sách lịch sử Import (kết hợp Database `import_histories` & Registry) */
  public async listHistories(query?: ListImportHistoriesQuery): Promise<ImportHistoryRecord[]> {
    const filter: ImportHistoryQueryFilter = {
      ...(query?.profileCode ? { profileCode: query.profileCode } : {}),
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query?.status ? { status: query.status } : {}),
      ...(query?.limit !== undefined ? { limit: query.limit } : {}),
    };

    const memList = this.importRegistry.listHistories(filter);
    if (!this.historyRepository) {
      return memList;
    }

    const dbEntities = await this.historyRepository.listFiltered(filter).catch(() => []);
    if (dbEntities.length === 0) {
      return memList;
    }

    const byId = new Map<number, ImportHistoryRecord>();
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

  /** 8.2.9 — Xem chi tiết 1 bản ghi lịch sử Import theo ID */
  public async getHistoryById(historyId: number): Promise<ImportHistoryRecord> {
    const mem = this.importRegistry.getHistoryById(historyId);
    if (mem) {
      return mem;
    }

    if (this.historyRepository) {
      const entity = await this.historyRepository.findById(historyId).catch(() => null);
      if (entity) {
        return this.mapEntityToRecord(entity);
      }
    }

    throw new NotFoundAppException('imports.importHistoryNotFound', { id: historyId });
  }

  /** Cập nhật thông tin hoặc trạng thái của một bản ghi lịch sử Import (Sửa) */
  public async updateHistory(
    historyId: number,
    patch: UpdateImportHistoryRequest,
  ): Promise<ImportHistoryRecord> {
    const updatedMem = this.importRegistry.updateImportHistory(historyId, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.totalRows !== undefined ? { totalRows: patch.totalRows } : {}),
      ...(patch.processedRows !== undefined ? { processedRows: patch.processedRows } : {}),
      ...(patch.createdCount !== undefined ? { createdCount: patch.createdCount } : {}),
      ...(patch.updatedCount !== undefined ? { updatedCount: patch.updatedCount } : {}),
      ...(patch.skippedCount !== undefined ? { skippedCount: patch.skippedCount } : {}),
      ...(patch.failedCount !== undefined ? { failedCount: patch.failedCount } : {}),
      ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
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
          ...(patch.totalRows !== undefined ? { totalRows: patch.totalRows } : {}),
          ...(patch.processedRows !== undefined ? { processedRows: patch.processedRows } : {}),
          ...(patch.createdCount !== undefined ? { createdCount: patch.createdCount } : {}),
          ...(patch.updatedCount !== undefined ? { updatedCount: patch.updatedCount } : {}),
          ...(patch.skippedCount !== undefined ? { skippedCount: patch.skippedCount } : {}),
          ...(patch.failedCount !== undefined ? { failedCount: patch.failedCount } : {}),
          ...(patch.completedAt !== undefined
            ? { completedAt: patch.completedAt ? new Date(patch.completedAt) : null }
            : {}),
        })
        .catch(() => null);

      if (updatedDb) {
        return this.mapEntityToRecord(updatedDb);
      }
    }

    throw new NotFoundAppException('imports.importHistoryNotFound', { id: historyId });
  }

  /** Xóa một bản ghi lịch sử Import khỏi Registry và Database `import_histories` (Xóa) */
  public async deleteHistory(historyId: number): Promise<{
    readonly deleted: true;
    readonly id: number;
  }> {
    const deletedMem = this.importRegistry.deleteHistory(historyId);
    const deletedDb = this.historyRepository
      ? await this.historyRepository.deleteById(historyId).catch(() => false)
      : false;

    if (!deletedMem && !deletedDb) {
      throw new NotFoundAppException('imports.importHistoryNotFound', { id: historyId });
    }

    return { deleted: true, id: historyId };
  }

  /** Đồng bộ bản ghi lịch sử từ `ImportRegistryService` xuống bảng `import_histories` */
  public async persistHistoryRecordToDb(record: ImportHistoryRecord): Promise<void> {
    if (!this.historyRepository) return;
    try {
      const existing = record.jobId
        ? await this.historyRepository.findByJobId(record.jobId)
        : await this.historyRepository.findById(record.id);

      await this.historyRepository.saveEntity({
        ...(existing ? { id: existing.id } : {}),
        profileCode: record.profileCode,
        module: record.module,
        fileName: record.fileName,
        format: record.format,
        duplicateStrategy: record.duplicateStrategy,
        columnMappingJson: record.columnMapping ? JSON.stringify(record.columnMapping) : null,
        status: record.status,
        jobId: record.jobId,
        actorId: record.actorId,
        totalRows: record.totalRows,
        processedRows: record.processedRows,
        createdCount: record.createdCount,
        updatedCount: record.updatedCount,
        skippedCount: record.skippedCount,
        failedCount: record.failedCount,
        errorsJson: JSON.stringify(record.errors ?? []),
        startedAt: new Date(record.createdAt),
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
      });
    } catch {
      // Fallback an toàn khi chạy môi trường test in-memory không bật DB
    }
  }

  private mapEntityToRecord(entity: ImportHistoryEntity): ImportHistoryRecord {
    const errors = safeJsonParse<ImportCellIssue[]>(entity.errorsJson, []) ?? [];
    const columnMapping = entity.columnMappingJson
      ? safeJsonParseObject<Record<string, string | number | null>>(entity.columnMappingJson)
      : null;

    return {
      id: Number(entity.id),
      jobId: entity.jobId,
      profileCode: entity.profileCode,
      module: entity.module,
      fileName: entity.fileName,
      format: entity.format,
      duplicateStrategy: entity.duplicateStrategy,
      columnMapping,
      actorId: entity.actorId,
      status: entity.status,
      totalRows: entity.totalRows,
      processedRows: entity.processedRows,
      successCount: entity.createdCount + entity.updatedCount,
      createdCount: entity.createdCount,
      updatedCount: entity.updatedCount,
      skippedCount: entity.skippedCount,
      failedCount: entity.failedCount,
      remainingRows: Math.max(0, entity.totalRows - entity.processedRows),
      errors,
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
