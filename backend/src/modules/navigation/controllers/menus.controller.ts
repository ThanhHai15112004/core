import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  ApiDoc,
  RequireAnyPermission,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import { HTTP_STATUS_CODE, type MenuTreeEvaluationResult } from '@packages/kernel/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import type {
  DeleteMenuResult,
  InvalidateMenuCacheResult,
  MenuSummary,
  SyncMenusResult,
} from '../contracts/index.js';
import { NAVIGATION_ROUTES } from '../routes/navigation.routes.js';
import { MenusService } from '../services/menus.service.js';
import {
  type CreateMenuRequest,
  type GetMenuTreeQuery,
  type ListMenusQuery,
  type ReorderMenusRequest,
  type ToggleMenuRequest,
  type UpdateMenuRequest,
  createMenuSchema,
  getMenuTreeQuerySchema,
  listMenusQuerySchema,
  reorderMenusSchema,
  toggleMenuSchema,
  updateMenuSchema,
} from '../requests/navigation.requests.js';
import {
  deleteMenuResultResponseSchema,
  invalidateMenuCacheResultResponseSchema,
  menuResponseSchema,
  menuTreeResponseSchema,
  syncMenusResultResponseSchema,
} from '../responses/navigation.response.js';

const menuCodeParamSchema = z.object({
  code: z.string().trim().min(2).max(100),
});

@Controller(NAVIGATION_ROUTES.ROOT)
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get(NAVIGATION_ROUTES.TREE)
  @ApiDoc({
    summary:
      'Trả về cây menu hợp lệ theo quyền hạn người dùng hiện tại, trạng thái bật/tắt, Feature Flag và vị trí hiển thị',
    response: menuTreeResponseSchema,
  })
  public async getMenuTree(
    @ValidatedQuery(getMenuTreeQuerySchema) query: GetMenuTreeQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<MenuTreeEvaluationResult> {
    return this.menusService.getAuthorizedMenuTree({
      position: query.position,
      type: query.type,
      includeInactive: query.includeInactive,
      permissions: actor?.permissions,
      roles: actor?.roles,
    });
  }

  @Post(NAVIGATION_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission('navigation.manage', 'settings.manage')
  @ApiDoc({
    summary:
      'Đồng bộ Idempotent menu mặc định từ module.manifest.json vào Database và làm mới cache mà không ghi đè tùy chỉnh của Admin',
    status: HTTP_STATUS_CODE.OK,
    response: syncMenusResultResponseSchema,
  })
  public async syncManifests(): Promise<SyncMenusResult> {
    return this.menusService.syncManifests();
  }

  @Post(NAVIGATION_ROUTES.REORDER)
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission('navigation.manage', 'settings.manage')
  @ApiDoc({
    summary: 'Sắp xếp lại thứ tự hiển thị (numOrder) và nút cha (parent) hàng loạt cho cây menu',
    status: HTTP_STATUS_CODE.OK,
    response: z.array(menuResponseSchema),
  })
  public async reorderMenus(
    @ValidatedBody(reorderMenusSchema) body: ReorderMenusRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<MenuSummary[]> {
    return this.menusService.reorderMenus(body, actor);
  }

  @Post(NAVIGATION_ROUTES.INVALIDATE_CACHE)
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission('navigation.manage', 'settings.manage')
  @ApiDoc({
    summary: 'Làm mới toàn bộ cache cây menu (L1 in-memory & L2 Redis) ngay lập tức',
    status: HTTP_STATUS_CODE.OK,
    response: invalidateMenuCacheResultResponseSchema,
  })
  public async invalidateCache(): Promise<InvalidateMenuCacheResult> {
    return this.menusService.invalidateCache();
  }

  @Get()
  @RequireAnyPermission('navigation.read', 'settings.read')
  @ApiDoc({
    summary:
      'Liệt kê danh sách tất cả mục menu theo vị trí, trạng thái bật/tắt, loại mục, nút cha và từ khóa',
    response: z.array(menuResponseSchema),
  })
  public async listMenus(
    @ValidatedQuery(listMenusQuerySchema) query: ListMenusQuery,
  ): Promise<MenuSummary[]> {
    return this.menusService.listMenus(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireAnyPermission('navigation.manage', 'settings.manage')
  @ApiDoc({
    summary: 'Tạo mới mục menu điều hướng với cấu hình phân cấp, quyền truy cập và vị trí hiển thị',
    status: HTTP_STATUS_CODE.CREATED,
    response: menuResponseSchema,
  })
  public async createMenu(
    @ValidatedBody(createMenuSchema) body: CreateMenuRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<MenuSummary> {
    return this.menusService.createMenu(body, actor);
  }

  @Get(NAVIGATION_ROUTES.DETAIL)
  @RequireAnyPermission('navigation.read', 'settings.read')
  @ApiDoc({
    summary: 'Xem chi tiết cấu hình một mục menu theo mã code',
    response: menuResponseSchema,
  })
  public async getMenuByCode(
    @ValidatedParams(menuCodeParamSchema) params: { code: string },
  ): Promise<MenuSummary> {
    return this.menusService.getMenuByCode(params.code);
  }

  @Put(NAVIGATION_ROUTES.DETAIL)
  @RequireAnyPermission('navigation.manage', 'settings.manage')
  @ApiDoc({
    summary: 'Cập nhật cấu hình mục menu và tự động tính toán lại cấp độ phân cấp (level)',
    response: menuResponseSchema,
  })
  public async updateMenu(
    @ValidatedParams(menuCodeParamSchema) params: { code: string },
    @ValidatedBody(updateMenuSchema) body: UpdateMenuRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<MenuSummary> {
    return this.menusService.updateMenu(params.code, body, actor);
  }

  @Patch(NAVIGATION_ROUTES.TOGGLE)
  @RequireAnyPermission('navigation.manage', 'settings.manage')
  @ApiDoc({
    summary:
      'Bật/Tắt nhanh trạng thái hiển thị của mục menu (1 = ACTIVE, 0 = INACTIVE) mà không cần xóa dữ liệu',
    response: menuResponseSchema,
  })
  public async toggleMenuStatus(
    @ValidatedParams(menuCodeParamSchema) params: { code: string },
    @ValidatedBody(toggleMenuSchema) body: ToggleMenuRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<MenuSummary> {
    return this.menusService.toggleMenu(params.code, body, actor);
  }

  @Delete(NAVIGATION_ROUTES.DETAIL)
  @RequireAnyPermission('navigation.manage', 'settings.manage')
  @ApiDoc({
    summary: 'Xóa mềm mục menu (chặn xóa nếu còn mục menu con trực tiếp)',
    response: deleteMenuResultResponseSchema,
  })
  public async deleteMenu(
    @ValidatedParams(menuCodeParamSchema) params: { code: string },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<DeleteMenuResult> {
    return this.menusService.deleteMenu(params.code, actor);
  }
}
