import { Injectable } from '@nestjs/common';
import {
  SEARCH_ENGINE_DRIVER,
  discoverManifestSearchableEntities,
  type ExternalSearchEngineClientContract,
  type RegisteredSearchableEntity,
  type SearchActorScopeContext,
  type SearchDocumentInput,
  type SearchDocumentLagRecord,
  type SearchDocumentRecord,
  type SearchEngineDriver,
  type SearchHitItem,
  type SearchIndexLagReport,
  type SearchProviderAdapterContract,
  type SearchQueryInput,
  type SearchQueryResult,
  type SearchQueueWorkerExecutor,
  type SearchSyncExecutionMode,
  type SearchSyncHistoryRecord,
  type SearchSyncOperationType,
  type SearchSyncStatus,
  type SearchableEntityDocumentLoader,
  type SearchableEntityManifestItem,
  type ZeroResultKeywordStat,
} from '../contracts/search.contract.js';
import { NotFoundAppException } from '../errors/not-found.exception.js';
import {
  DEFAULT_SEARCH_STALE_THRESHOLD_MS,
  buildSearchDocumentRecord,
  calculateDocumentIndexLag,
  canActorAccessSearchDocument,
  computeDocumentMatchScore,
  normalizeSearchText,
} from '../utils/search-engine.util.js';

/**
 * 8.5.2 — Adapter tìm kiếm bằng Database / In-Memory Index mặc định cho dự án nhỏ (không bắt buộc cài search engine ngoài).
 */
export class DatabaseSearchProviderAdapter implements SearchProviderAdapterContract {
  public readonly driver: SearchEngineDriver = SEARCH_ENGINE_DRIVER.DATABASE;
  private readonly store = new Map<string, SearchDocumentRecord>();

  public isAvailable(): boolean {
    return true;
  }

  public indexDocuments(documents: readonly SearchDocumentRecord[]): {
    readonly indexedCount: number;
  } {
    for (const doc of documents) {
      this.store.set(doc.documentKey, doc);
    }
    return { indexedCount: documents.length };
  }

  public removeDocuments(
    entityCode: string,
    documentIds?: readonly (string | number)[],
  ): { readonly removedCount: number } {
    const normalizedCode = entityCode.trim().toLowerCase();
    let removedCount = 0;

    if (!documentIds || documentIds.length === 0) {
      for (const [key, doc] of this.store.entries()) {
        if (doc.entityCode.toLowerCase() === normalizedCode) {
          this.store.delete(key);
          removedCount += 1;
        }
      }
      return { removedCount };
    }

    for (const id of documentIds) {
      const targetKey = `${entityCode.trim()}:${String(id)}`;
      if (this.store.delete(targetKey)) {
        removedCount += 1;
      } else {
        for (const [key, doc] of this.store.entries()) {
          if (doc.entityCode.toLowerCase() === normalizedCode && String(doc.id) === String(id)) {
            this.store.delete(key);
            removedCount += 1;
          }
        }
      }
    }

    return { removedCount };
  }

  public clearIndex(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
  }): { readonly clearedCount: number } {
    if (!filter?.module && !filter?.entityType && !filter?.entityCode) {
      const count = this.store.size;
      this.store.clear();
      return { clearedCount: count };
    }

    const targetModule = filter.module?.trim().toLowerCase();
    const targetType = filter.entityType?.trim().toLowerCase();
    const targetCode = filter.entityCode?.trim().toLowerCase();
    let clearedCount = 0;

    for (const [key, doc] of this.store.entries()) {
      if (targetModule && doc.module.toLowerCase() !== targetModule) continue;
      if (targetType && doc.entityType.toLowerCase() !== targetType) continue;
      if (targetCode && doc.entityCode.toLowerCase() !== targetCode) continue;
      this.store.delete(key);
      clearedCount += 1;
    }

    return { clearedCount };
  }

  public searchDocuments(
    query: SearchQueryInput,
    candidateDocs: readonly SearchDocumentRecord[],
  ): readonly SearchDocumentRecord[] {
    const sourceDocs = candidateDocs.length > 0 ? candidateDocs : Array.from(this.store.values());
    const targetModule = query.module?.trim().toLowerCase();
    const targetType = query.entityType?.trim().toLowerCase();
    const targetCode = query.entityCode?.trim().toLowerCase();

    return sourceDocs.filter((doc) => {
      if (targetModule && doc.module.toLowerCase() !== targetModule) return false;
      if (targetType && doc.entityType.toLowerCase() !== targetType) return false;
      if (targetCode && doc.entityCode.toLowerCase() !== targetCode) return false;
      if (
        query.status !== undefined &&
        query.status !== null &&
        String(doc.status) !== String(query.status)
      ) {
        return false;
      }
      if (
        query.organizationUnitId !== undefined &&
        query.organizationUnitId !== null &&
        doc.organizationUnitId !== query.organizationUnitId
      ) {
        return false;
      }
      const match = computeDocumentMatchScore(doc, query.keyword);
      return match.matched;
    });
  }
}

/**
 * 8.5.3 — Adapter gói client Elasticsearch hoặc OpenSearch tùy chọn (chỉ kích hoạt khi dự án cài đặt client).
 */
export class ExternalSearchEngineAdapter implements SearchProviderAdapterContract {
  public readonly driver: SearchEngineDriver;
  private readonly indexPrefix: string;

  constructor(private readonly client: ExternalSearchEngineClientContract) {
    this.driver =
      client.engine === 'OPENSEARCH'
        ? SEARCH_ENGINE_DRIVER.OPENSEARCH
        : SEARCH_ENGINE_DRIVER.ELASTICSEARCH;
    this.indexPrefix = (client.indexPrefix ?? 'core_search').trim().toLowerCase();
  }

  public isAvailable(): boolean {
    if (typeof this.client.isConnected === 'function') {
      return this.client.isConnected();
    }
    return true;
  }

  public async indexDocuments(
    documents: readonly SearchDocumentRecord[],
  ): Promise<{ readonly indexedCount: number }> {
    if (documents.length === 0) {
      return { indexedCount: 0 };
    }
    return this.client.bulkIndex(`${this.indexPrefix}_documents`, documents);
  }

  public async removeDocuments(
    entityCode: string,
    documentIds?: readonly (string | number)[],
  ): Promise<{ readonly removedCount: number }> {
    const res = await this.client.deleteByQuery(`${this.indexPrefix}_documents`, {
      entityCode,
      ...(documentIds ? { documentIds } : {}),
    });
    return { removedCount: res.deletedCount };
  }

  public async clearIndex(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
  }): Promise<{ readonly clearedCount: number }> {
    const res = await this.client.deleteByQuery(`${this.indexPrefix}_documents`, {
      ...(filter?.module ? { module: filter.module } : {}),
      ...(filter?.entityType ? { entityType: filter.entityType } : {}),
      ...(filter?.entityCode ? { entityCode: filter.entityCode } : {}),
    });
    return { clearedCount: res.deletedCount };
  }

  public async searchDocuments(
    query: SearchQueryInput,
    _candidateDocs: readonly SearchDocumentRecord[],
  ): Promise<readonly SearchDocumentRecord[]> {
    return this.client.search(`${this.indexPrefix}_documents`, query);
  }
}

/**
 * Dịch vụ trung tâm quản lý Tìm kiếm toàn hệ thống (Mục 8.5):
 * - 8.5.1: Đăng ký thực thể tìm kiếm theo từng module (`searchableEntities`).
 * - 8.5.2: Hỗ trợ tìm kiếm bằng Database mặc định cho dự án nhỏ.
 * - 8.5.3: Hỗ trợ cắm Elasticsearch hoặc OpenSearch adapter tùy chọn cho dự án dữ liệu lớn.
 * - 8.5.4: Đồng bộ dữ liệu sang Search Index (đồng bộ hoặc qua Queue).
 * - 8.5.5: Tạo lại toàn bộ Index (`rebuildIndex`) theo module hoặc loại dữ liệu (`entityType`).
 * - 8.5.6: Áp dụng quyền (`requiredPermission`) và `DataScope` vào kết quả tìm kiếm.
 * - 8.5.7: Theo dõi độ trễ cập nhật Index (`lagMs`, `isStale`) để phát hiện kết quả cũ.
 * - 8.5.8: Thống kê từ khóa không có kết quả (`ZeroResultKeywordStat`).
 */
@Injectable()
export class SearchRegistryService {
  private readonly entities = new Map<string, RegisteredSearchableEntity>();
  private readonly documents = new Map<string, SearchDocumentRecord>();
  private readonly documentLoaders = new Map<string, SearchableEntityDocumentLoader>();
  private readonly workerExecutors = new Map<string, SearchQueueWorkerExecutor>();
  private readonly zeroResultStats = new Map<
    string,
    {
      normalizedKeyword: string;
      sampleKeyword: string;
      searchCount: number;
      lastSearchedAt: string;
      modules: Set<string>;
      entityTypes: Set<string>;
      lastActorId: number | null;
    }
  >();
  private readonly syncHistories = new Map<number, SearchSyncHistoryRecord>();
  private syncHistorySeq = 1;

  private readonly databaseAdapter = new DatabaseSearchProviderAdapter();
  private externalAdapter: SearchProviderAdapterContract | null = null;

  /**
   * 8.5.4 & 8.5.5 — Đăng ký bộ thực thi đồng bộ Search Index nền (`SearchQueueWorkerExecutor`) của module vào Registry
   * để `HeavyJobProcessor` tự động điều phối theo `module`, `entityCode` hoặc `topic` mà không cần hardcode.
   */
  public registerWorkerExecutor(executor: SearchQueueWorkerExecutor): void {
    const moduleKey = executor.module.trim().toLowerCase();
    const entityKey = executor.entityCode?.trim().toLowerCase();
    const syncTopicKey = executor.syncTopic?.trim().toLowerCase() || `${moduleKey}.search_sync`;
    const rebuildTopicKey =
      executor.rebuildTopic?.trim().toLowerCase() || `${moduleKey}.search_rebuild`;

    if (moduleKey) {
      this.workerExecutors.set(`module:${moduleKey}`, executor);
    }
    if (entityKey) {
      this.workerExecutors.set(`entity:${entityKey}`, executor);
    }
    if (syncTopicKey) {
      this.workerExecutors.set(`topic:${syncTopicKey}`, executor);
    }
    if (rebuildTopicKey) {
      this.workerExecutors.set(`topic:${rebuildTopicKey}`, executor);
    }
  }

  /**
   * 8.5.4 & 8.5.5 — Tra cứu bộ thực thi đồng bộ Search Index nền theo `module`, `entityCode` hoặc `topic`.
   */
  public resolveWorkerExecutor(lookup: {
    readonly module?: string | undefined;
    readonly entityCode?: string | undefined;
    readonly topic?: string | undefined;
  }): SearchQueueWorkerExecutor | undefined {
    if (lookup.entityCode?.trim()) {
      const normalizedEntity = lookup.entityCode.trim().toLowerCase();
      const byEntity = this.workerExecutors.get(`entity:${normalizedEntity}`);
      if (byEntity) return byEntity;
      const entityPrefix = normalizedEntity.split('.')[0];
      if (entityPrefix) {
        const byPrefix = this.workerExecutors.get(`module:${entityPrefix}`);
        if (byPrefix) return byPrefix;
      }
    }
    if (lookup.module?.trim()) {
      const byModule = this.workerExecutors.get(`module:${lookup.module.trim().toLowerCase()}`);
      if (byModule) return byModule;
    }
    if (lookup.topic?.trim()) {
      const normalizedTopic = lookup.topic.trim().toLowerCase();
      const byTopic = this.workerExecutors.get(`topic:${normalizedTopic}`);
      if (byTopic) return byTopic;
      if (normalizedTopic.endsWith('.search_sync')) {
        const mod = normalizedTopic.slice(0, -'.search_sync'.length);
        const byMod = this.workerExecutors.get(`module:${mod}`);
        if (byMod) return byMod;
      }
      if (normalizedTopic.endsWith('.search_rebuild')) {
        const mod = normalizedTopic.slice(0, -'.search_rebuild'.length);
        const byMod = this.workerExecutors.get(`module:${mod}`);
        if (byMod) return byMod;
      }
    }
    return undefined;
  }

  /**
   * 8.5.1 — Đăng ký một thực thể có thể tìm kiếm của module.
   */
  public registerSearchableEntity(item: SearchableEntityManifestItem): RegisteredSearchableEntity {
    const normalizedCode = item.code.trim();
    const existing = this.entities.get(normalizedCode);

    const record: RegisteredSearchableEntity = {
      code: normalizedCode,
      module: (item.module ?? existing?.module ?? 'core').trim().toLowerCase(),
      entityType: (item.entityType ?? existing?.entityType ?? normalizedCode).trim().toLowerCase(),
      name: item.name.trim(),
      description: item.description ?? existing?.description ?? null,
      requiredPermission: item.requiredPermission.trim(),
      searchableFields: Array.isArray(item.searchableFields)
        ? item.searchableFields.map((field) => field.trim()).filter((field) => field.length > 0)
        : (existing?.searchableFields ?? ['title', 'subtitle']),
      titleField: (item.titleField ?? existing?.titleField ?? 'name').trim(),
      subtitleField:
        item.subtitleField !== undefined
          ? item.subtitleField.trim() || null
          : (existing?.subtitleField ?? null),
      staleThresholdMs:
        typeof item.staleThresholdMs === 'number' && item.staleThresholdMs >= 0
          ? Math.trunc(item.staleThresholdMs)
          : (existing?.staleThresholdMs ?? DEFAULT_SEARCH_STALE_THRESHOLD_MS),
      isSystem: item.isSystem ?? existing?.isSystem ?? true,
      status: item.status ?? existing?.status ?? 1,
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    };

    this.entities.set(normalizedCode, record);
    return record;
  }

  public registerManifestSearchableEntities(
    items: readonly SearchableEntityManifestItem[],
  ): RegisteredSearchableEntity[] {
    return items.map((item) => this.registerSearchableEntity(item));
  }

  public syncFromManifests(): RegisteredSearchableEntity[] {
    const discovered = discoverManifestSearchableEntities();
    return this.registerManifestSearchableEntities(discovered);
  }

  public getSearchableEntity(code: string): RegisteredSearchableEntity | undefined {
    return this.entities.get(code.trim());
  }

  public listSearchableEntities(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
  }): RegisteredSearchableEntity[] {
    const targetModule = filter?.module?.trim().toLowerCase();
    const targetType = filter?.entityType?.trim().toLowerCase();

    return Array.from(this.entities.values()).filter((entity) => {
      if (targetModule && entity.module !== targetModule) return false;
      if (targetType && entity.entityType !== targetType) return false;
      return entity.status === 1;
    });
  }

  /**
   * Đăng ký hàm nạp tài liệu nguồn cho thực thể để phục vụ `rebuildIndex` (8.5.5).
   */
  public registerEntityDocumentLoader(
    entityCode: string,
    loader: SearchableEntityDocumentLoader,
  ): void {
    this.documentLoaders.set(entityCode.trim(), loader);
  }

  /**
   * 8.5.3 — Đăng ký hoặc gỡ client Elasticsearch / OpenSearch tùy chọn.
   * Khi không đăng ký (mặc định), hệ thống tự động dùng `DatabaseSearchProviderAdapter` (8.5.2).
   */
  public registerExternalSearchClient(client: ExternalSearchEngineClientContract | null): void {
    if (!client) {
      this.externalAdapter = null;
      return;
    }
    this.externalAdapter = new ExternalSearchEngineAdapter(client);
  }

  public setSearchAdapter(adapter: SearchProviderAdapterContract | null): void {
    this.externalAdapter = adapter;
  }

  public getActiveAdapter(): SearchProviderAdapterContract {
    if (this.externalAdapter && this.externalAdapter.isAvailable()) {
      return this.externalAdapter;
    }
    return this.databaseAdapter;
  }

  public getActiveDriver(): SearchEngineDriver {
    return this.getActiveAdapter().driver;
  }

  /**
   * 8.5.4 — Đồng bộ danh sách tài liệu sang Search Index (cả bộ nhớ/Database Index và External Search Engine nếu có).
   */
  public async syncDocuments(
    inputs: readonly SearchDocumentInput[],
    options?: {
      readonly actorId?: number | null | undefined;
      readonly executionMode?: SearchSyncExecutionMode | undefined;
      readonly jobId?: string | null | undefined;
      readonly existingHistoryId?: number | undefined;
    },
  ): Promise<{
    readonly driverUsed: SearchEngineDriver;
    readonly indexedCount: number;
    readonly history: SearchSyncHistoryRecord;
  }> {
    const activeAdapter = this.getActiveAdapter();
    const records: SearchDocumentRecord[] = inputs.map((input) => {
      const entityDef = this.entities.get(input.entityCode.trim());
      return buildSearchDocumentRecord(input, entityDef);
    });

    for (const record of records) {
      this.documents.set(record.documentKey, record);
    }
    this.databaseAdapter.indexDocuments(records);

    if (activeAdapter !== this.databaseAdapter) {
      await activeAdapter.indexDocuments(records);
    }

    const firstRecord = records[0];
    const history =
      options?.existingHistoryId !== undefined
        ? this.updateSyncHistory(options.existingHistoryId, {
            status: 'COMPLETED',
            driverUsed: activeAdapter.driver,
            indexedCount: records.length,
            ...(options.jobId !== undefined ? { jobId: options.jobId } : {}),
            completedAt: new Date().toISOString(),
          })
        : this.createSyncHistory({
            operation: 'SYNC',
            module: firstRecord?.module ?? null,
            entityType: firstRecord?.entityType ?? null,
            entityCode: firstRecord?.entityCode ?? null,
            driverUsed: activeAdapter.driver,
            executionMode: options?.executionMode ?? 'SYNC',
            status: 'COMPLETED',
            indexedCount: records.length,
            removedCount: 0,
            jobId: options?.jobId ?? null,
            actorId: options?.actorId ?? null,
          });

    return {
      driverUsed: activeAdapter.driver,
      indexedCount: records.length,
      history,
    };
  }

  /**
   * Xóa tài liệu khỏi Search Index theo `entityCode` và danh sách `documentIds`.
   */
  public async removeDocuments(
    entityCode: string,
    documentIds?: readonly (string | number)[],
  ): Promise<{
    readonly driverUsed: SearchEngineDriver;
    readonly removedCount: number;
  }> {
    const activeAdapter = this.getActiveAdapter();
    const normalizedCode = entityCode.trim().toLowerCase();
    let removedCount = 0;

    if (!documentIds || documentIds.length === 0) {
      for (const [key, doc] of this.documents.entries()) {
        if (doc.entityCode.toLowerCase() === normalizedCode) {
          this.documents.delete(key);
          removedCount += 1;
        }
      }
    } else {
      for (const id of documentIds) {
        const targetKey = `${entityCode.trim()}:${String(id)}`;
        if (this.documents.delete(targetKey)) {
          removedCount += 1;
        }
      }
    }

    this.databaseAdapter.removeDocuments(entityCode, documentIds);
    if (activeAdapter !== this.databaseAdapter) {
      await activeAdapter.removeDocuments(entityCode, documentIds);
    }

    return {
      driverUsed: activeAdapter.driver,
      removedCount,
    };
  }

  /**
   * 8.5.5 — Cho phép tạo lại toàn bộ Index (`rebuildIndex`) theo `module`, `entityType` hoặc `entityCode`.
   */
  public async rebuildIndex(options?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
    readonly documents?: readonly SearchDocumentInput[] | undefined;
    readonly actorId?: number | null | undefined;
    readonly executionMode?: SearchSyncExecutionMode | undefined;
    readonly jobId?: string | null | undefined;
    readonly existingHistoryId?: number | undefined;
  }): Promise<{
    readonly driverUsed: SearchEngineDriver;
    readonly clearedCount: number;
    readonly indexedCount: number;
    readonly affectedEntities: readonly string[];
    readonly history: SearchSyncHistoryRecord;
  }> {
    const activeAdapter = this.getActiveAdapter();
    const targetModule = options?.module?.trim().toLowerCase();
    const targetType = options?.entityType?.trim().toLowerCase();
    const targetCode = options?.entityCode?.trim().toLowerCase();

    let clearedCount = 0;
    for (const [key, doc] of this.documents.entries()) {
      if (targetModule && doc.module.toLowerCase() !== targetModule) continue;
      if (targetType && doc.entityType.toLowerCase() !== targetType) continue;
      if (targetCode && doc.entityCode.toLowerCase() !== targetCode) continue;
      this.documents.delete(key);
      clearedCount += 1;
    }

    this.databaseAdapter.clearIndex({
      ...(targetModule ? { module: targetModule } : {}),
      ...(targetType ? { entityType: targetType } : {}),
      ...(targetCode ? { entityCode: targetCode } : {}),
    });

    if (activeAdapter !== this.databaseAdapter) {
      await activeAdapter.clearIndex({
        ...(targetModule ? { module: targetModule } : {}),
        ...(targetType ? { entityType: targetType } : {}),
        ...(targetCode ? { entityCode: targetCode } : {}),
      });
    }

    const inputsToReindex: SearchDocumentInput[] = [];
    const affectedEntities = new Set<string>();

    if (options?.documents) {
      for (const doc of options.documents) {
        inputsToReindex.push(doc);
        affectedEntities.add(doc.entityCode.trim());
      }
    } else {
      const matchingEntities = Array.from(this.entities.values()).filter((entity) => {
        if (targetModule && entity.module.toLowerCase() !== targetModule) return false;
        if (targetType && entity.entityType.toLowerCase() !== targetType) return false;
        if (targetCode && entity.code.toLowerCase() !== targetCode) return false;
        return true;
      });

      for (const entity of matchingEntities) {
        const loader = this.documentLoaders.get(entity.code);
        if (!loader) continue;
        affectedEntities.add(entity.code);
        const loadedDocs = await loader();
        for (const doc of loadedDocs) {
          inputsToReindex.push(doc);
        }
      }
    }

    const records = inputsToReindex.map((input) => {
      const entityDef = this.entities.get(input.entityCode.trim());
      affectedEntities.add(input.entityCode.trim());
      return buildSearchDocumentRecord(input, entityDef);
    });

    for (const record of records) {
      this.documents.set(record.documentKey, record);
    }
    this.databaseAdapter.indexDocuments(records);
    if (activeAdapter !== this.databaseAdapter) {
      await activeAdapter.indexDocuments(records);
    }

    const history =
      options?.existingHistoryId !== undefined
        ? this.updateSyncHistory(options.existingHistoryId, {
            status: 'COMPLETED',
            driverUsed: activeAdapter.driver,
            indexedCount: records.length,
            removedCount: clearedCount,
            ...(options.jobId !== undefined ? { jobId: options.jobId } : {}),
            completedAt: new Date().toISOString(),
          })
        : this.createSyncHistory({
            operation: 'REBUILD',
            module: targetModule ?? null,
            entityType: targetType ?? null,
            entityCode: targetCode ?? null,
            driverUsed: activeAdapter.driver,
            executionMode: options?.executionMode ?? 'SYNC',
            status: 'COMPLETED',
            indexedCount: records.length,
            removedCount: clearedCount,
            jobId: options?.jobId ?? null,
            actorId: options?.actorId ?? null,
          });

    return {
      driverUsed: activeAdapter.driver,
      clearedCount,
      indexedCount: records.length,
      affectedEntities: Array.from(affectedEntities),
      history,
    };
  }

  /**
   * 8.5.2, 8.5.3, 8.5.6, 8.5.7 & 8.5.8 — Thực hiện truy vấn tìm kiếm toàn hệ thống:
   * - Gọi Search Provider hiện hành (`DATABASE` hoặc `ELASTICSEARCH` / `OPENSEARCH`).
   * - Áp dụng kiểm tra quyền (`requiredPermission`) & `DataScope` (`ALL`, `ORG_UNIT`, `SUBORDINATES`, `SELF`).
   * - Tính toán độ trễ cập nhật Index (`indexLagMs`, `isStale`).
   * - Tự động ghi nhận thống kê từ khóa không có kết quả (`ZeroResultKeywordStat`) khi `total === 0`.
   */
  public async search(
    query: SearchQueryInput,
    scope?: SearchActorScopeContext,
  ): Promise<SearchQueryResult> {
    const activeAdapter = this.getActiveAdapter();
    const rawKeyword = String(query.keyword ?? '').trim();
    const normalizedKeyword = normalizeSearchText(rawKeyword);
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Math.trunc(query.limit ?? 20)));
    const includeStale = query.includeStale ?? true;

    const candidateDocs = Array.from(this.documents.values());
    const matchedDocs = await activeAdapter.searchDocuments(query, candidateDocs);

    const scoredHits: SearchHitItem[] = [];
    for (const doc of matchedDocs) {
      const entityDef = this.entities.get(doc.entityCode);
      if (!canActorAccessSearchDocument(doc, entityDef, scope)) {
        continue;
      }

      const staleThresholdMs = entityDef?.staleThresholdMs ?? DEFAULT_SEARCH_STALE_THRESHOLD_MS;
      const lagInfo = calculateDocumentIndexLag(
        doc.sourceUpdatedAt,
        doc.indexedAt,
        staleThresholdMs,
      );
      if (!includeStale && lagInfo.isStale) {
        continue;
      }

      const matchResult = computeDocumentMatchScore(doc, rawKeyword);
      if (!matchResult.matched && activeAdapter === this.databaseAdapter) {
        continue;
      }

      scoredHits.push({
        documentKey: doc.documentKey,
        id: doc.id,
        entityCode: doc.entityCode,
        module: doc.module,
        entityType: doc.entityType,
        title: doc.title,
        subtitle: doc.subtitle,
        score: matchResult.score > 0 ? matchResult.score : 10,
        matchedHighlights:
          matchResult.matchedHighlights.length > 0 ? matchResult.matchedHighlights : [doc.title],
        ownerId: doc.ownerId,
        organizationUnitId: doc.organizationUnitId,
        status: doc.status,
        metadata: doc.metadata,
        sourceUpdatedAt: doc.sourceUpdatedAt,
        indexedAt: doc.indexedAt,
        indexLagMs: lagInfo.lagMs,
        isStale: lagInfo.isStale,
      });
    }

    scoredHits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.id).localeCompare(String(b.id));
    });

    const total = scoredHits.length;
    if (total === 0 && normalizedKeyword.length > 0) {
      this.recordZeroResultKeyword({
        keyword: rawKeyword,
        ...(query.module ? { module: query.module } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        actorId: scope?.actorId ?? null,
      });
    }

    const startOffset = (page - 1) * limit;
    const pagedHits = scoredHits.slice(startOffset, startOffset + limit);
    const staleHitCount = scoredHits.filter((hit) => hit.isStale).length;
    const maxIndexLagMs = scoredHits.reduce((max, hit) => Math.max(max, hit.indexLagMs), 0);

    return {
      keyword: rawKeyword,
      normalizedKeyword,
      driverUsed: activeAdapter.driver,
      total,
      page,
      limit,
      staleHitCount,
      maxIndexLagMs,
      hits: pagedHits,
    };
  }

  /**
   * 8.5.7 — Báo cáo độ trễ cập nhật Index (`lagMs`) để phát hiện các bản ghi tìm kiếm bị cũ (`isStale`).
   */
  public getIndexLagReport(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
    readonly staleOnly?: boolean | undefined;
    readonly staleThresholdMs?: number | undefined;
  }): SearchIndexLagReport {
    const targetModule = filter?.module?.trim().toLowerCase();
    const targetType = filter?.entityType?.trim().toLowerCase();
    const targetCode = filter?.entityCode?.trim().toLowerCase();
    const staleOnly = filter?.staleOnly === true;

    const items: SearchDocumentLagRecord[] = [];
    let totalLagMs = 0;
    let maxLagMs = 0;
    let staleDocumentCount = 0;
    let matchedCount = 0;

    for (const doc of this.documents.values()) {
      if (targetModule && doc.module.toLowerCase() !== targetModule) continue;
      if (targetType && doc.entityType.toLowerCase() !== targetType) continue;
      if (targetCode && doc.entityCode.toLowerCase() !== targetCode) continue;

      const entityDef = this.entities.get(doc.entityCode);
      const thresholdMs =
        filter?.staleThresholdMs ??
        entityDef?.staleThresholdMs ??
        DEFAULT_SEARCH_STALE_THRESHOLD_MS;
      const lag = calculateDocumentIndexLag(doc.sourceUpdatedAt, doc.indexedAt, thresholdMs);

      matchedCount += 1;
      totalLagMs += lag.lagMs;
      if (lag.lagMs > maxLagMs) {
        maxLagMs = lag.lagMs;
      }
      if (lag.isStale) {
        staleDocumentCount += 1;
      }

      if (staleOnly && !lag.isStale) {
        continue;
      }

      items.push({
        documentKey: doc.documentKey,
        id: doc.id,
        entityCode: doc.entityCode,
        module: doc.module,
        entityType: doc.entityType,
        title: doc.title,
        sourceUpdatedAt: doc.sourceUpdatedAt,
        indexedAt: doc.indexedAt,
        lagMs: lag.lagMs,
        staleThresholdMs: lag.staleThresholdMs,
        isStale: lag.isStale,
      });
    }

    items.sort((a, b) => b.lagMs - a.lagMs);

    return {
      driverUsed: this.getActiveDriver(),
      totalIndexedDocuments: matchedCount,
      staleDocumentCount,
      maxLagMs,
      averageLagMs: matchedCount > 0 ? Math.round(totalLagMs / matchedCount) : 0,
      items,
    };
  }

  /**
   * 8.5.8 — Ghi nhận một lượt tìm kiếm từ khóa không trả về kết quả.
   */
  public recordZeroResultKeyword(input: {
    readonly keyword: string;
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly actorId?: number | null | undefined;
  }): ZeroResultKeywordStat | null {
    const normalizedKeyword = normalizeSearchText(input.keyword);
    if (!normalizedKeyword) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const existing = this.zeroResultStats.get(normalizedKeyword);
    const modules = existing?.modules ?? new Set<string>();
    const entityTypes = existing?.entityTypes ?? new Set<string>();

    if (input.module && input.module.trim().length > 0) {
      modules.add(input.module.trim().toLowerCase());
    }
    if (input.entityType && input.entityType.trim().length > 0) {
      entityTypes.add(input.entityType.trim().toLowerCase());
    }

    const nextStat = {
      normalizedKeyword,
      sampleKeyword: existing?.sampleKeyword ?? input.keyword.trim(),
      searchCount: (existing?.searchCount ?? 0) + 1,
      lastSearchedAt: nowIso,
      modules,
      entityTypes,
      lastActorId:
        typeof input.actorId === 'number' && Number.isFinite(input.actorId)
          ? input.actorId
          : (existing?.lastActorId ?? null),
    };

    this.zeroResultStats.set(normalizedKeyword, nextStat);

    return {
      normalizedKeyword: nextStat.normalizedKeyword,
      sampleKeyword: nextStat.sampleKeyword,
      searchCount: nextStat.searchCount,
      lastSearchedAt: nextStat.lastSearchedAt,
      modules: Array.from(nextStat.modules),
      entityTypes: Array.from(nextStat.entityTypes),
      lastActorId: nextStat.lastActorId,
    };
  }

  /**
   * 8.5.8 — Lấy danh sách thống kê các từ khóa không có kết quả (sắp xếp giảm dần theo `searchCount`).
   */
  public listZeroResultKeywords(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly limit?: number | undefined;
  }): ZeroResultKeywordStat[] {
    const targetModule = filter?.module?.trim().toLowerCase();
    const targetType = filter?.entityType?.trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Math.trunc(filter?.limit ?? 50)));

    const items: ZeroResultKeywordStat[] = [];
    for (const stat of this.zeroResultStats.values()) {
      if (targetModule && stat.modules.size > 0 && !stat.modules.has(targetModule)) {
        continue;
      }
      if (targetType && stat.entityTypes.size > 0 && !stat.entityTypes.has(targetType)) {
        continue;
      }
      items.push({
        normalizedKeyword: stat.normalizedKeyword,
        sampleKeyword: stat.sampleKeyword,
        searchCount: stat.searchCount,
        lastSearchedAt: stat.lastSearchedAt,
        modules: Array.from(stat.modules),
        entityTypes: Array.from(stat.entityTypes),
        lastActorId: stat.lastActorId,
      });
    }

    items.sort((a, b) => {
      if (b.searchCount !== a.searchCount) return b.searchCount - a.searchCount;
      return b.lastSearchedAt.localeCompare(a.lastSearchedAt);
    });

    return items.slice(0, limit);
  }

  /**
   * Quản lý lịch sử đồng bộ / rebuild Search Index (8.5.4 & 8.5.5).
   */
  public createSyncHistory(input: {
    readonly operation: SearchSyncOperationType;
    readonly module?: string | null | undefined;
    readonly entityType?: string | null | undefined;
    readonly entityCode?: string | null | undefined;
    readonly driverUsed?: SearchEngineDriver | undefined;
    readonly executionMode?: SearchSyncExecutionMode | undefined;
    readonly status?: SearchSyncStatus | undefined;
    readonly indexedCount?: number | undefined;
    readonly removedCount?: number | undefined;
    readonly jobId?: string | null | undefined;
    readonly actorId?: number | null | undefined;
    readonly errorMessage?: string | null | undefined;
  }): SearchSyncHistoryRecord {
    const id = this.syncHistorySeq++;
    const nowIso = new Date().toISOString();
    const status = input.status ?? 'COMPLETED';
    const record: SearchSyncHistoryRecord = {
      id,
      operation: input.operation,
      module: input.module ?? null,
      entityType: input.entityType ?? null,
      entityCode: input.entityCode ?? null,
      driverUsed: input.driverUsed ?? this.getActiveDriver(),
      executionMode: input.executionMode ?? 'SYNC',
      status,
      indexedCount: input.indexedCount ?? 0,
      removedCount: input.removedCount ?? 0,
      jobId: input.jobId ?? null,
      actorId: input.actorId ?? null,
      errorMessage: input.errorMessage ?? null,
      startedAt: nowIso,
      completedAt: status === 'COMPLETED' || status === 'FAILED' ? nowIso : null,
    };

    this.syncHistories.set(id, record);
    return record;
  }

  public updateSyncHistory(
    id: number,
    patch: Partial<Omit<SearchSyncHistoryRecord, 'id' | 'startedAt'>>,
  ): SearchSyncHistoryRecord {
    const existing = this.syncHistories.get(id);
    if (!existing) {
      throw new NotFoundAppException(`Search sync history #${id} not found`);
    }

    const updated: SearchSyncHistoryRecord = {
      ...existing,
      ...patch,
    };
    this.syncHistories.set(id, updated);
    return updated;
  }

  public listSyncHistories(filter?: {
    readonly module?: string | undefined;
    readonly operation?: SearchSyncOperationType | undefined;
    readonly limit?: number | undefined;
  }): SearchSyncHistoryRecord[] {
    const targetModule = filter?.module?.trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Math.trunc(filter?.limit ?? 50)));

    return Array.from(this.syncHistories.values())
      .filter((item) => {
        if (targetModule && item.module?.toLowerCase() !== targetModule) return false;
        if (filter?.operation && item.operation !== filter.operation) return false;
        return true;
      })
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  public getIndexedDocumentCount(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
  }): number {
    if (!filter?.module && !filter?.entityType && !filter?.entityCode) {
      return this.documents.size;
    }

    const targetModule = filter.module?.trim().toLowerCase();
    const targetType = filter.entityType?.trim().toLowerCase();
    const targetCode = filter.entityCode?.trim().toLowerCase();
    let count = 0;

    for (const doc of this.documents.values()) {
      if (targetModule && doc.module.toLowerCase() !== targetModule) continue;
      if (targetType && doc.entityType.toLowerCase() !== targetType) continue;
      if (targetCode && doc.entityCode.toLowerCase() !== targetCode) continue;
      count += 1;
    }

    return count;
  }

  public clearAllForTesting(): void {
    this.documents.clear();
    this.databaseAdapter.clearIndex();
    this.zeroResultStats.clear();
    this.syncHistories.clear();
    this.externalAdapter = null;
  }
}

export const defaultSearchRegistry = new SearchRegistryService();
