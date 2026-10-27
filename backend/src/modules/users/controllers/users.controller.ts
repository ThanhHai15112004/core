import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_STATUS_CODE, type PaginatedResult } from '@packages/kernel/index.js';
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
import { USERS_ROUTES } from '../routes/users.routes.js';
import { Optional } from '@nestjs/common';
import { UsersService } from '../services/users.service.js';
import { UserImportService } from '../import/index.js';
import { UserExportService } from '../export/index.js';
import { UserReportService } from '../reports/index.js';
import { UserSearchService } from '../search/index.js';
import {
  type AdminResetUserMfaRequest,
  type AdminResetUserPasswordRequest,
  type AssignUserOrganizationsRequest,
  type AssignUserRolesRequest,
  type BulkImportUsersRequest,
  type ChangeUserStatusRequest,
  type CreateUserReportScheduleRequest,
  type CreateUserRequest,
  type ListUserExportHistoriesQuery,
  type ListUserImportHistoriesQuery,
  type ListUserReportHistoriesQuery,
  type ListUserReportSchedulesQuery,
  type ListUserSubordinatesQuery,
  type ListUsersQuery,
  type ListZeroResultKeywordsQuery,
  type LockUserRequest,
  type PreviewImportUsersRequest,
  type RebuildUserSearchIndexBody,
  type RunUserReportRequest,
  type SearchIndexLagQuery,
  type SearchUsersGlobalQueryRequest,
  type SyncUserSearchIndexBody,
  type UpdateUserRequest,
  adminResetUserMfaSchema,
  adminResetUserPasswordSchema,
  assignUserOrganizationsSchema,
  assignUserRolesSchema,
  bulkImportUsersSchema,
  changeUserStatusSchema,
  createUserReportScheduleSchema,
  createUserSchema,
  listUserExportHistoriesQuerySchema,
  listUserImportHistoriesQuerySchema,
  listUserReportHistoriesQuerySchema,
  listUserReportSchedulesQuerySchema,
  listUserSubordinatesQuerySchema,
  listUsersQuerySchema,
  listZeroResultKeywordsQuerySchema,
  lockUserSchema,
  previewImportUsersSchema,
  rebuildUserSearchIndexSchema,
  runUserReportSchema,
  searchIndexLagQuerySchema,
  searchUsersGlobalQuerySchema,
  syncUserSearchIndexSchema,
  updateUserSchema,
} from '../requests/users.requests.js';
import {
  type BulkImportUsersResultResponse,
  type ExportUsersCsvResponse,
  type UserOrganizationHistoryItemResponse,
  type UserReportExecutionResponse,
  type UserResponse,
  type UserStatusHistoryItemResponse,
  type UserSubordinatesOverviewResponse,
  bulkImportUsersResultSchema,
  exportHistoryItemResponseSchema,
  exportJobProgressResponseSchema,
  exportTemporaryDownloadResponseSchema,
  exportUsersCsvResponseSchema,
  importHistoryItemResponseSchema,
  importJobProgressResponseSchema,
  importUsersPreviewResponseSchema,
  registeredReportDefinitionResponseSchema,
  registeredSearchableEntityResponseSchema,
  searchIndexLagReportResponseSchema,
  searchQueryResultResponseSchema,
  searchSyncHistoryResponseSchema,
  userOrganizationHistoryItemSchema,
  userReportExecutionResponseSchema,
  userReportHistoryItemResponseSchema,
  userReportScheduleItemResponseSchema,
  userResponseSchema,
  userStatusHistoryItemSchema,
  userSubordinatesOverviewResponseSchema,
  zeroResultKeywordStatResponseSchema,
} from '../responses/users.response.js';

@ApiGroup('User Management', 'Quản lý vòng đời tài khoản người dùng (Mục 3.1)')
@Controller(USERS_ROUTES.PREFIX)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly importService: UserImportService,
    private readonly exportService: UserExportService,
    @Optional() private readonly reportService?: UserReportService,
    @Optional() private readonly searchService?: UserSearchService,
  ) {}

  /** Tìm kiếm và lọc người dùng có phân trang kèm áp dụng Phạm vi dữ liệu (Mục 3.1.9 & 4.3.5) */
  @Get()
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Tìm kiếm và lọc danh sách người dùng có phân trang (áp dụng Data Scope Mục 4.3)',
    response: userResponseSchema,
    pagination: 'offset',
  })
  public async list(
    @ValidatedQuery(listUsersQuerySchema) query: ListUsersQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<UserResponse>> {
    return this.usersService.listPaginated(query, actor);
  }

  /** Xuất danh sách người dùng ra Excel (.xlsx), CSV (.csv) hoặc PDF (.pdf) theo bộ lọc & Phạm vi dữ liệu (Mục 3.1.8, 3.5.7, 4.3.5 & 8.3) */
  @Get(USERS_ROUTES.EXPORT)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary:
      'Xuất danh sách người dùng ra định dạng Excel (.xlsx), CSV (.csv) hoặc PDF (.pdf) theo Data Scope',
    response: exportUsersCsvResponseSchema,
  })
  public async exportCsv(
    @ValidatedQuery(listUsersQuerySchema) query: ListUsersQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ExportUsersCsvResponse> {
    await this.usersService.verifySensitiveActionStepUp(
      actor?.id,
      query.stepUpToken,
      query.requireStepUp,
      'users.export',
    );
    return this.exportService.exportUsersCsv(query, actor);
  }

  /** Xem danh sách lịch sử Export người dùng (Người thực hiện, bộ lọc và số dòng — Mục 8.3.7) */
  @Get(USERS_ROUTES.EXPORT_HISTORIES)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Xem danh sách lịch sử Export người dùng (Người thực hiện, bộ lọc và số dòng)',
    response: z.array(exportHistoryItemResponseSchema),
  })
  public listExportHistories(
    @ValidatedQuery(listUserExportHistoriesQuerySchema) query: ListUserExportHistoriesQuery,
  ) {
    return this.exportService.listExportHistories(query);
  }

  /** Xem chi tiết một bản ghi lịch sử Export người dùng theo ID (Mục 8.3.7) */
  @Get(USERS_ROUTES.EXPORT_HISTORY_BY_ID)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Xem chi tiết bản ghi lịch sử Export người dùng theo ID',
    response: exportHistoryItemResponseSchema,
  })
  public getExportHistoryById(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.exportService.getExportHistoryById(historyId);
  }

  /** Theo dõi tiến độ công việc Export chạy nền qua Queue (Mục 8.3.4) */
  @Get(USERS_ROUTES.EXPORT_JOB_PROGRESS)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Xem tiến độ công việc Export người dùng chạy nền qua Queue',
    response: exportJobProgressResponseSchema,
  })
  public getExportJobProgress(@ValidatedParams(z.string().trim().min(1), 'jobId') jobId: string) {
    return this.exportService.getExportJobProgress(jobId);
  }

  /** Tải xuống file Export qua đường dẫn tạm thời (tự động chặn khi file đã hết hạn — Mục 8.3.5 & 8.3.8) */
  @Get(USERS_ROUTES.EXPORT_DOWNLOAD_BY_TOKEN)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Tải file Export tạm thời theo token (tự động hết hạn theo TTL cấu hình)',
    response: exportTemporaryDownloadResponseSchema,
  })
  public downloadTemporaryExport(
    @ValidatedParams(z.string().trim().min(1), 'token') token: string,
  ) {
    return this.exportService.downloadTemporaryExport(token);
  }

  /** Danh sách các báo cáo & dashboard đã đăng ký của module người dùng (Mục 8.4.1 & 8.4.3 — dùng quyền riêng `users.report`) */
  @Get(USERS_ROUTES.REPORTS)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary:
      'Lấy danh sách các báo cáo & dashboard đã đăng ký của module người dùng (phân quyền riêng users.report)',
    response: z.array(registeredReportDefinitionResponseSchema),
  })
  public listAvailableReports() {
    return this.reportService?.listAvailableReports() ?? [];
  }

  /** Thực thi báo cáo / dashboard nhân sự (Mục 8.4.2, 8.4.3, 8.4.4, 8.4.6, 8.4.7, 8.4.8, 8.4.9) */
  @Post(USERS_ROUTES.REPORTS_RUN)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary:
      'Chạy báo cáo / dashboard nhân sự (hỗ trợ lọc khoảng ngày/trạng thái/đơn vị, Queue cho báo cáo nặng, Read Replica, Cache & file tạm)',
    response: userReportExecutionResponseSchema,
  })
  public async runReport(
    @ValidatedBody(runUserReportSchema) body: RunUserReportRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserReportExecutionResponse> {
    return this.reportService!.runReport(body, actor);
  }

  /** Lên lịch gửi báo cáo định kỳ theo ngày, tuần hoặc tháng (Mục 8.4.5 & 8.4.6) */
  @Post(USERS_ROUTES.REPORTS_SCHEDULES)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary:
      'Lên lịch gửi báo cáo nhân sự định kỳ theo ngày (DAILY), tuần (WEEKLY) hoặc tháng (MONTHLY)',
    response: userReportScheduleItemResponseSchema,
  })
  public createReportSchedule(
    @ValidatedBody(createUserReportScheduleSchema) body: CreateUserReportScheduleRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.reportService!.createReportSchedule(body, actor);
  }

  /** Xem danh sách lịch gửi báo cáo định kỳ của module người dùng (Mục 8.4.5) */
  @Get(USERS_ROUTES.REPORTS_SCHEDULES)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xem danh sách lịch gửi báo cáo định kỳ (DAILY / WEEKLY / MONTHLY)',
    response: z.array(userReportScheduleItemResponseSchema),
  })
  public listReportSchedules(
    @ValidatedQuery(listUserReportSchedulesQuerySchema) query: ListUserReportSchedulesQuery,
  ) {
    return this.reportService?.listReportSchedules(query) ?? [];
  }

  /** Kích hoạt chạy các lịch gửi báo cáo đã đến hạn (Mục 8.4.5 & 8.4.6) */
  @Post(USERS_ROUTES.REPORTS_SCHEDULES_TRIGGER_DUE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary:
      'Kích hoạt thực thi các lịch báo cáo đã đến hạn kèm gửi Email / thông báo chứa file tạm',
  })
  public async triggerDueReportSchedules() {
    return this.reportService!.triggerDueReportSchedules();
  }

  /** Xem danh sách lịch sử chạy báo cáo (Thời gian, người chạy và kết quả — Mục 8.4.7) */
  @Get(USERS_ROUTES.REPORTS_HISTORIES)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xem danh sách lịch sử chạy báo cáo (Thời gian, người chạy, nguồn đọc và kết quả)',
    response: z.array(userReportHistoryItemResponseSchema),
  })
  public listReportHistories(
    @ValidatedQuery(listUserReportHistoriesQuerySchema) query: ListUserReportHistoriesQuery,
  ) {
    return this.reportService?.listReportHistories(query) ?? [];
  }

  /** Xem chi tiết một bản ghi lịch sử chạy báo cáo theo ID (Mục 8.4.7) */
  @Get(USERS_ROUTES.REPORTS_HISTORY_BY_ID)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xem chi tiết bản ghi lịch sử chạy báo cáo theo ID',
    response: userReportHistoryItemResponseSchema,
  })
  public getReportHistoryById(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.reportService!.getReportHistoryById(historyId);
  }

  /** Tải xuống file báo cáo tạm thời qua token (tự động chặn khi file đã hết hạn — Mục 8.4.6) */
  @Get(USERS_ROUTES.REPORTS_DOWNLOAD_BY_TOKEN)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Tải file báo cáo tạm thời theo token (tự động hết hạn theo TTL cấu hình)',
    response: exportTemporaryDownloadResponseSchema,
  })
  public downloadTemporaryReport(
    @ValidatedParams(z.string().trim().min(1), 'token') token: string,
  ) {
    return this.reportService!.downloadTemporaryReport(token);
  }

  /** Tìm kiếm toàn hệ thống theo thực thể đã đăng ký, áp dụng quyền & Data Scope (Mục 8.5.1, 8.5.2, 8.5.3, 8.5.6, 8.5.7 & 8.5.8) */
  @Get(USERS_ROUTES.SEARCH)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary:
      'Tìm kiếm người dùng & thực thể liên quan qua Search Provider dùng chung (áp dụng Data Scope & theo dõi độ trễ Index)',
    response: searchQueryResultResponseSchema,
  })
  public async searchGlobal(
    @ValidatedQuery(searchUsersGlobalQuerySchema) query: SearchUsersGlobalQueryRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.searchService!.searchUsers(query, actor);
  }

  /** Xem danh sách thực thể được phép tìm kiếm đã đăng ký theo module (Mục 8.5.1) */
  @Get(USERS_ROUTES.SEARCH_ENTITIES)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem danh sách các thực thể đã đăng ký vào Search Provider dùng chung',
    response: z.array(registeredSearchableEntityResponseSchema),
  })
  public listSearchableEntities() {
    return this.searchService?.listSearchableEntities({ includeAllModules: true }) ?? [];
  }

  /** Đồng bộ dữ liệu người dùng sang Search Index trực tiếp hoặc qua Queue (Mục 8.5.4) */
  @Post(USERS_ROUTES.SEARCH_SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Đồng bộ dữ liệu người dùng sang Search Index (trực tiếp hoặc chạy bằng Queue)',
    response: searchSyncHistoryResponseSchema,
  })
  public async syncSearchIndex(
    @ValidatedBody(syncUserSearchIndexSchema) body: SyncUserSearchIndexBody,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.searchService!.syncUsersToSearchIndex(body, actor);
  }

  /** Tạo lại toàn bộ Search Index theo module hoặc loại dữ liệu (Mục 8.5.5) */
  @Post(USERS_ROUTES.SEARCH_REBUILD)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Tạo lại toàn bộ Search Index theo module hoặc loại dữ liệu (entityType)',
    response: searchSyncHistoryResponseSchema,
  })
  public async rebuildSearchIndex(
    @ValidatedBody(rebuildUserSearchIndexSchema) body: RebuildUserSearchIndexBody,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.searchService!.rebuildSearchIndex(body, actor);
  }

  /** Theo dõi độ trễ cập nhật Search Index để phát hiện kết quả tìm kiếm bị cũ (Mục 8.5.7) */
  @Get(USERS_ROUTES.SEARCH_LAG)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Theo dõi độ trễ cập nhật Search Index (phát hiện kết quả tìm kiếm bị cũ)',
    response: searchIndexLagReportResponseSchema,
  })
  public getSearchIndexLag(@ValidatedQuery(searchIndexLagQuerySchema) query: SearchIndexLagQuery) {
    return this.searchService!.getSearchIndexLagReport(query);
  }

  /** Thống kê các từ khóa tìm kiếm không có kết quả để cải thiện chất lượng tìm kiếm (Mục 8.5.8) */
  @Get(USERS_ROUTES.SEARCH_ZERO_RESULTS)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Thống kê từ khóa tìm kiếm không có kết quả (Zero-Result Keywords)',
    response: z.array(zeroResultKeywordStatResponseSchema),
  })
  public listZeroResultKeywords(
    @ValidatedQuery(listZeroResultKeywordsQuerySchema) query: ListZeroResultKeywordsQuery,
  ) {
    return this.searchService?.listZeroResultKeywords(query) ?? [];
  }

  /** Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) để nhập người dùng hàng loạt (Mục 3.1.7) */
  @Get(USERS_ROUTES.IMPORT_TEMPLATE)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary:
      'Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) cho chức năng Import người dùng',
    response: exportUsersCsvResponseSchema,
  })
  public exportImportTemplate(
    @ValidatedQuery(listUsersQuerySchema) query: ListUsersQuery,
  ): ExportUsersCsvResponse {
    return this.exportService.exportImportTemplate(query.format === 'csv' ? 'csv' : 'xlsx');
  }

  /** Nhập người dùng hàng loạt từ file Excel (.xlsx), CSV hoặc JSON (Mục 3.1.7 & 8.2) */
  @Post(USERS_ROUTES.BULK_IMPORT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Nhập người dùng hàng loạt từ file Excel (.xlsx base64), CSV hoặc danh sách JSON',
    response: bulkImportUsersResultSchema,
  })
  public async bulkImport(
    @ValidatedBody(bulkImportUsersSchema) body: BulkImportUsersRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<BulkImportUsersResultResponse> {
    return this.importService.bulkImport(body, actor?.id);
  }

  /** Xem trước dữ liệu trước khi nhập (Preview / Dry-run): ánh xạ cột, dòng mẫu và lỗi từng dòng/cột (Mục 8.2.3, 8.2.4, 8.2.5) */
  @Post(USERS_ROUTES.BULK_IMPORT_PREVIEW)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary:
      'Xem trước dữ liệu trước khi nhập (Preview / Dry-run): ánh xạ cột, dòng mẫu và kiểm tra lỗi theo dòng/cột',
    response: importUsersPreviewResponseSchema,
  })
  public async previewBulkImport(
    @ValidatedBody(previewImportUsersSchema) body: PreviewImportUsersRequest,
  ) {
    return this.importService.previewImport(body);
  }

  /** Xem danh sách lịch sử Import người dùng (File, người thực hiện, trạng thái và kết quả — Mục 8.2.9) */
  @Get(USERS_ROUTES.BULK_IMPORT_HISTORIES)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Xem danh sách lịch sử Import người dùng (File, người thực hiện và kết quả)',
    response: z.array(importHistoryItemResponseSchema),
  })
  public listImportHistories(
    @ValidatedQuery(listUserImportHistoriesQuerySchema) query: ListUserImportHistoriesQuery,
  ) {
    return this.importService.listImportHistories(query);
  }

  /** Xem chi tiết một bản ghi lịch sử Import người dùng theo ID (Mục 8.2.9) */
  @Get(USERS_ROUTES.BULK_IMPORT_HISTORY_BY_ID)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Xem chi tiết bản ghi lịch sử Import người dùng theo ID',
    response: importHistoryItemResponseSchema,
  })
  public getImportHistoryById(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.importService.getImportHistoryById(historyId);
  }

  /** Theo dõi tiến độ công việc Import (số dòng thành công, lỗi và còn lại — Mục 8.2.8) */
  @Get(USERS_ROUTES.BULK_IMPORT_JOB_PROGRESS)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Xem tiến độ công việc Import người dùng (số dòng thành công, lỗi và còn lại)',
    response: importJobProgressResponseSchema,
  })
  public getImportJobProgress(@ValidatedParams(z.string().trim().min(1), 'jobId') jobId: string) {
    return this.importService.getImportJobProgress(jobId);
  }

  /** Xem chi tiết thông tin một người dùng kèm kiểm tra phạm vi dữ liệu chống đổi ID (Mục 4.3.6) */
  @Get(USERS_ROUTES.BY_ID)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem chi tiết hồ sơ người dùng theo ID (kiểm tra Data Scope chống đổi ID — Mục 4.3.6)',
    response: userResponseSchema,
  })
  public async getById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.getById(id, true, actor);
  }

  /** Xem lịch sử thay đổi trạng thái của người dùng (Mục 3.1.10 & 4.3.6) */
  @Get(USERS_ROUTES.STATUS_HISTORY)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary:
      'Xem lịch sử thay đổi trạng thái (Active / Inactive / Locked / Archived) của người dùng',
    response: z.array(userStatusHistoryItemSchema),
  })
  public async getStatusHistory(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserStatusHistoryItemResponse[]> {
    return this.usersService.getStatusHistory(id, actor);
  }

  /** Xem lịch sử tham gia & điều chuyển đơn vị của người dùng (Mục 9.2.6) */
  @Get(USERS_ROUTES.ORGANIZATION_HISTORY)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary:
      'Xem lịch sử gán, cập nhật, điều chuyển và kết thúc đơn vị tổ chức của người dùng (Mục 9.2.6)',
    response: z.array(userOrganizationHistoryItemSchema),
  })
  public async getOrganizationHistory(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserOrganizationHistoryItemResponse[]> {
    return this.usersService.getOrganizationHistory(id, actor);
  }

  /** Tra cứu danh sách cấp dưới và chuỗi phê duyệt của người dùng (Mục 9.2.7 — dùng cho Data Scope và Approval) */
  @Get(USERS_ROUTES.SUBORDINATES)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary:
      'Tra cứu danh sách cấp dưới (trực tiếp, tạm thời, gián tiếp) và chuỗi người phê duyệt (Approval Chain) của người dùng (Mục 9.2.7)',
    response: userSubordinatesOverviewResponseSchema,
  })
  public async getSubordinates(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedQuery(listUserSubordinatesQuerySchema) query: ListUserSubordinatesQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserSubordinatesOverviewResponse> {
    return this.usersService.getSubordinatesOverview(id, query, actor);
  }

  /** Tạo mới người dùng (Mục 3.1.1) */
  @Post()
  @RequirePermissions('users.create')
  @ApiDoc({
    summary: 'Tạo mới người dùng',
    status: HTTP_STATUS_CODE.CREATED,
    response: userResponseSchema,
  })
  public async create(
    @ValidatedBody(createUserSchema) body: CreateUserRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.create(body, actor?.id);
  }

  /** Cập nhật thông tin người dùng (Mục 3.1.2) */
  @Patch(USERS_ROUTES.BY_ID)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Cập nhật thông tin hồ sơ người dùng',
    response: userResponseSchema,
  })
  public async update(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateUserSchema) body: UpdateUserRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.update(id, body, actor?.id, actor);
  }

  /** Khóa tài khoản người dùng (Mục 3.1.3) */
  @Post(USERS_ROUTES.LOCK)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Khóa tài khoản người dùng kèm lý do và thời hạn khóa',
    response: userResponseSchema,
  })
  public async lockUser(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(lockUserSchema) body: LockUserRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.lockUser(id, body, actor?.id, actor);
  }

  /** Mở khóa tài khoản người dùng (Mục 3.1.3) */
  @Post(USERS_ROUTES.UNLOCK)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Mở khóa tài khoản người dùng',
    response: userResponseSchema,
  })
  public async unlockUser(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.unlockUser(id, actor?.id, actor);
  }

  /** Vô hiệu hóa người dùng — chuyển trạng thái sang INACTIVE (2) (Mục 3.1.4) */
  @Post(USERS_ROUTES.DEACTIVATE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Vô hiệu hóa tài khoản người dùng (Inactive)',
    response: userResponseSchema,
  })
  public async deactivateUser(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.deactivateUser(id, undefined, actor?.id, actor);
  }

  /** Kích hoạt lại người dùng — chuyển trạng thái sang ACTIVE (1) (Mục 3.1.10) */
  @Post(USERS_ROUTES.ACTIVATE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Kích hoạt lại tài khoản người dùng (Active)',
    response: userResponseSchema,
  })
  public async activateUser(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.activateUser(id, actor?.id, actor);
  }

  /** Thay đổi trạng thái người dùng Active (1) / Inactive (2) / Locked (3) / Archived (4) (Mục 3.1.10) */
  @Put(USERS_ROUTES.STATUS)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Quản lý chuyển đổi trạng thái Active, Inactive, Locked, Archived của người dùng',
    response: userResponseSchema,
  })
  public async changeStatus(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(changeUserStatusSchema) body: ChangeUserStatusRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.changeStatus(id, body, actor?.id, actor);
  }

  /** Lưu trữ (Archive / Soft Delete) người dùng (Mục 3.1.4) */
  @Delete(USERS_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Lưu trữ (Archive / Xóa mềm) tài khoản người dùng',
    response: userResponseSchema,
  })
  public async archiveUser(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.archiveUser(id, actor?.id, actor);
  }

  /** Khôi phục người dùng đã lưu trữ (Mục 3.1.4) */
  @Post(USERS_ROUTES.RESTORE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Khôi phục tài khoản người dùng đã lưu trữ',
    response: userResponseSchema,
  })
  public async restoreUser(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.restoreUser(id, actor?.id, actor);
  }

  /** Gán vai trò cho người dùng (Mục 3.1.5) */
  @Put(USERS_ROUTES.ROLES)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Gán danh sách vai trò cho người dùng',
    response: userResponseSchema,
  })
  public async assignRoles(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(assignUserRolesSchema) body: AssignUserRolesRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.assignRoles(id, body, actor?.id, actor);
  }

  /** Gán người dùng vào các đơn vị hoặc chi nhánh (Mục 3.1.6) */
  @Put(USERS_ROUTES.ORGANIZATIONS)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Gán người dùng vào các đơn vị hoặc chi nhánh',
    response: userResponseSchema,
  })
  public async assignOrganizations(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(assignUserOrganizationsSchema) body: AssignUserOrganizationsRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<UserResponse> {
    return this.usersService.assignOrganizations(id, body, actor?.id, actor);
  }

  /** Reset mật khẩu người dùng từ trang quản trị (Mục 3.3.3 — chỉ người có quyền được thực hiện) */
  @Post(USERS_ROUTES.RESET_PASSWORD)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Đặt lại mật khẩu người dùng từ trang quản trị và thu hồi phiên đăng nhập',
    response: z.object({
      reset: z.literal(true),
      userId: z.number().int().positive(),
      revokedSessionsCount: z.number().int().min(0),
      generatedPassword: z.string().optional(),
    }),
  })
  public async resetUserPassword(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(adminResetUserPasswordSchema) body: AdminResetUserPasswordRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.usersService.adminResetPassword(id, body ?? {}, actor?.id, actor);
  }

  /** Reset MFA có kiểm soát từ trang quản trị (Mục 3.5.8 — có xác minh hoặc phê duyệt) */
  @Post(USERS_ROUTES.RESET_MFA)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary:
      'Reset MFA có kiểm soát cho người dùng bị mất thiết bị xác thực (kèm lý do/xác minh và thu hồi phiên)',
    response: z.object({
      reset: z.literal(true),
      userId: z.number().int().positive(),
      revokedSessionsCount: z.number().int().min(0),
      revokedTrustedDevicesCount: z.number().int().min(0),
      reason: z.string(),
      verificationReference: z.string().nullable().optional(),
      resetByActorId: z.number().int().nullable().optional(),
      resetAt: z.string(),
    }),
  })
  public async resetUserMfa(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(adminResetUserMfaSchema) body: AdminResetUserMfaRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.usersService.adminResetMfa(id, body, actor?.id, actor);
  }

  /** Thu hồi toàn bộ phiên đăng nhập của người dùng khi có sự cố (Mục 3.4.6) */
  @Post(USERS_ROUTES.REVOKE_SESSIONS)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Thu hồi toàn bộ phiên đăng nhập của người dùng khi phát hiện sự cố bảo mật',
    response: z.object({
      revoked: z.literal(true),
      userId: z.number().int().positive(),
      revokedCount: z.number().int().min(0),
      revokedSessionsCount: z.number().int().min(0).optional(),
      reason: z.string().optional(),
    }),
  })
  public async revokeUserSessions(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(z.object({ reason: z.string().trim().max(255).optional() }).default({}))
    body?: { reason?: string },
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.usersService.revokeUserSessions(id, body?.reason, actor?.id, actor);
  }

  /** Xem lịch sử đăng nhập & đăng xuất của một người dùng theo thời gian, IP và thiết bị (Mục 3.4.7 & 4.3.6) */
  @Get(USERS_ROUTES.LOGIN_HISTORY)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem lịch sử đăng nhập và đăng xuất của người dùng theo thời gian, IP và thiết bị',
  })
  public async getLoginHistory(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.usersService.getLoginHistory(id, 50, actor);
  }
}
