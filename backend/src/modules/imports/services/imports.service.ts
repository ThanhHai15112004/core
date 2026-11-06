import { Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import {
  BadRequestAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
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
  type ImportDuplicateStrategy,
  type ImportHistoryQueryFilter,
  type ImportHistoryRecord,
  type ImportPreviewResult,
  type ImportProfileHandler,
  type ImportProgressSnapshot,
  type ImportTemplateFileResult,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
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

interface LegacyUserImportAdapter {
  previewImport(dto: Readonly<Record<string, unknown>>): Promise<ImportPreviewResult>;
  bulkImport(
    dto: Readonly<Record<string, unknown>>,
    actorId?: number,
  ): Promise<Readonly<Record<string, unknown>>>;
}

interface LegacyUserExportTemplateAdapter {
  exportImportTemplate(format?: 'csv' | 'xlsx'): ImportTemplateFileResult;
}

interface LegacyOrgImportAdapter {
  exportImportTemplate(format?: 'csv' | 'xlsx'): ImportTemplateFileResult;
  bulkImportUnits(
    dto: Readonly<Record<string, unknown>>,
    actorId?: number,
    options?: { readonly skipHistoryRecord?: boolean },
  ): Promise<Readonly<Record<string, unknown>>>;
}

interface LegacyCodesImportAdapter {
  exportImportTemplate(format?: 'csv' | 'xlsx'): ImportTemplateFileResult;
  bulkImportCodeValues(
    dto: Readonly<Record<string, unknown>>,
    typeCode?: string,
    actorId?: number,
    options?: { readonly skipHistoryRecord?: boolean },
  ): Promise<Readonly<Record<string, unknown>>>;
}

const DEFAULT_FALLBACK_ROW_SCHEMA = z.record(z.string(), z.unknown());

@Injectable()
export class ImportsService implements IImportsPublicService {
  private readonly importRegistry: ImportRegistryService;
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    @Optional() private readonly historyRepository?: ImportHistoryRepository,
    @Optional() importRegistry?: ImportRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly userImportService?: LegacyUserImportAdapter,
    @Optional() private readonly userExportService?: LegacyUserExportTemplateAdapter,
    @Optional() private readonly organizationsService?: LegacyOrgImportAdapter,
    @Optional() private readonly codesService?: LegacyCodesImportAdapter,
  ) {
    this.importRegistry = importRegistry ?? defaultImportRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.ensureDefaultProfilesRegistered();
  }

  private ensureDefaultProfilesRegistered(): void {
    const existingUsers =
      this.importRegistry.getProfile('users') ?? defaultImportRegistry.getProfile('users');
    if (
      (!existingUsers || !existingUsers.executeImport || !existingUsers.exportTemplate) &&
      (this.userImportService || this.userExportService)
    ) {
      this.importRegistry.registerProfile({
        profileCode: 'users',
        module: 'users',
        columns: existingUsers?.columns ?? [
          { field: 'username', header: 'username', required: true },
          { field: 'email', header: 'email', required: true },
        ],
        rowSchema: existingUsers?.rowSchema ?? DEFAULT_FALLBACK_ROW_SCHEMA,
        uniqueKeyFields: existingUsers?.uniqueKeyFields ?? ['email', 'username'],
        requiredPermission: 'users.import',
        ...(existingUsers?.findExistingDuplicates
          ? { findExistingDuplicates: existingUsers.findExistingDuplicates }
          : {}),
        ...(this.userExportService
          ? {
              exportTemplate: (format: 'csv' | 'xlsx') =>
                this.userExportService!.exportImportTemplate(format),
            }
          : existingUsers?.exportTemplate
            ? { exportTemplate: existingUsers.exportTemplate }
            : {}),
        ...(this.userImportService
          ? {
              previewImport: (dto) =>
                this.userImportService!.previewImport({
                  ...(dto.items ? { items: dto.items } : {}),
                  ...(dto.csvContent ? { csvContent: dto.csvContent } : {}),
                  ...(dto.xlsxBase64 ? { xlsxBase64: dto.xlsxBase64 } : {}),
                  ...(dto.columnMapping ? { columnMapping: dto.columnMapping } : {}),
                  ...(dto.duplicateStrategy ? { duplicateStrategy: dto.duplicateStrategy } : {}),
                  skipDuplicates: dto.skipDuplicates ?? true,
                  previewLimit: dto.previewLimit ?? 20,
                }),
              executeImport: async (dto, actorId) =>
                await this.userImportService!.bulkImport(
                  {
                    ...(dto['items'] ? { items: dto['items'] } : {}),
                    ...(typeof dto['csvContent'] === 'string'
                      ? { csvContent: dto['csvContent'] }
                      : {}),
                    ...(typeof dto['xlsxBase64'] === 'string'
                      ? { xlsxBase64: dto['xlsxBase64'] }
                      : {}),
                    ...(typeof dto['fileName'] === 'string' ? { fileName: dto['fileName'] } : {}),
                    ...(dto['columnMapping']
                      ? {
                          columnMapping: dto['columnMapping'] as Record<
                            string,
                            string | number | null
                          >,
                        }
                      : {}),
                    ...(typeof dto['duplicateStrategy'] === 'string'
                      ? {
                          duplicateStrategy: dto['duplicateStrategy'] as ImportDuplicateStrategy,
                        }
                      : {}),
                    skipDuplicates:
                      typeof dto['skipDuplicates'] === 'boolean' ? dto['skipDuplicates'] : true,
                    ...(typeof dto['defaultPassword'] === 'string'
                      ? { defaultPassword: dto['defaultPassword'] }
                      : {}),
                    async: dto['async'] === true,
                  },
                  actorId,
                ),
            }
          : {}),
      });
    }

    const existingOrgs =
      this.importRegistry.getProfile('organizations') ??
      defaultImportRegistry.getProfile('organizations');
    if (this.organizationsService && (!existingOrgs || !existingOrgs.executeImport)) {
      this.importRegistry.registerProfile({
        profileCode: 'organizations',
        module: 'organizations',
        uniqueKeyFields: existingOrgs?.uniqueKeyFields ?? ['code'],
        requiredPermission: 'organizations.manage',
        columns: existingOrgs?.columns ?? [
          { field: 'code', header: 'code', required: true },
          { field: 'name', header: 'name', required: true },
        ],
        rowSchema: existingOrgs?.rowSchema ?? DEFAULT_FALLBACK_ROW_SCHEMA,
        exportTemplate: (format: 'csv' | 'xlsx') =>
          this.organizationsService!.exportImportTemplate(format),
        executeImport: async (dto, actorId) =>
          await this.organizationsService!.bulkImportUnits(
            {
              ...(dto['items'] ? { items: dto['items'] } : {}),
              ...(typeof dto['csvContent'] === 'string' ? { csvContent: dto['csvContent'] } : {}),
              ...(typeof dto['xlsxBase64'] === 'string' ? { xlsxBase64: dto['xlsxBase64'] } : {}),
              skipDuplicates:
                typeof dto['skipDuplicates'] === 'boolean' ? dto['skipDuplicates'] : true,
            },
            actorId,
            { skipHistoryRecord: true },
          ),
      });
    }

    const existingCodes =
      this.importRegistry.getProfile('codes') ?? defaultImportRegistry.getProfile('codes');
    if (this.codesService && (!existingCodes || !existingCodes.executeImport)) {
      this.importRegistry.registerProfile({
        profileCode: 'codes',
        module: 'codes',
        uniqueKeyFields: existingCodes?.uniqueKeyFields ?? ['code'],
        requiredPermission: 'codes.manage',
        columns: existingCodes?.columns ?? [
          { field: 'typeCode', header: 'typeCode', required: true },
          { field: 'code', header: 'code', required: true },
        ],
        rowSchema: existingCodes?.rowSchema ?? DEFAULT_FALLBACK_ROW_SCHEMA,
        exportTemplate: (format: 'csv' | 'xlsx') => this.codesService!.exportImportTemplate(format),
        executeImport: async (dto, actorId) =>
          await this.codesService!.bulkImportCodeValues(
            {
              ...(dto['items'] ? { items: dto['items'] } : {}),
              ...(typeof dto['csvContent'] === 'string' ? { csvContent: dto['csvContent'] } : {}),
              ...(typeof dto['xlsxBase64'] === 'string' ? { xlsxBase64: dto['xlsxBase64'] } : {}),
              skipDuplicates:
                typeof dto['skipDuplicates'] === 'boolean' ? dto['skipDuplicates'] : true,
            },
            undefined,
            actorId,
            { skipHistoryRecord: true },
          ),
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
    const byCode = new Map<string, { readonly profileCode: string; readonly module: string }>();
    for (const p of defaultImportRegistry.listProfiles()) {
      byCode.set(p.profileCode, { profileCode: p.profileCode, module: p.module });
    }
    for (const p of this.importRegistry.listProfiles()) {
      byCode.set(p.profileCode, { profileCode: p.profileCode, module: p.module });
    }
    return [...byCode.values()];
  }

  /** Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) theo `profileCode` (Mục 8.2.1 & 8.2.2 — Điều phối thuần qua Registry) */
  public exportImportTemplate(
    profileCode: string,
    format: 'csv' | 'xlsx' = 'xlsx',
  ): ImportTemplateFileResult {
    this.ensureDefaultProfilesRegistered();
    const cleanProfile = profileCode.trim().toLowerCase();
    const profile =
      this.importRegistry.getProfile(cleanProfile) ??
      defaultImportRegistry.getProfile(cleanProfile);
    if (!profile) {
      throw new NotFoundAppException('imports.profileNotFound', { profileCode: cleanProfile });
    }

    if (typeof profile.exportTemplate === 'function') {
      const customResult = profile.exportTemplate(format);
      if (!(customResult instanceof Promise)) {
        return customResult;
      }
    }

    return buildImportTemplateFile({
      fileBaseName: `mau_import_${cleanProfile}`,
      format,
      columns: profile.columns,
    });
  }

  /**
   * 8.2.3, 8.2.4, 8.2.5 — Xem trước dữ liệu trước khi nhập (Preview / Dry-run):
   * Ánh xạ cột (`columnMapping`), dòng mẫu và kiểm tra lỗi theo từng dòng/cột (điều phối qua `ImportRegistryService`).
   */
  public async previewImport(
    profileCode: string,
    dto: PreviewImportRequest,
  ): Promise<ImportPreviewResult> {
    this.ensureDefaultProfilesRegistered();
    const cleanProfile = profileCode.trim().toLowerCase();
    const defaultPreviewLimit = this.settingRegistry.getNumber(
      'imports.preview_sample_limit',
      undefined,
      20,
    );

    const profile =
      this.importRegistry.getProfile(cleanProfile) ??
      defaultImportRegistry.getProfile(cleanProfile);
    if (!profile) {
      throw new NotFoundAppException('imports.profileNotFound', { profileCode: cleanProfile });
    }

    if (typeof profile.previewImport === 'function') {
      return profile.previewImport({
        ...(dto.items ? { items: dto.items } : {}),
        ...(dto.csvContent ? { csvContent: dto.csvContent } : {}),
        ...(dto.xlsxBase64 ? { xlsxBase64: dto.xlsxBase64 } : {}),
        ...(dto.columnMapping ? { columnMapping: dto.columnMapping } : {}),
        ...(dto.duplicateStrategy ? { duplicateStrategy: dto.duplicateStrategy } : {}),
        skipDuplicates: dto.skipDuplicates ?? true,
        previewLimit: dto.previewLimit ?? defaultPreviewLimit,
      });
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
   * 8.2.1 → 8.2.9 — Thực thi Nhập dữ liệu hàng loạt theo `profileCode` qua `ImportRegistryService`
   * và đồng bộ bản ghi lịch sử vào bảng Database `import_histories`.
   */
  public async executeImport(
    profileCode: string,
    dto: ExecuteImportRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<ExecuteImportResultResponse> {
    this.ensureDefaultProfilesRegistered();
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

    const profile =
      this.importRegistry.getProfile(cleanProfile) ??
      defaultImportRegistry.getProfile(cleanProfile);
    if (!profile || typeof profile.executeImport !== 'function') {
      throw new NotFoundAppException('imports.profileNotFound', { profileCode: cleanProfile });
    }

    this.assertProfilePermission(profile.requiredPermission, actor);

    const rawResult = await profile.executeImport(
      dto as unknown as Readonly<Record<string, unknown>>,
      actorId ?? actor?.id,
      actor,
    );

    if (typeof rawResult['historyId'] === 'number') {
      const memRecord =
        this.importRegistry.getHistoryById(rawResult['historyId']) ??
        defaultImportRegistry.getHistoryById(rawResult['historyId']);
      if (memRecord) {
        await this.persistHistoryRecordToDb(memRecord);
      }
      return rawResult as unknown as ExecuteImportResultResponse;
    }

    const duplicateStrategy = resolveImportDuplicateStrategy(
      dto.duplicateStrategy,
      dto.skipDuplicates,
    );
    const format = dto.xlsxBase64 ? 'xlsx' : dto.csvContent ? 'csv' : 'json';
    const totalRows = Number(rawResult['totalRows'] ?? 0);
    const importedCount = Number(rawResult['importedCount'] ?? 0);
    const updatedCount = Number(rawResult['updatedCount'] ?? 0);
    const skippedCount = Number(rawResult['skippedCount'] ?? 0);
    const failedCount = Number(rawResult['failedCount'] ?? 0);
    const rawErrors = Array.isArray(rawResult['errors'])
      ? (rawResult['errors'] as ReadonlyArray<{
          readonly row: number;
          readonly identifier?: string;
          readonly message: string;
        }>)
      : [];

    const started = this.importRegistry.startImportHistory({
      profileCode: profile.profileCode,
      module: profile.module,
      fileName: dto.fileName ?? `${profile.profileCode}_import.${format}`,
      format,
      duplicateStrategy,
      columnMapping: dto.columnMapping ?? null,
      totalRows,
      actorId: actorId ?? actor?.id ?? null,
      status: failedCount > 0 ? 'PARTIAL' : 'COMPLETED',
    });
    const updated =
      this.importRegistry.updateImportHistory(started.id, {
        status: failedCount > 0 ? 'PARTIAL' : 'COMPLETED',
        totalRows,
        processedRows: totalRows,
        createdCount: importedCount,
        updatedCount,
        skippedCount,
        failedCount,
      }) ?? started;
    await this.persistHistoryRecordToDb(updated);

    return {
      totalRows,
      importedCount,
      updatedCount,
      successCount: importedCount + updatedCount,
      skippedCount,
      failedCount,
      remainingCount: 0,
      duplicateStrategy,
      historyId: updated.id,
      jobId: updated.jobId,
      status: updated.status,
      importedUserIds: [],
      updatedUserIds: [],
      errors: rawErrors.map((e) => ({
        row: e.row,
        identifier: e.identifier ?? '',
        message: e.message,
      })),
    };
  }

  private assertProfilePermission(requiredPermission?: string, actor?: UserIdentity): void {
    if (!requiredPermission || !actor || !Array.isArray(actor.permissions)) {
      return;
    }
    const perms = new Set(actor.permissions);
    if (
      perms.has('*') ||
      perms.has('system.admin') ||
      perms.has('imports.execute') ||
      perms.has('imports.manage') ||
      perms.has(requiredPermission)
    ) {
      return;
    }
    throw new ForbiddenAppException(HTTP_ERROR_CODE.FORBIDDEN, [
      {
        requiredPermissions: ['imports.execute', requiredPermission],
        missingPermissions: [requiredPermission],
      },
    ]);
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
