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
  permissionCatalogItemResponseSchema,
  roleResponseSchema,
} from '../responses/roles.response.js';

@ApiGroup('Roles & Permissions', 'Quản lý vai trò và phân quyền RBAC')
@Controller(ROLES_ROUTES.PREFIX)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /** Danh sách vai trò kèm danh sách quyền */
  @Get()
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Danh sách các vai trò hệ thống và vai trò tùy chỉnh',
    response: z.array(roleResponseSchema),
  })
  public async list(
    @ValidatedQuery(listRolesQuerySchema) query: ListRolesQuery,
  ): Promise<RoleResponse[]> {
    return this.rolesService.list(query);
  }

  /** Danh mục toàn bộ mã quyền hạn trong bảng permissions */
  @Get(ROLES_ROUTES.PERMISSIONS_CATALOG)
  @RequirePermissions('roles.read')
  @ApiDoc({
    summary: 'Danh mục các quyền hạn từ bảng permissions',
    response: z.array(permissionCatalogItemResponseSchema),
  })
  public async permissionsCatalog(): Promise<PermissionCatalogItemResponse[]> {
    return this.rolesService.listPermissionsCatalog();
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

  /** Cập nhật thông tin vai trò */
  @Patch(ROLES_ROUTES.BY_ID)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Cập nhật vai trò và danh sách quyền',
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

  /** Xóa mềm vai trò */
  @Delete(ROLES_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('roles.manage')
  @ApiDoc({
    summary: 'Xóa mềm vai trò tùy chỉnh',
    response: z.object({ deleted: z.literal(true), id: z.number().int().min(1) }),
  })
  public async remove(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<{ deleted: true; id: number }> {
    return this.rolesService.remove(id);
  }
}
