import { discoverInstalledModules, scanModuleManifests } from './manifest.contract.js';

export const SEARCH_ENGINE_DRIVER = {
  DATABASE: 'DATABASE',
  ELASTICSEARCH: 'ELASTICSEARCH',
  OPENSEARCH: 'OPENSEARCH',
} as const;

export type SearchEngineDriver = (typeof SEARCH_ENGINE_DRIVER)[keyof typeof SEARCH_ENGINE_DRIVER];

export type SearchDataScopeType = 'ALL' | 'ORG_UNIT' | 'SUBORDINATES' | 'SELF';

/**
 * 8.5.1 — Khai báo thực thể có thể tìm kiếm (`searchableEntities`) trong `module.manifest.json`.
 */
export interface SearchableEntityManifestItem {
  readonly code: string;
  readonly module?: string | undefined;
  readonly entityType: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly requiredPermission: string;
  readonly searchableFields?: readonly string[] | undefined;
  readonly titleField?: string | undefined;
  readonly subtitleField?: string | undefined;
  readonly staleThresholdMs?: number | undefined;
  readonly isSystem?: boolean | undefined;
  readonly status?: number | undefined;
}

/**
 * 8.5.1 — Định nghĩa thực thể tìm kiếm đã được chuẩn hóa trong `SearchRegistryService`.
 */
export interface RegisteredSearchableEntity {
  readonly code: string;
  readonly module: string;
  readonly entityType: string;
  readonly name: string;
  readonly description: string | null;
  readonly requiredPermission: string;
  readonly searchableFields: readonly string[];
  readonly titleField: string;
  readonly subtitleField: string | null;
  readonly staleThresholdMs: number;
  readonly isSystem: boolean;
  readonly status: number;
  readonly registeredAt: string;
}

/**
 * Bản ghi tài liệu trong Search Index dùng chung cho cả Database Search và Elasticsearch / OpenSearch.
 */
export interface SearchDocumentInput {
  readonly id: string | number;
  readonly entityCode: string;
  readonly module?: string | undefined;
  readonly entityType?: string | undefined;
  readonly title: string;
  readonly subtitle?: string | null | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly searchableText?: string | undefined;
  readonly ownerId?: number | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly status?: number | string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly sourceUpdatedAt?: string | Date | undefined;
  readonly indexedAt?: string | Date | undefined;
}

export interface SearchDocumentRecord {
  readonly documentKey: string;
  readonly id: string | number;
  readonly entityCode: string;
  readonly module: string;
  readonly entityType: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly keywords: readonly string[];
  readonly searchableText: string;
  readonly ownerId: number | null;
  readonly organizationUnitId: number | null;
  readonly status: number | string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sourceUpdatedAt: string;
  readonly indexedAt: string;
}

/**
 * 8.5.6 — Ngữ cảnh quyền và phạm vi dữ liệu (Data Scope) của người thực hiện tìm kiếm.
 */
export interface SearchActorScopeContext {
  readonly actorId?: number | null | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly roles?: readonly string[] | undefined;
  readonly dataScopes?: readonly SearchDataScopeType[] | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly allowedOrganizationUnitIds?: readonly number[] | undefined;
  readonly subordinateUserIds?: readonly number[] | undefined;
  readonly bypassPermissionCheck?: boolean | undefined;
}

/**
 * Tham số đầu vào khi truy vấn tìm kiếm toàn hệ thống.
 */
export interface SearchQueryInput {
  readonly keyword: string;
  readonly module?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityCode?: string | undefined;
  readonly status?: number | string | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly includeStale?: boolean | undefined;
}

/**
 * Một kết quả tìm kiếm đã qua kiểm tra quyền, Data Scope và tính toán độ trễ Index.
 */
export interface SearchHitItem {
  readonly documentKey: string;
  readonly id: string | number;
  readonly entityCode: string;
  readonly module: string;
  readonly entityType: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly score: number;
  readonly matchedHighlights: readonly string[];
  readonly ownerId: number | null;
  readonly organizationUnitId: number | null;
  readonly status: number | string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sourceUpdatedAt: string;
  readonly indexedAt: string;
  readonly indexLagMs: number;
  readonly isStale: boolean;
}

/**
 * Kết quả trả về của truy vấn tìm kiếm toàn hệ thống.
 */
export interface SearchQueryResult {
  readonly keyword: string;
  readonly normalizedKeyword: string;
  readonly driverUsed: SearchEngineDriver;
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly staleHitCount: number;
  readonly maxIndexLagMs: number;
  readonly hits: readonly SearchHitItem[];
}

/**
 * 8.5.7 — Trạng thái độ trễ cập nhật Index của từng tài liệu và tổng hợp theo loại dữ liệu.
 */
export interface SearchDocumentLagRecord {
  readonly documentKey: string;
  readonly id: string | number;
  readonly entityCode: string;
  readonly module: string;
  readonly entityType: string;
  readonly title: string;
  readonly sourceUpdatedAt: string;
  readonly indexedAt: string;
  readonly lagMs: number;
  readonly staleThresholdMs: number;
  readonly isStale: boolean;
}

export interface SearchIndexLagReport {
  readonly driverUsed: SearchEngineDriver;
  readonly totalIndexedDocuments: number;
  readonly staleDocumentCount: number;
  readonly maxLagMs: number;
  readonly averageLagMs: number;
  readonly items: readonly SearchDocumentLagRecord[];
}

/**
 * 8.5.8 — Thống kê từ khóa tìm kiếm không trả về kết quả (Zero-Result Keywords).
 */
export interface ZeroResultKeywordStat {
  readonly normalizedKeyword: string;
  readonly sampleKeyword: string;
  readonly searchCount: number;
  readonly lastSearchedAt: string;
  readonly modules: readonly string[];
  readonly entityTypes: readonly string[];
  readonly lastActorId: number | null;
}

/**
 * Lịch sử đồng bộ hoặc tạo lại Search Index (8.5.4 & 8.5.5).
 */
export type SearchSyncOperationType = 'SYNC' | 'REBUILD' | 'REMOVE';
export type SearchSyncExecutionMode = 'SYNC' | 'QUEUE';
export type SearchSyncStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface SearchSyncHistoryRecord {
  readonly id: number;
  readonly operation: SearchSyncOperationType;
  readonly module: string | null;
  readonly entityType: string | null;
  readonly entityCode: string | null;
  readonly driverUsed: SearchEngineDriver;
  readonly executionMode: SearchSyncExecutionMode;
  readonly status: SearchSyncStatus;
  readonly indexedCount: number;
  readonly removedCount: number;
  readonly jobId: string | null;
  readonly actorId: number | null;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

/**
 * 8.5.1 & 8.5.2 — Giao diện Search Provider Adapter dùng chung (mặc định là Database Search, mở rộng sang Elasticsearch / OpenSearch).
 */
export interface SearchProviderAdapterContract {
  readonly driver: SearchEngineDriver;
  isAvailable(): boolean;
  indexDocuments(
    documents: readonly SearchDocumentRecord[],
  ): Promise<{ readonly indexedCount: number }> | { readonly indexedCount: number };
  removeDocuments(
    entityCode: string,
    documentIds?: readonly (string | number)[],
  ): Promise<{ readonly removedCount: number }> | { readonly removedCount: number };
  clearIndex(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
  }): Promise<{ readonly clearedCount: number }> | { readonly clearedCount: number };
  searchDocuments(
    query: SearchQueryInput,
    candidateDocs: readonly SearchDocumentRecord[],
  ): Promise<readonly SearchDocumentRecord[]> | readonly SearchDocumentRecord[];
}

/**
 * 8.5.3 — Hợp đồng cắm client Elasticsearch hoặc OpenSearch tùy chọn (chỉ cài khi dự án có dữ liệu lớn).
 */
export interface ExternalSearchEngineClientContract {
  readonly engine: 'ELASTICSEARCH' | 'OPENSEARCH';
  readonly indexPrefix?: string | undefined;
  isConnected?(): boolean;
  bulkIndex(
    indexName: string,
    documents: readonly SearchDocumentRecord[],
  ): Promise<{ readonly indexedCount: number }> | { readonly indexedCount: number };
  deleteByQuery(
    indexName: string,
    filter: {
      readonly module?: string | undefined;
      readonly entityType?: string | undefined;
      readonly entityCode?: string | undefined;
      readonly documentIds?: readonly (string | number)[] | undefined;
    },
  ): Promise<{ readonly deletedCount: number }> | { readonly deletedCount: number };
  search(
    indexName: string,
    query: SearchQueryInput,
  ): Promise<readonly SearchDocumentRecord[]> | readonly SearchDocumentRecord[];
}

/**
 * Hàm callback cho phép từng module nạp lại toàn bộ danh sách tài liệu nguồn khi gọi `rebuildIndex` (8.5.5).
 */
export type SearchableEntityDocumentLoader = () =>
  Promise<readonly SearchDocumentInput[]> | readonly SearchDocumentInput[];

/**
 * Đầu vào khi Worker thực thi tác vụ đồng bộ (`search_sync`) hoặc tạo lại toàn bộ Search Index (`search_rebuild`) qua Queue (Mục 8.5.4 & 8.5.5).
 */
export interface SearchQueueWorkerExecutionInput {
  readonly operation: 'search_sync' | 'search_rebuild';
  readonly module?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityCode?: string | undefined;
  readonly documentIds?: readonly (number | string)[] | undefined;
  readonly actorId?: number | undefined;
  readonly actor?: unknown;
  readonly historyId?: number | undefined;
  readonly jobId: string;
}

/**
 * Hợp đồng đăng ký bộ thực thi đồng bộ Search Index nền (`SearchQueueWorkerExecutor`) vào `SearchRegistryService`
 * giúp `HeavyJobProcessor` điều phối động cho mọi module mà không cần hardcode từng service.
 */
export interface SearchQueueWorkerExecutor {
  readonly module: string;
  readonly entityCode?: string | undefined;
  readonly syncTopic?: string | undefined;
  readonly rebuildTopic?: string | undefined;
  executeSearchJob(input: SearchQueueWorkerExecutionInput): Promise<SearchSyncHistoryRecord>;
}

/**
 * 8.5.1 — Quét toàn bộ `module.manifest.json` của các module đã kích hoạt để thu thập danh sách `searchableEntities`.
 */
export function discoverManifestSearchableEntities(): SearchableEntityManifestItem[] {
  const installedModules = new Set(discoverInstalledModules().map((mod) => mod.toLowerCase()));
  const discovered: SearchableEntityManifestItem[] = [];

  for (const entry of scanModuleManifests<{
    name?: string;
    searchableEntities?: SearchableEntityManifestItem[];
  }>()) {
    if (!installedModules.has(entry.moduleName)) continue;
    const items = entry.raw.searchableEntities;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (!item || typeof item.code !== 'string' || item.code.trim().length === 0) continue;
      discovered.push({
        ...item,
        code: item.code.trim(),
        module: (item.module ?? entry.moduleName).trim().toLowerCase(),
      });
    }
  }

  return discovered;
}
