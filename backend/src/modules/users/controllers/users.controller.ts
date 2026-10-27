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
import {
  type AdminResetUserMfaRequest,
  type AdminResetUserPasswordRequest,
  type AssignUserOrganizationsRequest,
  type AssignUserRolesRequest,
  type ChangeUserStatusRequest,
  type CreateUserRequest,
  type ListUserSubordinatesQuery,
  type ListUsersQuery,
  type LockUserRequest,
  type UpdateUserRequest,
  adminResetUserMfaSchema,
  adminResetUserPasswordSchema,
  assignUserOrganizationsSchema,
  assignUserRolesSchema,
  changeUserStatusSchema,
  createUserSchema,
  listUserSubordinatesQuerySchema,
  listUsersQuerySchema,
  lockUserSchema,
  updateUserSchema,
} from '../requests/users.requests.js';
import {
  type UserOrganizationHistoryItemResponse,
  type UserResponse,
  type UserStatusHistoryItemResponse,
  type UserSubordinatesOverviewResponse,
  userOrganizationHistoryItemSchema,
  userResponseSchema,
  userStatusHistoryItemSchema,
  userSubordinatesOverviewResponseSchema,
} from '../responses/users.response.js';

@ApiGroup('User Management', 'Quản lý vòng đời tài khoản người dùng (Mục 3.1)')
@Controller(USERS_ROUTES.PREFIX)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
