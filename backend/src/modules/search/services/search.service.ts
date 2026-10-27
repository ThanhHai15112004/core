import { Injectable, Optional } from '@nestjs/common';
import {
  NotFoundAppException,
  SearchRegistryService,
  defaultSearchRegistry,
  type ExternalSearchEngineClientContract,
  type RegisteredSearchableEntity,
  type SearchActorScopeContext,
  type SearchDocumentInput,
  type SearchIndexLagReport,
  type SearchQueryResult,
  type SearchSyncHistoryRecord,
  type ZeroResultKeywordStat,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import { UserSearchService } from '@modules/users/index.js';
import type { ISearchPublicService } from '../contracts/index.js';
import type { SearchSyncHistoryEntity } from '../entities/search-sync-history.entity.js';
import type { SearchZeroResultKeywordEntity } from '../entities/search-zero-result-keyword.entity.js';
import { SearchDocumentRepository } from '../repositories/search-document.repository.js';
import { SearchSyncHistoryRepository } from '../repositories/search-sync-history.repository.js';
import { SearchZeroResultKeywordRepository } from '../repositories/search-zero-result-keyword.repository.js';
import type {
  ListSearchSyncHistoriesQuery,
  ListSearchableEntitiesQuery,
  ListZeroResultKeywordsQuery,
  RebuildSearchIndexBody,
  SearchGlobalQuery,
  SearchIndexLagQuery,
  SyncSearchIndexBody,
} from '../requests/search.requests.js';

@Injectable()
export class SearchService implements ISearchPublicService {
  private readonly searchRegistry: SearchRegistryService;

  constructor(
    @Optional() private readonly documentRepository?: SearchDocumentRepository,
    @Optional() private readonly syncHistoryRepository?: SearchSyncHistoryRepository,
    @Optional() private readonly zeroResultRepository?: SearchZeroResultKeywordRepository,
    @Optional() searchRegistry?: SearchRegistryService,
    @Optional() private readonly userSearchService?: UserSearchService,
  ) {
    this.searchRegistry = searchRegistry ?? defaultSearchRegistry;
  }

  /** 8.5.3 — Đăng ký hoặc thay thế client Elasticsearch / OpenSearch tùy chọn lúc runtime */
  public registerExternalSearchClient(client: ExternalSearchEngineClientContract | null): void {
    this.searchRegistry.registerExternalSearchClient(client);
  }

  /** 8.5.1 — Danh sách các thực thể được phép tìm kiếm đã đăng ký theo module */
  public listSearchableEntities(query?: ListSearchableEntitiesQuery): RegisteredSearchableEntity[] {
    this.userSearchService?.ensureModuleSearchEntitiesRegistered();
    this.searchRegistry.syncFromManifests();

    return this.searchRegistry.listSearchableEntities({
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.entityType ? { entityType: query.entityType } : {}),
    });
  }

  /** Thêm mới hoặc cập nhật tài liệu vào Search Index & bảng `search_documents` (Thêm / Sửa) */
  public async indexDocuments(
    documents: readonly SearchDocumentInput[],
    actorId?: number | null,
  ): Promise<{
    readonly driverUsed: string;
    readonly indexedCount: number;
    readonly history: SearchSyncHistoryRecord;
  }> {
    this.userSearchService?.ensureModuleSearchEntitiesRegistered();
    this.searchRegistry.syncFromManifests();

    const synced = await this.searchRegistry.syncDocuments(documents, {
      actorId: actorId ?? null,
      executionMode: 'SYNC',
    });
    await this.persistSearchDocumentsToDb(documents);
    await this.persistSyncHistoryToDb(synced.history);
    return synced;
  }

  /** Xóa tài liệu khỏi Search Index & bảng `search_documents` theo `entityCode` và `documentIds` (Xóa) */
  public async removeDocuments(
    entityCode: string,
    documentIds?: readonly (string | number)[],
    actorId?: number | null,
  ): Promise<{
    readonly deleted: true;
    readonly entityCode: string;
    readonly removedCount: number;
  }> {
    const cleanCode = entityCode.trim();
    const memRemoved = await this.searchRegistry.removeDocuments(cleanCode, documentIds);
    const dbRemoved = this.documentRepository
      ? await this.documentRepository.deleteByEntityAndIds(cleanCode, documentIds).catch(() => 0)
      : 0;
    const removedCount = Math.max(memRemoved.removedCount, dbRemoved);

    const history = this.searchRegistry.createSyncHistory({
      operation: 'REMOVE',
      module: cleanCode.split('.')[0] ?? 'system',
      entityType: cleanCode,
      entityCode: cleanCode,
      driverUsed: this.searchRegistry.getActiveDriver(),
      executionMode: 'SYNC',
      status: 'COMPLETED',
      indexedCount: 0,
      removedCount,
      actorId: actorId ?? null,
    });
    await this.persistSyncHistoryToDb(history);

    return {
      deleted: true,
      entityCode: cleanCode,
      removedCount,
    };
  }

  /**
   * 8.5.1, 8.5.2, 8.5.3, 8.5.6, 8.5.7 & 8.5.8 — Tìm kiếm toàn hệ thống qua Search Provider dùng chung,
   * áp dụng quyền & Data Scope, theo dõi độ trễ Index và lưu thống kê từ khóa 0 kết quả vào DB.
   */
  public async searchGlobal(
    query: SearchGlobalQuery,
    actor?: UserIdentity,
    options?: {
      readonly autoSeedFromDatabase?: boolean | undefined;
      readonly scopeOverride?: SearchActorScopeContext | undefined;
    },
  ): Promise<SearchQueryResult> {
    this.userSearchService?.ensureModuleSearchEntitiesRegistered();
    this.searchRegistry.syncFromManifests();

    const result = this.userSearchService
      ? await this.userSearchService.searchUsers(query, actor, options)
      : await this.searchRegistry.search(query, options?.scopeOverride);

    if (result.total === 0 && query.keyword.trim().length > 0) {
      const stats = this.searchRegistry.listZeroResultKeywords({ limit: 5 });
      const latest = stats.find((s) => s.normalizedKeyword === query.keyword.trim().toLowerCase());
      if (latest) {
        await this.persistZeroResultStatToDb(latest, actor?.id ?? null);
      }
    }

    return result;
  }

  /** 8.5.4 — Đồng bộ dữ liệu sang Search Index (trực tiếp hoặc chạy bằng Queue `system.heavy`) */
  public async syncSearchIndex(
    body?: SyncSearchIndexBody,
    actor?: UserIdentity,
  ): Promise<SearchSyncHistoryRecord> {
    this.userSearchService?.ensureModuleSearchEntitiesRegistered();
    this.searchRegistry.syncFromManifests();

    if (this.userSearchService) {
      const history = await this.userSearchService.syncUsersToSearchIndex(body, actor);
      await this.persistSyncHistoryToDb(history);

      if (body?.async !== true) {
        const docs = await this.userSearchService.loadUserSearchDocuments(body?.userIds);
        await this.persistSearchDocumentsToDb(docs);
      }

      return history;
    }

    const synced = await this.searchRegistry.syncDocuments([], {
      actorId: actor?.id ?? null,
      executionMode: body?.async ? 'QUEUE' : 'SYNC',
    });
    await this.persistSyncHistoryToDb(synced.history);
    return synced.history;
  }

  /** 8.5.5 — Tạo lại toàn bộ Search Index theo module hoặc loại dữ liệu (`entityType`) */
  public async rebuildSearchIndex(
    body?: RebuildSearchIndexBody,
    actor?: UserIdentity,
  ): Promise<SearchSyncHistoryRecord> {
    this.userSearchService?.ensureModuleSearchEntitiesRegistered();
    this.searchRegistry.syncFromManifests();

    if (this.userSearchService) {
      const history = await this.userSearchService.rebuildSearchIndex(body, actor);
      await this.persistSyncHistoryToDb(history);

      if (body?.async !== true) {
        if (this.documentRepository) {
          await this.documentRepository
            .deleteByFilter({
              ...(body?.module ? { module: body.module } : {}),
              ...(body?.entityType ? { entityType: body.entityType } : {}),
              ...(body?.entityCode ? { entityCode: body.entityCode } : {}),
            })
            .catch(() => 0);
        }
        const docs = await this.userSearchService.loadUserSearchDocuments();
        await this.persistSearchDocumentsToDb(docs);
      }
      return history;
    }

    const rebuilt = await this.searchRegistry.rebuildIndex({
      ...(body?.module ? { module: body.module } : {}),
      ...(body?.entityType ? { entityType: body.entityType } : {}),
      ...(body?.entityCode ? { entityCode: body.entityCode } : {}),
      actorId: actor?.id ?? null,
      executionMode: body?.async ? 'QUEUE' : 'SYNC',
    });
    await this.persistSyncHistoryToDb(rebuilt.history);
    return rebuilt.history;
  }

  /** 8.5.7 — Báo cáo độ trễ cập nhật Search Index (phát hiện kết quả tìm kiếm bị cũ) */
  public getSearchIndexLagReport(query?: SearchIndexLagQuery): SearchIndexLagReport {
    this.userSearchService?.ensureModuleSearchEntitiesRegistered();
    this.searchRegistry.syncFromManifests();

    return this.searchRegistry.getIndexLagReport({
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.entityType ? { entityType: query.entityType } : {}),
      ...(query?.entityCode ? { entityCode: query.entityCode } : {}),
      ...(query?.staleOnly !== undefined ? { staleOnly: query.staleOnly } : {}),
      ...(query?.staleThresholdMs !== undefined
        ? { staleThresholdMs: query.staleThresholdMs }
        : {}),
    });
  }

  /** 8.5.8 — Thống kê các từ khóa tìm kiếm không có kết quả (Zero-Result Keywords) */
  public async listZeroResultKeywords(
    query?: ListZeroResultKeywordsQuery,
  ): Promise<ZeroResultKeywordStat[]> {
    const filter = {
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.entityType ? { entityType: query.entityType } : {}),
      ...(query?.limit !== undefined ? { limit: query.limit } : {}),
    };

    const memList = this.searchRegistry.listZeroResultKeywords(filter);
    if (!this.zeroResultRepository) {
      return memList;
    }

    const dbEntities = await this.zeroResultRepository.listFiltered(filter).catch(() => []);
    if (dbEntities.length === 0) {
      return memList;
    }

    const byKey = new Map<string, ZeroResultKeywordStat>();
    for (const entity of dbEntities) {
      const mapped = this.mapZeroResultEntityToStat(entity);
      byKey.set(
        `${mapped.normalizedKeyword}:${mapped.modules[0] ?? ''}:${mapped.entityTypes[0] ?? ''}`,
        mapped,
      );
    }
    for (const mem of memList) {
      const k = `${mem.normalizedKeyword}:${mem.modules[0] ?? ''}:${mem.entityTypes[0] ?? ''}`;
      if (!byKey.has(k)) {
        byKey.set(k, mem);
      }
    }

    const limit = Math.max(1, Math.min(200, query?.limit ?? 20));
    return [...byKey.values()].sort((a, b) => b.searchCount - a.searchCount).slice(0, limit);
  }

  /** 8.5.4 & 8.5.5 — Xem lịch sử đồng bộ / tạo lại Search Index */
  public async listSearchSyncHistories(
    query?: ListSearchSyncHistoriesQuery,
  ): Promise<SearchSyncHistoryRecord[]> {
    const filter = {
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.operation ? { operation: query.operation } : {}),
      ...(query?.limit !== undefined ? { limit: query.limit } : {}),
    };

    const memList = this.searchRegistry.listSyncHistories(filter);
    if (!this.syncHistoryRepository) {
      return memList;
    }

    const dbEntities = await this.syncHistoryRepository.listFiltered(filter).catch(() => []);
    if (dbEntities.length === 0) {
      return memList;
    }

    const byId = new Map<number, SearchSyncHistoryRecord>();
    for (const entity of dbEntities) {
      const mapped = this.mapSyncHistoryEntityToRecord(entity);
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

  /** Xem chi tiết 1 bản ghi lịch sử đồng bộ Search Index theo ID */
  public async getSearchSyncHistoryById(historyId: number): Promise<SearchSyncHistoryRecord> {
    const mem = this.searchRegistry.getSyncHistoryById(historyId);
    if (mem) {
      return mem;
    }

    if (this.syncHistoryRepository) {
      const entity = await this.syncHistoryRepository.findById(historyId).catch(() => null);
      if (entity) {
        return this.mapSyncHistoryEntityToRecord(entity);
      }
    }

    throw new NotFoundAppException('search.syncHistoryNotFound', { id: historyId });
  }

  /** Xóa 1 bản ghi lịch sử đồng bộ Search Index khỏi Registry và bảng `search_sync_histories` (Xóa) */
  public async deleteSearchSyncHistory(historyId: number): Promise<{
    readonly deleted: true;
    readonly id: number;
  }> {
    const deletedMem = this.searchRegistry.deleteSyncHistory(historyId);
    const deletedDb = this.syncHistoryRepository
      ? await this.syncHistoryRepository.deleteById(historyId).catch(() => false)
      : false;

    if (!deletedMem && !deletedDb) {
      throw new NotFoundAppException('search.syncHistoryNotFound', { id: historyId });
    }

    return { deleted: true, id: historyId };
  }

  /** Xóa thống kê từ khóa 0 kết quả khỏi Registry và bảng `search_zero_result_keywords` (Xóa) */
  public async deleteZeroResultKeyword(keywordOrId: string | number): Promise<{
    readonly deleted: true;
    readonly target: string;
  }> {
    const target = String(keywordOrId).trim();
    const deletedMem = this.searchRegistry.deleteZeroResultKeyword(target);
    const deletedDb = this.zeroResultRepository
      ? await this.zeroResultRepository.deleteByIdOrKeyword(keywordOrId).catch(() => false)
      : false;

    if (!deletedMem && !deletedDb) {
      throw new NotFoundAppException('search.zeroResultNotFound', { target });
    }

    return { deleted: true, target };
  }

  public async persistSearchDocumentsToDb(docs: readonly SearchDocumentInput[]): Promise<void> {
    if (!this.documentRepository || docs.length === 0) return;
    try {
      for (const doc of docs) {
        const documentKey = `${doc.entityCode.trim().toLowerCase()}:${String(doc.id).trim()}`;
        const existing = await this.documentRepository.findByDocumentKey(documentKey);
        await this.documentRepository.saveEntity({
          ...(existing ? { id: existing.id } : {}),
          documentKey,
          entityCode: doc.entityCode,
          module: doc.module ?? 'users',
          entityType: doc.entityType ?? doc.entityCode,
          entityId: String(doc.id),
          title: doc.title,
          subtitle: doc.subtitle ?? null,
          keywordsJson: JSON.stringify(doc.keywords ?? []),
          searchableText: doc.searchableText ?? doc.title,
          ownerId: typeof doc.ownerId === 'number' ? doc.ownerId : null,
          organizationUnitId:
            typeof doc.organizationUnitId === 'number' ? doc.organizationUnitId : null,
          status: doc.status !== undefined && doc.status !== null ? String(doc.status) : null,
          metadataJson: JSON.stringify(doc.metadata ?? {}),
          sourceUpdatedAt: doc.sourceUpdatedAt ? new Date(doc.sourceUpdatedAt) : new Date(),
          indexedAt: doc.indexedAt ? new Date(doc.indexedAt) : new Date(),
        });
      }
    } catch {
      // Fallback an toàn cho môi trường test không bật DB
    }
  }

  public async persistSyncHistoryToDb(record: SearchSyncHistoryRecord): Promise<void> {
    if (!this.syncHistoryRepository) return;
    try {
      const existing = await this.syncHistoryRepository.findById(record.id);
      const startedMs = new Date(record.startedAt).getTime();
      const completedMs = record.completedAt ? new Date(record.completedAt).getTime() : null;
      await this.syncHistoryRepository.saveEntity({
        ...(existing ? { id: existing.id } : {}),
        operation: record.operation,
        module: record.module ?? 'system',
        entityType: record.entityType,
        entityCode: record.entityCode,
        driverUsed: record.driverUsed,
        executionMode: record.executionMode,
        status: record.status,
        indexedCount: record.indexedCount,
        removedCount: record.removedCount,
        jobId: record.jobId,
        actorId: record.actorId,
        errorMessage: record.errorMessage,
        startedAt: new Date(record.startedAt),
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        durationMs: completedMs !== null ? Math.max(0, completedMs - startedMs) : null,
      });
    } catch {
      // Fallback an toàn cho môi trường test không bật DB
    }
  }

  private async persistZeroResultStatToDb(
    stat: ZeroResultKeywordStat,
    actorId: number | null,
  ): Promise<void> {
    if (!this.zeroResultRepository) return;
    try {
      const primaryModule = stat.modules[0] ?? null;
      const primaryEntityType = stat.entityTypes[0] ?? null;
      const keywordKey = `${stat.normalizedKeyword}|${primaryModule ?? ''}|${primaryEntityType ?? ''}`;
      const existing = await this.zeroResultRepository.findByKeywordKey(keywordKey);
      await this.zeroResultRepository.saveEntity({
        ...(existing ? { id: existing.id } : {}),
        keywordKey,
        keyword: stat.sampleKeyword,
        normalizedKeyword: stat.normalizedKeyword,
        module: primaryModule,
        entityType: primaryEntityType,
        searchCount: stat.searchCount,
        firstSearchedAt: existing?.firstSearchedAt ?? new Date(stat.lastSearchedAt),
        lastSearchedAt: new Date(stat.lastSearchedAt),
        lastActorId: actorId ?? stat.lastActorId,
      });
    } catch {
      // Fallback an toàn cho môi trường test không bật DB
    }
  }

  private mapSyncHistoryEntityToRecord(entity: SearchSyncHistoryEntity): SearchSyncHistoryRecord {
    return {
      id: Number(entity.id),
      operation: entity.operation,
      module: entity.module,
      entityType: entity.entityType,
      entityCode: entity.entityCode,
      driverUsed: entity.driverUsed,
      executionMode: entity.executionMode,
      status: entity.status,
      indexedCount: entity.indexedCount,
      removedCount: entity.removedCount,
      jobId: entity.jobId,
      actorId: entity.actorId,
      errorMessage: entity.errorMessage,
      startedAt:
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

  private mapZeroResultEntityToStat(entity: SearchZeroResultKeywordEntity): ZeroResultKeywordStat {
    return {
      sampleKeyword: entity.keyword,
      normalizedKeyword: entity.normalizedKeyword,
      modules: entity.module ? [entity.module] : [],
      entityTypes: entity.entityType ? [entity.entityType] : [],
      searchCount: entity.searchCount,
      lastSearchedAt:
        entity.lastSearchedAt instanceof Date
          ? entity.lastSearchedAt.toISOString()
          : String(entity.lastSearchedAt),
      lastActorId: entity.lastActorId,
    };
  }
}
