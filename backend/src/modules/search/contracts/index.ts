import type {
  ExternalSearchEngineClientContract,
  RegisteredSearchableEntity,
  SearchDocumentInput,
  SearchIndexLagReport,
  SearchQueryResult,
  SearchSyncHistoryRecord,
  ZeroResultKeywordStat,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';

export const SEARCH_PUBLIC_SERVICE = Symbol('SEARCH_PUBLIC_SERVICE');

export interface ISearchPublicService {
  registerExternalSearchClient(client: ExternalSearchEngineClientContract | null): void;
  listSearchableEntities(options?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly includeAllModules?: boolean | undefined;
  }): RegisteredSearchableEntity[];
  indexDocuments(
    documents: readonly SearchDocumentInput[],
    actorId?: number | null,
  ): Promise<{
    readonly driverUsed: string;
    readonly indexedCount: number;
    readonly history: SearchSyncHistoryRecord;
  }>;
  removeDocuments(
    entityCode: string,
    documentIds?: readonly (string | number)[],
    actorId?: number | null,
  ): Promise<{
    readonly deleted: true;
    readonly entityCode: string;
    readonly removedCount: number;
  }>;
  searchGlobal(
    query: {
      readonly keyword: string;
      readonly module?: string | undefined;
      readonly entityType?: string | undefined;
      readonly entityCode?: string | undefined;
      readonly status?: number | string | undefined;
      readonly organizationUnitId?: number | undefined;
      readonly page?: number | undefined;
      readonly limit?: number | undefined;
      readonly includeStale?: boolean | undefined;
    },
    actor?: UserIdentity,
  ): Promise<SearchQueryResult>;
  getSearchIndexLagReport(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityCode?: string | undefined;
    readonly staleOnly?: boolean | undefined;
    readonly staleThresholdMs?: number | undefined;
  }): SearchIndexLagReport;
  listZeroResultKeywords(filter?: {
    readonly module?: string | undefined;
    readonly entityType?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<ZeroResultKeywordStat[]>;
  deleteZeroResultKeyword(
    keywordOrId: string | number,
  ): Promise<{ readonly deleted: true; readonly target: string }>;
  listSearchSyncHistories(filter?: {
    readonly module?: string | undefined;
    readonly operation?: 'SYNC' | 'REBUILD' | 'REMOVE' | undefined;
    readonly limit?: number | undefined;
  }): Promise<SearchSyncHistoryRecord[]>;
  getSearchSyncHistoryById(historyId: number): Promise<SearchSyncHistoryRecord>;
  deleteSearchSyncHistory(
    historyId: number,
  ): Promise<{ readonly deleted: true; readonly id: number }>;
}
