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
import { UsersService } from '../services/users.service.js';
import { UserImportExportService } from '../services/user-import-export.service.js';
import {
  type AssignUserOrganizationsRequest,
  type AssignUserRolesRequest,
  type BulkImportUsersRequest,
  type ChangeUserStatusRequest,
  type CreateUserRequest,
  type ListUsersQuery,
  type LockUserRequest,
  type UpdateUserRequest,
  assignUserOrganizationsSchema,
  assignUserRolesSchema,
  bulkImportUsersSchema,
  changeUserStatusSchema,
  createUserSchema,
  listUsersQuerySchema,
  lockUserSchema,
  updateUserSchema,
} from '../requests/users.requests.js';
import {
  type BulkImportUsersResultResponse,
  type ExportUsersCsvResponse,
  type UserResponse,
  type UserStatusHistoryItemResponse,
  bulkImportUsersResultSchema,
  exportUsersCsvResponseSchema,
  userResponseSchema,
  userStatusHistoryItemSchema,
} from '../responses/users.response.js';

@ApiGroup('User Management', 'Quản lý vòng đời tài khoản người dùng (Mục 3.1)')
@Controller(USERS_ROUTES.PREFIX)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly importExportService: UserImportExportService,
  ) {}

  /** Tìm kiếm và lọc người dùng có phân trang (Mục 3.1.9) */
  @Get()
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Tìm kiếm và lọc danh sách người dùng có phân trang',
    response: userResponseSchema,
    pagination: 'offset',
  })
  public async list(
    @ValidatedQuery(listUsersQuerySchema) query: ListUsersQuery,
  ): Promise<PaginatedResult<UserResponse>> {
    return this.usersService.listPaginated(query);
  }

  /** Xuất danh sách người dùng ra Excel (.xlsx) hoặc CSV (.csv) theo bộ lọc (Mục 3.1.8) */
  @Get(USERS_ROUTES.EXPORT)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Xuất danh sách người dùng ra định dạng Excel (.xlsx) hoặc CSV (.csv)',
    response: exportUsersCsvResponseSchema,
  })
  public async exportCsv(
    @ValidatedQuery(listUsersQuerySchema) query: ListUsersQuery,
  ): Promise<ExportUsersCsvResponse> {
    return this.importExportService.exportUsersCsv(query);
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
    return this.importExportService.exportImportTemplate(query.format === 'csv' ? 'csv' : 'xlsx');
  }

  /** Nhập người dùng hàng loạt từ file Excel (.xlsx), CSV hoặc JSON (Mục 3.1.7) */
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
    return this.importExportService.bulkImport(body, actor?.id);
  }

  /** Xem chi tiết thông tin một người dùng */
  @Get(USERS_ROUTES.BY_ID)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem chi tiết hồ sơ người dùng theo ID',
    response: userResponseSchema,
  })
  public async getById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<UserResponse> {
    return this.usersService.getById(id);
  }

  /** Xem lịch sử thay đổi trạng thái của người dùng (Mục 3.1.10) */
  @Get(USERS_ROUTES.STATUS_HISTORY)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary:
      'Xem lịch sử thay đổi trạng thái (Active / Inactive / Locked / Archived) của người dùng',
    response: z.array(userStatusHistoryItemSchema),
  })
  public async getStatusHistory(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<UserStatusHistoryItemResponse[]> {
    return this.usersService.getStatusHistory(id);
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
  ): Promise<UserResponse> {
    return this.usersService.update(id, body);
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
    return this.usersService.lockUser(id, body, actor?.id);
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
    return this.usersService.unlockUser(id, actor?.id);
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
    return this.usersService.deactivateUser(id, undefined, actor?.id);
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
    return this.usersService.activateUser(id, actor?.id);
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
    return this.usersService.changeStatus(id, body, actor?.id);
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
    return this.usersService.archiveUser(id, actor?.id);
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
    return this.usersService.restoreUser(id, actor?.id);
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
    return this.usersService.assignRoles(id, body, actor?.id);
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
  ): Promise<UserResponse> {
    return this.usersService.assignOrganizations(id, body);
  }
}
