import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
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
import { ROLES_ROUTES } from '../routes/roles.routes.js';
import { RolesService } from '../services/roles.service.js';
import {
  type CloneRoleRequest,
  type CreateRoleRequest,
  type ListAuditLogsQuery,
  type ListRolesQuery,
  type SetRolePermissionsRequest,
  type SyncPermissionsRequest,
  type UpdateRoleRequest,
  cloneRoleSchema,
  createRoleSchema,
  listAuditLogsQuerySchema,
  listRolesQuerySchema,
  setRolePermissionsSchema,
  syncPermissionsSchema,
  updateRoleSchema,
} from '../requests/roles.requests.js';
import {
  type OrphanedPermissionWarningResponse,
  type PermissionCatalogItemResponse,
  type PermissionFunctionalGroupResponse,
  type RoleAssignedUserResponse,
  type RolePermissionMatrixResponse,
  type RoleResponse,
  type SyncPermissionsResultResponse,
  orphanedPermissionWarningResponseSchema,
  permissionCatalogItemResponseSchema,
  permissionFunctionalGroupResponseSchema,
  roleAssignedUserResponseSchema,
  rolePermissionMatrixResponseSchema,
  roleResponseSchema,
  syncPermissionsResultResponseSchema,
} from '../responses/roles.response.js';

@ApiGroup(
  'Roles & Permissions',
  'Quản lý vai trò, phân quyền RBAC, Phạm vi dữ liệu Data Scope & Nhật ký thao tác Audit Log (Mục 4.1 -> 4.4)',
)
@Controller(ROLES_ROUTES.PREFIX)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /** Danh sách vai trò kèm danh sách quyền, phạm vi dữ liệu và số lượng người đang sử dụng */
  @Get()
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary:
      'Danh sách các vai trò hệ thống và vai trò tùy chỉnh kèm phạm vi dữ liệu (Mục 4.1 & 4.3)',
    response: z.array(roleResponseSchema),
  })
  public async list(
    @ValidatedQuery(listRolesQuerySchema) query: ListRolesQuery,
  ): Promise<RoleResponse[]> {
    return this.rolesService.list(query);
  }

  /** Xem phạm vi dữ liệu hiệu lực của người dùng hiện hành và danh sách rule phạm vi nghiệp vụ (Mục 4.3) */
  @Get(ROLES_ROUTES.DATA_SCOPES_ME)
  @ApiDoc({
    summary: 'Xem phạm vi dữ liệu hiệu lực (Data Scope) của tài khoản đang đăng nhập (Mục 4.3)',
  })
  public async myEffectiveDataScope(@CurrentUser() actor?: UserIdentity) {
    return this.rolesService.getActorEffectiveDataScope(actor, 'users');
  }

  /** Xem danh sách các rule phạm vi dữ liệu riêng do module nghiệp vụ đăng ký (Mục 4.3.7) */
  @Get(ROLES_ROUTES.DATA_SCOPES_RULES)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Danh sách các rule phạm vi dữ liệu riêng do các module nghiệp vụ đăng ký (Mục 4.3.7)',
  })
  public listCustomScopeRules() {
    return this.rolesService.listCustomScopeRules();
  }

  /** Đăng ký rule phạm vi dữ liệu riêng của module nghiệp vụ mà không sửa Core (Mục 4.3.7) */
  @Post(ROLES_ROUTES.DATA_SCOPES_RULES)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Đăng ký bổ sung rule phạm vi dữ liệu riêng cho module nghiệp vụ (Mục 4.3.7)',
  })
  public registerCustomScopeRule(
    @ValidatedBody(
      z.object({
        code: z.string().trim().min(2).max(128),
        resource: z.string().trim().min(1).max(64),
        module: z.string().trim().min(1).max(64).optional(),
        name: z.string().trim().min(2).max(150),
        description: z.string().trim().max(500).nullable().optional(),
        allowedOrganizationUnitIds: z.array(z.number().int().min(1)).optional(),
        allowedUserIds: z.array(z.number().int().min(1)).optional(),
        allowAllIfHasPermission: z.string().trim().min(2).max(128).optional(),
      }),
    )
    body: {
      code: string;
      resource: string;
      module?: string;
      name: string;
      description?: string | null;
      allowedOrganizationUnitIds?: number[];
      allowedUserIds?: number[];
      allowAllIfHasPermission?: string;
    },
  ) {
    return this.rolesService.registerDeclarativeCustomScopeRule(body);
  }

  /** Tra cứu Nhật ký thao tác (Audit Log — Mục 4.4.7) lọc theo người dùng, Service Account, module, thời gian và hành động */
  @Get(ROLES_ROUTES.AUDIT_LOGS)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary:
      'Tra cứu Nhật ký thao tác (Audit Log) lọc theo người dùng, Service Account, module, thời gian và hành động (Mục 4.4)',
  })
  public async listAuditLogs(@ValidatedQuery(listAuditLogsQuerySchema) query: ListAuditLogsQuery) {
    return this.rolesService.listAuditLogs(query);
  }

  /** Xem chi tiết một bản ghi Audit Log (bao gồm dữ liệu Trước/Sau — Mục 4.4.4 & 4.4.7) */
  @Get(ROLES_ROUTES.AUDIT_LOG_BY_ID)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary:
      'Xem chi tiết bản ghi Nhật ký thao tác (Audit Log) kèm dữ liệu trước và sau khi thay đổi (Mục 4.4)',
  })
  public async getAuditLogById(@ValidatedParams(positiveIntParamSchema, 'id') id: number) {
    return this.rolesService.getAuditLogById(id);
  }

  /** Chặn sửa Audit Log bằng API thường (Mục 4.4.8 — Bảo vệ tính toàn vẹn) */
  @Put(ROLES_ROUTES.AUDIT_LOG_BY_ID)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Không cho phép sửa Audit Log qua API thường (Mục 4.4.8 — Bảo vệ tính toàn vẹn)',
  })
  public async updateAuditLogPut(@ValidatedParams(positiveIntParamSchema, 'id') id: number) {
    return this.rolesService.updateAuditLog(id);
  }

  /** Chặn sửa một phần Audit Log bằng API thường (Mục 4.4.8 — Bảo vệ tính toàn vẹn) */
  @Patch(ROLES_ROUTES.AUDIT_LOG_BY_ID)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Không cho phép sửa Audit Log qua API thường (Mục 4.4.8 — Bảo vệ tính toàn vẹn)',
  })
  public async updateAuditLogPatch(@ValidatedParams(positiveIntParamSchema, 'id') id: number) {
    return this.rolesService.updateAuditLog(id);
  }

  /** Chặn xóa Audit Log bằng API thường (Mục 4.4.8 — Bảo vệ tính toàn vẹn) */
  @Delete(ROLES_ROUTES.AUDIT_LOG_BY_ID)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Không cho phép xóa Audit Log qua API thường (Mục 4.4.8 — Bảo vệ tính toàn vẹn)',
  })
  public async deleteAuditLog(@ValidatedParams(positiveIntParamSchema, 'id') id: number) {
    return this.rolesService.deleteAuditLog(id);
  }

  /** Danh mục toàn bộ mã quyền hạn trong bảng permissions */
  @Get(ROLES_ROUTES.PERMISSIONS_CATALOG)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Danh mục các quyền hạn từ bảng permissions kèm nhóm chức năng và cảnh báo mồ côi',
    response: z.array(permissionCatalogItemResponseSchema),
  })
  public async permissionsCatalog(): Promise<PermissionCatalogItemResponse[]> {
    return this.rolesService.listPermissionsCatalog();
  }

  /** Danh mục quyền được nhóm theo module và nhóm chức năng (Mục 4.2) */
  @Get(ROLES_ROUTES.PERMISSIONS_GROUPED)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Danh sách quyền được nhóm theo module và chức năng (Mục 4.2)',
    response: z.array(permissionFunctionalGroupResponseSchema),
  })
  public async permissionsGrouped(): Promise<PermissionFunctionalGroupResponse[]> {
    return this.rolesService.listPermissionsGrouped();
  }

  /** Đồng bộ idempotent danh sách quyền từ các module manifests vào bảng permissions (Mục 4.2) */
  @Post(ROLES_ROUTES.PERMISSIONS_SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Đồng bộ quyền từ các module manifest (không tạo trùng quyền, phát hiện quyền mồ côi)',
    status: HTTP_STATUS_CODE.OK,
    response: syncPermissionsResultResponseSchema,
  })
  public async syncPermissions(
    @ValidatedBody(syncPermissionsSchema) body: SyncPermissionsRequest,
  ): Promise<SyncPermissionsResultResponse> {
    return this.rolesService.syncModulePermissions(body);
  }

  /** Danh sách cảnh báo các quyền mồ côi không còn thuộc bất kỳ module hoạt động nào (Mục 4.2) */
  @Get(ROLES_ROUTES.PERMISSIONS_ORPHANS)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Cảnh báo danh sách quyền không còn module sử dụng (Mục 4.2)',
    response: z.array(orphanedPermissionWarningResponseSchema),
  })
  public async permissionsOrphans(): Promise<OrphanedPermissionWarningResponse[]> {
    return this.rolesService.listOrphanedPermissions();
  }

  /** Bảng tổng hợp ma trận Vai trò × Quyền toàn hệ thống (Mục 4.2) */
  @Get(ROLES_ROUTES.PERMISSIONS_MATRIX)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Bảng ma trận tổng hợp vai trò và quyền toàn hệ thống (Mục 4.2)',
    response: rolePermissionMatrixResponseSchema,
  })
  public async permissionsMatrix(): Promise<RolePermissionMatrixResponse> {
    return this.rolesService.getPermissionMatrix();
  }

  /** Xem danh sách người dùng đang sử dụng vai trò (Mục 4.1 — kiểm tra trước khi thay đổi hoặc xóa) */
  @Get(ROLES_ROUTES.ROLE_USERS)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Xem danh sách người dùng đang được gán vai trò theo ID',
    response: z.array(roleAssignedUserResponseSchema),
  })
  public async listAssignedUsers(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<RoleAssignedUserResponse[]> {
    return this.rolesService.listAssignedUsers(id);
  }

  /** Xem chi tiết một vai trò theo ID */
  @Get(ROLES_ROUTES.BY_ID)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Xem chi tiết vai trò theo ID',
    response: roleResponseSchema,
  })
  public async getById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<RoleResponse> {
    return this.rolesService.getById(id);
  }

  /** Tạo mới vai trò */
  @Post()
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Tạo mới vai trò và gán quyền',
    status: HTTP_STATUS_CODE.CREATED,
    response: roleResponseSchema,
  })
  public async create(
    @ValidatedBody(createRoleSchema) body: CreateRoleRequest,
  ): Promise<RoleResponse> {
    return this.rolesService.create(body);
  }

  /** Sao chép vai trò từ vai trò hiện có (Mục 4.1) */
  @Post(ROLES_ROUTES.CLONE)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Sao chép vai trò hiện có sang vai trò mới kèm toàn bộ quyền hạn',
    status: HTTP_STATUS_CODE.CREATED,
    response: roleResponseSchema,
  })
  public async clone(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(cloneRoleSchema) body: CloneRoleRequest,
  ): Promise<RoleResponse> {
    return this.rolesService.clone(id, body);
  }

  /** Cập nhật thông tin vai trò (tên, mô tả, trạng thái — không cho phép đổi mã code) */
  @Patch(ROLES_ROUTES.BY_ID)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Cập nhật tên, mô tả, trạng thái và danh sách quyền của vai trò',
    response: roleResponseSchema,
  })
  public async update(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateRoleSchema) body: UpdateRoleRequest,
  ): Promise<RoleResponse> {
    return this.rolesService.update(id, body);
  }

  /** Gán lại danh sách quyền cho một vai trò */
  @Put(ROLES_ROUTES.ROLE_PERMISSIONS)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Cập nhật danh sách quyền hạn cho vai trò',
    response: roleResponseSchema,
  })
  public async setPermissions(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(setRolePermissionsSchema) body: SetRolePermissionsRequest,
  ): Promise<RoleResponse> {
    return this.rolesService.setPermissions(id, body);
  }

  /** Xóa mềm vai trò (chặn xóa vai trò hệ thống hoặc vai trò đang có người dùng sử dụng) */
  @Delete(ROLES_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Xóa mềm vai trò tùy chỉnh (chặn nếu là vai trò hệ thống hoặc đang có người sử dụng)',
    response: z.object({ deleted: z.literal(true), id: z.number().int().min(1) }),
  })
  public async remove(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<{ deleted: true; id: number }> {
    return this.rolesService.remove(id);
  }
}
