import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RequireAnyPermission, ZodValidationPipe } from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { PERMISSIONS_ROUTES } from '../routes/permissions.routes.js';
import {
  type SyncPermissionsRequest,
  syncPermissionsSchema,
} from '../requests/permissions.requests.js';
import type {
  OrphanedPermissionWarningResponse,
  PermissionCatalogItemResponse,
  PermissionFunctionalGroupResponse,
  SyncPermissionsResultResponse,
} from '../responses/permissions.response.js';
import { PermissionsService } from '../services/permissions.service.js';

@Controller(PERMISSIONS_ROUTES.PREFIX)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /** Danh mục quyền hệ thống từ bảng permissions kèm nhóm chức năng và cờ quyền mồ côi (Mục 4.2) */
  @Get()
  @RequireAnyPermission('permissions.read', 'roles.read')
  public async listPermissionsCatalog(): Promise<PermissionCatalogItemResponse[]> {
    return this.permissionsService.listPermissionsCatalog();
  }

  /** Danh mục quyền nhóm theo module và nhóm chức năng (Mục 4.2 — Dễ chọn và quản lý) */
  @Get(PERMISSIONS_ROUTES.GROUPED)
  @RequireAnyPermission('permissions.read', 'roles.read')
  public async listPermissionsGrouped(): Promise<PermissionFunctionalGroupResponse[]> {
    return this.permissionsService.listPermissionsGrouped();
  }

  /** Đồng bộ idempotent quyền từ các module manifests vào bảng permissions (Mục 4.2 — Không tạo trùng quyền) */
  @Post(PERMISSIONS_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission('permissions.manage', 'roles.manage')
  public async syncModulePermissions(
    @Body(new ZodValidationPipe(syncPermissionsSchema))
    body: SyncPermissionsRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SyncPermissionsResultResponse> {
    return this.permissionsService.syncModulePermissions(body, actor);
  }

  /** Cảnh báo danh sách quyền mồ côi không còn module nào công bố sử dụng (Mục 4.2 — Tránh permission rác) */
  @Get(PERMISSIONS_ROUTES.ORPHANS)
  @RequireAnyPermission('permissions.read', 'roles.read')
  public async listOrphanedPermissions(): Promise<OrphanedPermissionWarningResponse[]> {
    return this.permissionsService.listOrphanedPermissions();
  }
}
