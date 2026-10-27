import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { SEARCH_ROUTES } from '../routes/search.routes.js';
import { SearchService } from '../services/search.service.js';
import {
  type IndexSearchDocumentsBody,
  type ListSearchSyncHistoriesQuery,
  type ListSearchableEntitiesQuery,
  type ListZeroResultKeywordsQuery,
  type RebuildSearchIndexBody,
  type SearchGlobalQuery,
  type SearchIndexLagQuery,
  type SyncSearchIndexBody,
  indexSearchDocumentsBodySchema,
  listSearchSyncHistoriesQuerySchema,
  listSearchableEntitiesQuerySchema,
  listZeroResultKeywordsQuerySchema,
  rebuildSearchIndexBodySchema,
  searchGlobalQuerySchema,
  searchIndexLagQuerySchema,
  syncSearchIndexBodySchema,
} from '../requests/search.requests.js';
import {
  registeredSearchableEntityResponseSchema,
  searchIndexLagReportResponseSchema,
  searchQueryResultResponseSchema,
  searchSyncHistoryResponseSchema,
  zeroResultKeywordStatResponseSchema,
} from '../responses/search.response.js';

const entityCodeParamSchema = z.string().trim().min(1).max(64);
const entityIdParamSchema = z.string().trim().min(1).max(64);
const keywordParamSchema = z.string().trim().min(1).max(255);

@ApiGroup(
  'Global Search Engine',
  'Tìm kiếm toàn hệ thống, đồng bộ Index & phân tích từ khóa (Mục 8.5)',
)
@Controller(SEARCH_ROUTES.PREFIX)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** Tìm kiếm toàn hệ thống theo thực thể đã đăng ký, áp dụng quyền & Data Scope (Mục 8.5.1, 8.5.2, 8.5.3, 8.5.6, 8.5.7 & 8.5.8) */
  @Get(SEARCH_ROUTES.ROOT)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary:
      'Tìm kiếm toàn hệ thống qua Search Provider dùng chung (áp dụng Data Scope & theo dõi độ trễ Index)',
    response: searchQueryResultResponseSchema,
  })
  public async searchGlobal(
    @ValidatedQuery(searchGlobalQuerySchema) query: SearchGlobalQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.searchService.searchGlobal(query, actor);
  }

  /** Xem danh sách thực thể được phép tìm kiếm đã đăng ký theo module (Mục 8.5.1) */
  @Get(SEARCH_ROUTES.ENTITIES)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem danh sách các thực thể đã đăng ký vào Search Provider dùng chung',
    response: z.array(registeredSearchableEntityResponseSchema),
  })
  public listSearchableEntities(
    @ValidatedQuery(listSearchableEntitiesQuerySchema) query: ListSearchableEntitiesQuery,
  ) {
    return this.searchService.listSearchableEntities(query);
  }

  /** Thêm mới hoặc cập nhật tài liệu vào Search Index & bảng `search_documents` */
  @Post(SEARCH_ROUTES.DOCUMENTS)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Thêm mới hoặc cập nhật danh sách tài liệu vào Search Index (search_documents)',
  })
  public async indexSearchDocuments(
    @ValidatedBody(indexSearchDocumentsBodySchema) body: IndexSearchDocumentsBody,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.searchService.indexDocuments(body.documents, actor?.id ?? null);
  }

  /** Xóa một tài liệu khỏi Search Index & bảng `search_documents` theo `entityCode` và `entityId` */
  @Delete(SEARCH_ROUTES.DOCUMENT_BY_ENTITY_AND_ID)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Xóa tài liệu khỏi Search Index theo entityCode và entityId',
  })
  public async removeSearchDocumentById(
    @ValidatedParams(entityCodeParamSchema, 'entityCode') entityCode: string,
    @ValidatedParams(entityIdParamSchema, 'entityId') entityId: string,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.searchService.removeDocuments(entityCode, [entityId], actor?.id ?? null);
  }

  /** Đồng bộ dữ liệu sang Search Index trực tiếp hoặc qua Queue (Mục 8.5.4) */
  @Post(SEARCH_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Đồng bộ dữ liệu sang Search Index (trực tiếp hoặc chạy bằng Queue)',
    response: searchSyncHistoryResponseSchema,
  })
  public async syncSearchIndex(
    @ValidatedBody(syncSearchIndexBodySchema) body: SyncSearchIndexBody,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.searchService.syncSearchIndex(body, actor);
  }

  /** Tạo lại toàn bộ Search Index theo module hoặc loại dữ liệu (Mục 8.5.5) */
  @Post(SEARCH_ROUTES.REBUILD)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Tạo lại toàn bộ Search Index theo module hoặc loại dữ liệu (entityType)',
    response: searchSyncHistoryResponseSchema,
  })
  public async rebuildSearchIndex(
    @ValidatedBody(rebuildSearchIndexBodySchema) body: RebuildSearchIndexBody,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.searchService.rebuildSearchIndex(body, actor);
  }

  /** Theo dõi độ trễ cập nhật Search Index để phát hiện kết quả tìm kiếm bị cũ (Mục 8.5.7) */
  @Get(SEARCH_ROUTES.LAG)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Theo dõi độ trễ cập nhật Search Index (phát hiện kết quả tìm kiếm bị cũ)',
    response: searchIndexLagReportResponseSchema,
  })
  public getSearchIndexLag(@ValidatedQuery(searchIndexLagQuerySchema) query: SearchIndexLagQuery) {
    return this.searchService.getSearchIndexLagReport(query);
  }

  /** Thống kê các từ khóa tìm kiếm không có kết quả để cải thiện chất lượng tìm kiếm (Mục 8.5.8) */
  @Get(SEARCH_ROUTES.ZERO_RESULTS)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Thống kê từ khóa tìm kiếm không có kết quả (Zero-Result Keywords)',
    response: z.array(zeroResultKeywordStatResponseSchema),
  })
  public async listZeroResultKeywords(
    @ValidatedQuery(listZeroResultKeywordsQuerySchema) query: ListZeroResultKeywordsQuery,
  ) {
    return this.searchService.listZeroResultKeywords(query);
  }

  /** Xóa thống kê một từ khóa không có kết quả theo từ khóa hoặc ID */
  @Delete(SEARCH_ROUTES.ZERO_RESULT_BY_KEYWORD)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Xóa mục thống kê từ khóa 0 kết quả',
  })
  public async deleteZeroResultKeyword(
    @ValidatedParams(keywordParamSchema, 'keyword') keyword: string,
  ) {
    return this.searchService.deleteZeroResultKeyword(keyword);
  }

  /** Xem lịch sử đồng bộ / tạo lại Search Index (Mục 8.5.4 & 8.5.5) */
  @Get(SEARCH_ROUTES.HISTORIES)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem danh sách lịch sử đồng bộ & tạo lại Search Index',
    response: z.array(searchSyncHistoryResponseSchema),
  })
  public async listSearchSyncHistories(
    @ValidatedQuery(listSearchSyncHistoriesQuerySchema) query: ListSearchSyncHistoriesQuery,
  ) {
    return this.searchService.listSearchSyncHistories(query);
  }

  /** Xem chi tiết một bản ghi lịch sử đồng bộ Search Index theo ID */
  @Get(SEARCH_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem chi tiết bản ghi lịch sử đồng bộ Search Index theo ID',
    response: searchSyncHistoryResponseSchema,
  })
  public async getSearchSyncHistoryById(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.searchService.getSearchSyncHistoryById(historyId);
  }

  /** Xóa một bản ghi lịch sử đồng bộ Search Index theo ID */
  @Delete(SEARCH_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Xóa bản ghi lịch sử đồng bộ Search Index theo ID',
  })
  public async deleteSearchSyncHistory(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.searchService.deleteSearchSyncHistory(historyId);
  }
}
