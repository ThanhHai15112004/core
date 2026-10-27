import { describe, expect, it } from '@jest/globals';
import {
  ExportRegistryService,
  ImportRegistryService,
  ReportRegistryService,
  SearchRegistryService,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import { ImportsController, ImportsService } from '@modules/imports/index.js';
import type { ImportHistoryEntity } from '@modules/imports/entities/import-history.entity.js';
import type { ImportHistoryRepository } from '@modules/imports/repositories/import-history.repository.js';
import { ExportsController, ExportsService } from '@modules/exports/index.js';
import type { ExportHistoryEntity } from '@modules/exports/entities/export-history.entity.js';
import type { ExportHistoryRepository } from '@modules/exports/repositories/export-history.repository.js';
import { ReportsController, ReportsService } from '@modules/reports/index.js';
import type { ReportHistoryEntity } from '@modules/reports/entities/report-history.entity.js';
import type { ReportScheduleEntity } from '@modules/reports/entities/report-schedule.entity.js';
import type { ReportHistoryRepository } from '@modules/reports/repositories/report-history.repository.js';
import type { ReportScheduleRepository } from '@modules/reports/repositories/report-schedule.repository.js';
import { SearchController, SearchService } from '@modules/search/index.js';
import type { SearchDocumentEntity } from '@modules/search/entities/search-document.entity.js';
import type { SearchSyncHistoryEntity } from '@modules/search/entities/search-sync-history.entity.js';
import type { SearchZeroResultKeywordEntity } from '@modules/search/entities/search-zero-result-keyword.entity.js';
import type { SearchDocumentRepository } from '@modules/search/repositories/search-document.repository.js';
import type { SearchSyncHistoryRepository } from '@modules/search/repositories/search-sync-history.repository.js';
import type { SearchZeroResultKeywordRepository } from '@modules/search/repositories/search-zero-result-keyword.repository.js';

describe('Phase 8 Standalone Modules: imports (8.2), exports (8.3), reports (8.4) & search (8.5) with DB Persistence', () => {
  it('8.2 — ImportsModule (ImportsController & ImportsService) executes preview, import, template & persists import_histories in DB', async () => {
    const importRegistry = new ImportRegistryService();
    const settingRegistry = new SettingRegistryService();
    const dbStore = new Map<number, ImportHistoryEntity>();
    let seq = 0;

    const fakeHistoryRepo = {
      findById: async (id: number) => dbStore.get(Number(id)) ?? null,
      findByJobId: async (jobId: string) =>
        [...dbStore.values()].find((item) => item.jobId === jobId) ?? null,
      listFiltered: async () => [...dbStore.values()].sort((a, b) => b.id - a.id),
      updateById: async (id: number, patch: Partial<ImportHistoryEntity>) => {
        const existing = dbStore.get(Number(id));
        if (!existing) return null;
        const next = { ...existing, ...patch } as ImportHistoryEntity;
        dbStore.set(Number(id), next);
        return next;
      },
      deleteById: async (id: number) => dbStore.delete(Number(id)),
      saveEntity: async (partial: Partial<ImportHistoryEntity>) => {
        const id = partial.id ?? ++seq;
        const entity = {
          id,
          profileCode: partial.profileCode ?? 'users',
          module: partial.module ?? 'users',
          fileName: partial.fileName ?? 'users.xlsx',
          format: partial.format ?? 'xlsx',
          duplicateStrategy: partial.duplicateStrategy ?? 'SKIP',
          columnMappingJson: partial.columnMappingJson ?? null,
          status: partial.status ?? 'COMPLETED',
          jobId: partial.jobId ?? null,
          actorId: partial.actorId ?? 1,
          totalRows: partial.totalRows ?? 1,
          processedRows: partial.processedRows ?? 1,
          createdCount: partial.createdCount ?? 1,
          updatedCount: partial.updatedCount ?? 0,
          skippedCount: partial.skippedCount ?? 0,
          failedCount: partial.failedCount ?? 0,
          errorsJson: partial.errorsJson ?? '[]',
          startedAt: partial.startedAt ?? new Date(),
          completedAt: partial.completedAt ?? new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as ImportHistoryEntity;
        dbStore.set(id, entity);
        return entity;
      },
    } as unknown as ImportHistoryRepository;

    const fakeUserImportService = {
      previewImport: async () => ({
        profileCode: 'users',
        duplicateStrategy: 'SKIP' as const,
        totalRows: 1,
        validRowsCount: 1,
        invalidRowsCount: 0,
        toCreateCount: 1,
        toUpdateCount: 0,
        toSkipCount: 0,
        toRejectCount: 0,
        mapping: {
          headers: ['username', 'email'],
          matches: [],
          unmappedHeaders: [],
          missingRequiredFields: [],
        },
        sampleRows: [],
        issues: [],
      }),
      bulkImport: async (_dto: unknown, actorId?: number) => {
        const hist = importRegistry.startImportHistory({
          profileCode: 'users',
          module: 'users',
          fileName: 'nhan_su.xlsx',
          format: 'xlsx',
          duplicateStrategy: 'SKIP',
          totalRows: 2,
          actorId: actorId ?? 1,
          status: 'COMPLETED',
        });
        importRegistry.updateImportHistory(hist.id, {
          status: 'COMPLETED',
          processedRows: 2,
          createdCount: 2,
          completedAt: new Date().toISOString(),
        });
        return {
          totalRows: 2,
          importedCount: 2,
          updatedCount: 0,
          successCount: 2,
          skippedCount: 0,
          failedCount: 0,
          remainingCount: 0,
          duplicateStrategy: 'SKIP' as const,
          historyId: hist.id,
          jobId: hist.jobId,
          status: 'COMPLETED' as const,
          importedUserIds: [101, 102],
          updatedUserIds: [],
          errors: [],
        };
      },
    };

    const fakeUserExportService = {
      exportImportTemplate: (format: 'csv' | 'xlsx' = 'xlsx') => ({
        fileName: `mau_import_nhan_vien.${format}`,
        contentType: 'text/csv; charset=utf-8',
        format,
        totalExported: 2,
        csvContent: 'username,email',
        xlsxBase64: 'UEsDBBQAAAAIA===',
      }),
    };

    const importsService = new ImportsService(
      fakeHistoryRepo,
      importRegistry,
      settingRegistry,
      fakeUserImportService as never,
      fakeUserExportService as never,
    );
    const controller = new ImportsController(importsService);

    const tpl = controller.exportImportTemplate('users', { format: 'csv', includeSamples: true });
    expect(tpl.fileName).toBe('mau_import_nhan_vien.csv');

    const preview = await controller.previewImport('users', {
      skipDuplicates: true,
      previewLimit: 10,
    });
    expect(preview.profileCode).toBe('users');

    const execRes = await controller.executeImport(
      'users',
      {
        csvContent: 'username,email\nu1,u1@core.vn',
        skipDuplicates: true,
        async: false,
      },
      { id: 7, roles: ['admin'], permissions: ['users.import'] },
    );
    expect(execRes.importedCount).toBe(2);
    expect(dbStore.size).toBe(1);

    const histories = await controller.listImportHistories({});
    expect(histories.length).toBeGreaterThanOrEqual(1);
    expect(histories[0]?.fileName).toBe('nhan_su.xlsx');

    // Test Update & Delete Import History
    const updatedHist = await controller.updateImportHistory(execRes.historyId!, {
      status: 'PARTIAL',
      failedCount: 1,
    });
    expect(updatedHist.status).toBe('PARTIAL');
    expect(updatedHist.failedCount).toBe(1);

    const deletedHist = await controller.deleteImportHistory(execRes.historyId!);
    expect(deletedHist).toEqual({ deleted: true, id: execRes.historyId });
    expect(dbStore.size).toBe(0);
  });

  it('8.3 — ExportsModule (ExportsController & ExportsService) executes export, stores DB history & serves temporary download at /api/v1/exports/downloads/:token', async () => {
    const exportRegistry = new ExportRegistryService();
    const dbStore = new Map<number, ExportHistoryEntity>();
    let seq = 0;

    const fakeExportHistoryRepo = {
      findById: async (id: number) => dbStore.get(Number(id)) ?? null,
      findByToken: async (token: string) =>
        [...dbStore.values()].find((item) => item.downloadToken === token) ?? null,
      findByJobId: async (jobId: string) =>
        [...dbStore.values()].find((item) => item.jobId === jobId) ?? null,
      listFiltered: async () => [...dbStore.values()].sort((a, b) => b.id - a.id),
      updateById: async (id: number, patch: Partial<ExportHistoryEntity>) => {
        const existing = dbStore.get(Number(id));
        if (!existing) return null;
        const next = { ...existing, ...patch } as ExportHistoryEntity;
        dbStore.set(Number(id), next);
        return next;
      },
      deleteById: async (id: number) => dbStore.delete(Number(id)),
      markExpiredByNow: async () => 0,
      saveEntity: async (partial: Partial<ExportHistoryEntity>) => {
        const id = partial.id ?? ++seq;
        const entity = {
          id,
          profileCode: partial.profileCode ?? 'users',
          module: partial.module ?? 'users',
          fileName: partial.fileName ?? 'users.csv',
          format: partial.format ?? 'csv',
          status: partial.status ?? 'COMPLETED',
          jobId: partial.jobId ?? null,
          actorId: partial.actorId ?? 1,
          filtersJson: partial.filtersJson ?? '{}',
          totalExported: partial.totalExported ?? 1,
          processedRows: partial.processedRows ?? 1,
          maxRowsApplied: partial.maxRowsApplied ?? 5000,
          downloadToken: partial.downloadToken ?? null,
          downloadUrl: partial.downloadUrl ?? null,
          contentType: partial.contentType ?? 'text/csv; charset=utf-8',
          fileSizeBytes: partial.fileSizeBytes ?? 12,
          filePayloadBase64: partial.filePayloadBase64 ?? null,
          expiresAt: partial.expiresAt ?? new Date(Date.now() + 3600_000),
          isExpired: partial.isExpired ?? false,
          notifiedAt: partial.notifiedAt ?? null,
          errorMessage: partial.errorMessage ?? null,
          startedAt: partial.startedAt ?? new Date(),
          completedAt: partial.completedAt ?? new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as ExportHistoryEntity;
        dbStore.set(id, entity);
        return entity;
      },
    } as unknown as ExportHistoryRepository;

    const fakeUserExportService = {
      exportUsersCsv: async () => {
        const hist = exportRegistry.startExportHistory({
          profileCode: 'users',
          module: 'users',
          fileName: 'danh_sach_nhan_vien.csv',
          format: 'csv',
          actorId: 9,
          totalExported: 3,
          status: 'COMPLETED',
        });
        const artifact = exportRegistry.storeTemporaryArtifact({
          profileCode: 'users',
          module: 'users',
          fileName: 'danh_sach_nhan_vien.csv',
          format: 'csv',
          totalExported: 3,
          buffer: Buffer.from('id,username\n1,admin', 'utf8'),
          historyId: hist.id,
          ttlSeconds: 3600,
          baseDownloadPath: '/api/v1/exports/downloads',
        });
        return {
          fileName: 'danh_sach_nhan_vien.csv',
          contentType: 'text/csv; charset=utf-8',
          format: 'csv' as const,
          totalExported: 3,
          csvContent: 'id,username\n1,admin',
          xlsxBase64: '',
          historyId: hist.id,
          jobId: hist.jobId,
          status: 'COMPLETED' as const,
          downloadToken: artifact.token,
          downloadUrl: artifact.downloadUrl,
          expiresAt: artifact.expiresAt,
        };
      },
    };

    const exportsService = new ExportsService(
      fakeExportHistoryRepo,
      exportRegistry,
      fakeUserExportService as never,
    );
    const controller = new ExportsController(exportsService);

    const res = await controller.executeExport(
      'users',
      { sortBy: 'id', sortOrder: 'ASC', format: 'csv' } as never,
      { id: 9, roles: ['admin'], permissions: ['users.export'] },
    );

    expect(res.downloadUrl).toContain('/api/v1/exports/downloads/');
    expect(dbStore.size).toBe(1);

    const downloaded = await controller.downloadTemporaryExport(res.downloadToken!);
    expect(downloaded.csvContent).toContain('1,admin');

    const histories = await controller.listExportHistories({});
    expect(histories).toHaveLength(1);

    // Test Update & Delete Export History
    const updatedExport = await controller.updateExportHistory(res.historyId!, {
      fileName: 'danh_sach_cap_nhat.csv',
    });
    expect(updatedExport.fileName).toBe('danh_sach_cap_nhat.csv');

    const deletedExport = await controller.deleteExportHistory(res.historyId!);
    expect(deletedExport).toEqual({ deleted: true, id: res.historyId });
    expect(dbStore.size).toBe(0);
  });

  it('8.4 & 8.5 — ReportsModule & SearchModule persist schedules, histories, documents & zero-result keywords to DB repositories', async () => {
    const reportRegistry = new ReportRegistryService();
    const exportRegistry = new ExportRegistryService();
    const scheduleStore = new Map<number, ReportScheduleEntity>();
    const reportHistoryStore = new Map<number, ReportHistoryEntity>();
    let schedSeq = 0;

    reportRegistry.registerReport({
      code: 'users.summary_dashboard',
      module: 'users',
      name: 'Báo cáo tổng hợp nhân sự',
      category: 'DASHBOARD',
      requiredPermission: 'users.report',
    });

    const fakeScheduleRepo = {
      findById: async (id: number) => scheduleStore.get(Number(id)) ?? null,
      listFiltered: async () => [...scheduleStore.values()],
      updateById: async (id: number, patch: Partial<ReportScheduleEntity>) => {
        const existing = scheduleStore.get(Number(id));
        if (!existing) return null;
        const next = { ...existing, ...patch } as ReportScheduleEntity;
        scheduleStore.set(Number(id), next);
        return next;
      },
      deleteById: async (id: number) => scheduleStore.delete(Number(id)),
      saveEntity: async (partial: Partial<ReportScheduleEntity>) => {
        const id = partial.id ?? ++schedSeq;
        const entity = {
          id,
          ...partial,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ReportScheduleEntity;
        scheduleStore.set(id, entity);
        return entity;
      },
    } as unknown as ReportScheduleRepository;

    const fakeReportHistoryRepo = {
      findById: async (id: number) => reportHistoryStore.get(Number(id)) ?? null,
      findByToken: async () => null,
      listFiltered: async () => [...reportHistoryStore.values()],
      deleteById: async (id: number) => reportHistoryStore.delete(Number(id)),
      saveEntity: async (partial: Partial<ReportHistoryEntity>) => {
        const id = partial.id ?? 1;
        const entity = { id, ...partial } as ReportHistoryEntity;
        reportHistoryStore.set(id, entity);
        return entity;
      },
    } as unknown as ReportHistoryRepository;

    const reportsService = new ReportsService(
      fakeScheduleRepo,
      fakeReportHistoryRepo,
      reportRegistry,
      exportRegistry,
    );
    const reportsController = new ReportsController(reportsService);

    const createdSchedule = await reportsController.createReportSchedule(
      {
        reportCode: 'users.summary_dashboard',
        name: 'Báo cáo sáng thứ 2',
        frequency: 'WEEKLY',
        hour: 8,
        minute: 0,
        dayOfWeek: 1,
        format: 'xlsx',
        isActive: true,
      },
      { id: 1, email: 'admin@core.vn', roles: ['admin'], permissions: ['users.report'] },
    );
    expect(createdSchedule.cronExpression).toBe('0 8 * * 1');
    expect(scheduleStore.size).toBe(1);

    // Test Get, Update & Delete Report Schedule
    const fetchedSchedule = await reportsController.getReportScheduleById(createdSchedule.id);
    expect(fetchedSchedule.name).toBe('Báo cáo sáng thứ 2');

    const updatedSchedule = await reportsController.updateReportSchedule(createdSchedule.id, {
      name: 'Báo cáo 9h sáng hàng ngày',
      frequency: 'DAILY',
      hour: 9,
      minute: 30,
      isActive: false,
    });
    expect(updatedSchedule.name).toBe('Báo cáo 9h sáng hàng ngày');
    expect(updatedSchedule.frequency).toBe('DAILY');
    expect(updatedSchedule.cronExpression).toBe('30 9 * * *');
    expect(updatedSchedule.isActive).toBe(false);

    const deletedSchedule = await reportsController.deleteReportSchedule(createdSchedule.id);
    expect(deletedSchedule).toEqual({ deleted: true, id: createdSchedule.id });
    expect(scheduleStore.size).toBe(0);

    // 8.5 SearchModule
    const searchRegistry = new SearchRegistryService();
    const docStore = new Map<string, SearchDocumentEntity>();
    const syncStore = new Map<number, SearchSyncHistoryEntity>();
    const zeroStore = new Map<string, SearchZeroResultKeywordEntity>();

    const fakeDocRepo = {
      findByDocumentKey: async (key: string) => docStore.get(key) ?? null,
      deleteByEntityAndIds: async (entityCode: string, ids?: readonly (string | number)[]) => {
        let count = 0;
        for (const id of ids ?? []) {
          if (docStore.delete(`${entityCode.toLowerCase()}:${id}`)) count++;
        }
        return count;
      },
      deleteByFilter: async () => {
        const size = docStore.size;
        docStore.clear();
        return size;
      },
      saveEntity: async (partial: Partial<SearchDocumentEntity>) => {
        const entity = { id: 1, ...partial } as SearchDocumentEntity;
        docStore.set(entity.documentKey, entity);
        return entity;
      },
    } as unknown as SearchDocumentRepository;

    const fakeSyncRepo = {
      findById: async (id: number) => syncStore.get(Number(id)) ?? null,
      listFiltered: async () => [...syncStore.values()],
      deleteById: async (id: number) => syncStore.delete(Number(id)),
      saveEntity: async (partial: Partial<SearchSyncHistoryEntity>) => {
        const entity = { id: 1, ...partial } as SearchSyncHistoryEntity;
        syncStore.set(1, entity);
        return entity;
      },
    } as unknown as SearchSyncHistoryRepository;

    const fakeZeroRepo = {
      findByKeywordKey: async (key: string) => zeroStore.get(key) ?? null,
      listFiltered: async () => [...zeroStore.values()],
      deleteByIdOrKeyword: async (target: string | number) => {
        for (const [k, v] of zeroStore.entries()) {
          if (v.normalizedKeyword === String(target).toLowerCase()) {
            zeroStore.delete(k);
            return true;
          }
        }
        return false;
      },
      saveEntity: async (partial: Partial<SearchZeroResultKeywordEntity>) => {
        const entity = {
          id: 1,
          ...partial,
          firstSearchedAt: new Date(),
          lastSearchedAt: new Date(),
        } as SearchZeroResultKeywordEntity;
        zeroStore.set(entity.keywordKey, entity);
        return entity;
      },
    } as unknown as SearchZeroResultKeywordRepository;

    const searchService = new SearchService(
      fakeDocRepo,
      fakeSyncRepo,
      fakeZeroRepo,
      searchRegistry,
    );
    const searchController = new SearchController(searchService);

    // Test Index & Remove Search Documents
    const indexedRes = await searchController.indexSearchDocuments(
      {
        documents: [
          {
            id: 501,
            entityCode: 'users.account',
            module: 'users',
            entityType: 'user',
            title: 'Nguyễn Văn Đồng Bộ',
            subtitle: 'dongbo@core.vn',
          },
        ],
      },
      { id: 1, roles: ['admin'], permissions: ['users.update'] },
    );
    expect(indexedRes.indexedCount).toBe(1);
    expect(docStore.has('users.account:501')).toBe(true);

    const removedDoc = await searchController.removeSearchDocumentById('users.account', '501', {
      id: 1,
      roles: ['admin'],
      permissions: ['users.update'],
    });
    expect(removedDoc).toEqual({
      deleted: true,
      entityCode: 'users.account',
      removedCount: 1,
    });
    expect(docStore.has('users.account:501')).toBe(false);

    const searchRes = await searchController.searchGlobal(
      { keyword: 'khong_ton_tai_xyz_999', page: 1, limit: 10 },
      { id: 1, roles: ['admin'], permissions: ['users.read'] },
    );
    expect(searchRes.total).toBe(0);
    expect(zeroStore.size).toBe(1);

    const zeroKeywords = await searchController.listZeroResultKeywords({});
    expect(zeroKeywords[0]?.normalizedKeyword).toBe('khong_ton_tai_xyz_999');

    const deletedZero = await searchController.deleteZeroResultKeyword('khong_ton_tai_xyz_999');
    expect(deletedZero).toEqual({ deleted: true, target: 'khong_ton_tai_xyz_999' });
    expect(zeroStore.size).toBe(0);
  });
});
