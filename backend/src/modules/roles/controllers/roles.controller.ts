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
  uuidParamSchema,
} from '@packages/http/index.js';
import { ROLES_ROUTES } from '../routes/roles.routes.js';
import { RolesService } from '../services/roles.service.js';
import {
  type CreateRoleRequest,
  type ListRolesQuery,
  type SetRolePermissionsRequest,
  type UpdateRoleRequest,
  createRoleSchema,
  listRolesQuerySchema,
  setRolePermissionsSchema,
  updateRoleSchema,
} from '../requests/roles.requests.js';
import {
  type PermissionCatalogItemResponse,
  type RoleResponse,
  permissionCatalogItemSchema,
  roleResponseSchema,
} from '../responses/roles.response.js';

@ApiGroup('Roles & Permissions', 'Quản lý Vai trò và Quyền hạn hệ thống (RBAC)')
@Controller(ROLES_ROUTES.PREFIX)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /** Lấy danh sách vai trò kèm quyền hạn */
  @Get()
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Lấy danh sách các vai trò hệ thống',
    response: z.array(roleResponseSchema),
  })
  public async list(
    @ValidatedQuery(listRolesQuerySchema) query: ListRolesQuery,
  ): Promise<RoleResponse[]> {
    return this.rolesService.list(query);
  }

  /** Lấy danh mục toàn bộ mã quyền hạn hệ thống */
  @Get(ROLES_ROUTES.PERMISSIONS_CATALOG)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Lấy danh mục quyền hạn từ bảng core_permissions',
    response: z.array(permissionCatalogItemSchema),
  })
  public async listPermissionsCatalog(): Promise<PermissionCatalogItemResponse[]> {
    return this.rolesService.listPermissionsCatalog();
  }

  /** Lấy chi tiết một vai trò theo ID */
  @Get(ROLES_ROUTES.BY_ID)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Xem chi tiết vai trò theo ID',
    response: roleResponseSchema,
  })
  public async getById(@ValidatedParams(uuidParamSchema, 'id') id: string): Promise<RoleResponse> {
    return this.rolesService.getById(id);
  }

  /** Tạo mới vai trò */
  @Post()
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Tạo vai trò mới và gán quyền hạn',
    status: HTTP_STATUS_CODE.CREATED,
    response: roleResponseSchema,
  })
  public async create(
    @ValidatedBody(createRoleSchema) body: CreateRoleRequest,
  ): Promise<RoleResponse> {
    return this.rolesService.create(body);
  }

  /** Cập nhật thông tin vai trò */
  @Patch(ROLES_ROUTES.BY_ID)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Cập nhật thông tin và danh sách quyền của vai trò',
    response: roleResponseSchema,
  })
  public async update(
    @ValidatedParams(uuidParamSchema, 'id') id: string,
    @ValidatedBody(updateRoleSchema) body: UpdateRoleRequest,
  ): Promise<RoleResponse> {
    return this.rolesService.update(id, body);
  }

  /** Thiết lập lại danh sách quyền hạn cho vai trò */
  @Put(ROLES_ROUTES.ROLE_PERMISSIONS)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Gán danh sách mã quyền hạn cho một vai trò',
    response: roleResponseSchema,
  })
  public async setPermissions(
    @ValidatedParams(uuidParamSchema, 'id') id: string,
    @ValidatedBody(setRolePermissionsSchema) body: SetRolePermissionsRequest,
  ): Promise<RoleResponse> {
    return this.rolesService.setPermissions(id, body);
  }

  /** Xóa mềm vai trò */
  @Delete(ROLES_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Xóa mềm vai trò (không áp dụng cho vai trò hệ thống)',
    response: z.object({ deleted: z.literal(true), id: z.string().uuid() }),
  })
  public async remove(
    @ValidatedParams(uuidParamSchema, 'id') id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.rolesService.remove(id);
  }
}
