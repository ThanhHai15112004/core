import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { BaseCacheProvider } from '@packages/cache/index.js';
import {
  type BuildAuthorizedMenuTreeOptions,
  ConflictAppException,
  MENU_POSITION,
  MENU_STATUS,
  MENU_STATUS_NAME_BY_CODE,
  MENU_TYPE,
  type MenuManifestItem,
  MenuRegistryService,
  type MenuStatusCode,
  type MenuTreeEvaluationResult,
  NotFoundAppException,
  type RegisteredMenuDefinition,
  defaultMenuRegistry,
  detectMenuCycle,
  parseMenuStatusCode,
  validateMenuInput,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type {
  DeleteMenuResult,
  IMenusPublicService,
  InvalidateMenuCacheResult,
  MenuSummary,
  SyncMenusResult,
} from '../contracts/index.js';
import {
  MENU_TREE_CACHE_PREFIX,
  MENU_TREE_CACHE_TTL_SEC,
  type MenuAuditActionType,
} from '../enum/settings.enum.js';
import {
  mapMenuDefinitionToSummary,
  persistMenuAndDescendantsToDatabaseSafe,
  persistSingleMenuToDatabaseSafe,
  recordMenuAuditLog,
  resolveParentMenuFromRegistry,
  serializeMenuState,
  syncManifestMenusToDatabaseAndRegistry,
} from '../helpers/menus.helper.js';
import { MenuRepository } from '../repositories/menu.repository.js';
import type {
  CreateMenuRequest,
  ListMenusQuery,
  ReorderMenusRequest,
  ToggleMenuRequest,
  UpdateMenuRequest,
} from '../requests/settings.requests.js';

@Injectable()
export class MenusService implements IMenusPublicService, OnModuleInit {
  private readonly registry: MenuRegistryService;
  private readonly trackedL2CacheKeys = new Set<string>();
  private menuSeq = 100;
  private dbHydrated = false;

  constructor(
    @Optional()
    @Inject(MenuRepository)
    private readonly menuRepository?: MenuRepository | null,
    @Optional()
    @Inject(MenuRegistryService)
    menuRegistry?: MenuRegistryService | null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService | null,
    @Optional()
    @Inject(BaseCacheProvider)
    private readonly cacheProvider?: BaseCacheProvider | null,
  ) {
    this.registry = menuRegistry ?? defaultMenuRegistry;
    this.registry.onMenuChanged(() => {
      void this.clearL2CacheSafe();
    });
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.syncManifests();
    } catch {
      // Allow graceful startup before migration/seeding
    }
  }

  public setInstalledModules(modules: readonly string[]): void {
    this.registry.setInstalledModules(modules);
    void this.clearL2CacheSafe();
  }

  /**
   * Đồng bộ Idempotent cấu trúc menu khai báo trong `module.manifest.json` của các module
   * vào bảng `menus` và Kernel `MenuRegistryService` (Mục 5.6).
   */
  public async syncManifests(customMenus?: readonly MenuManifestItem[]): Promise<SyncMenusResult> {
    return syncManifestMenusToDatabaseAndRegistry({
      customMenus,
      registry: this.registry,
      menuRepository: this.menuRepository,
      clearL2CacheSafe: () => this.clearL2CacheSafe(),
      markHydrated: () => {
        this.dbHydrated = true;
      },
    });
  }

  /**
   * Liệt kê danh sách menu phẳng phục vụ quản trị (lọc theo module, status, type, parent, level, position, từ khóa).
   */
  public async listMenus(query?: ListMenusQuery): Promise<MenuSummary[]> {
    await this.ensureHydrated();
    const items = this.registry.listMenus({
      module: query?.module,
      status: query?.status,
      type: query?.type,
      parent: query?.parent === 0 ? null : query?.parent,
      level: query?.level,
      position: query?.position,
      search: query?.q,
    });
    return items.map((m) => mapMenuDefinitionToSummary(m));
  }

  /**
   * Xem chi tiết một mục menu theo `code`.
   */
  public async getMenuByCode(code: string): Promise<MenuSummary> {
    await this.ensureHydrated();
    const normCode = code.trim().toUpperCase();
    const def = this.registry.getMenuByCode(normCode);
    if (!def) {
      throw new NotFoundAppException(`Menu '${normCode}' not found`);
    }
    return mapMenuDefinitionToSummary(def);
  }

  /**
   * 5.6.1 -> 5.6.4: Trả cây menu động đã lọc theo `status = 1` (Bật), trạng thái cài đặt module
   * và quyền hạn của người dùng hiện tại (`key` khớp với `permissions` hoặc `roles` của user),
   * kèm Cache điều hướng 2 tầng (L1 Memory + L2 Redis) tự động xóa khi thay đổi.
   */
  public async getAuthorizedMenuTree(
    options?: BuildAuthorizedMenuTreeOptions,
  ): Promise<MenuTreeEvaluationResult> {
    await this.ensureHydrated();

    const mergedPermissions = new Set<string>(
      (options?.permissions ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean),
    );
    const roles = (options?.roles ?? []).map((r) => r.trim()).filter(Boolean);

    if (roles.length > 0) {
      const rolePerms = await this.registry.resolvePermissionsForRoles(roles);
      for (const rp of rolePerms) {
        mergedPermissions.add(rp);
      }
      if (this.registry !== defaultMenuRegistry) {
        const globalRolePerms = await defaultMenuRegistry.resolvePermissionsForRoles(roles);
        for (const rp of globalRolePerms) {
          mergedPermissions.add(rp);
        }
      }
    }

    const effectiveOptions: BuildAuthorizedMenuTreeOptions = {
      ...options,
      permissions: Array.from(mergedPermissions),
      roles,
    };

    const result = this.registry.buildAuthorizedMenuTree(effectiveOptions);

    if (this.cacheProvider && !result.fromCache) {
      try {
        const l2Key = `${MENU_TREE_CACHE_PREFIX}v${result.cacheVersion}:${result.position}:${Array.from(mergedPermissions).sort().join(',')}`;
        this.trackedL2CacheKeys.add(l2Key);
        await this.cacheProvider.set(l2Key, result, MENU_TREE_CACHE_TTL_SEC);
      } catch {
        // Ignore L2 cache write error
      }
    }

    return result;
  }

  /**
   * 5.6.1 -> 5.6.3: Tạo mới một mục menu (tự động tính `level` theo `parent`, kiểm tra chống vòng lặp).
   */
  public async createMenu(dto: CreateMenuRequest, actor?: UserIdentity): Promise<MenuSummary> {
    await this.ensureHydrated();
    const validated = validateMenuInput({
      code: dto.code,
      name: dto.name,
      status: dto.status ?? MENU_STATUS.ACTIVE,
      link: dto.link,
      linkApi: dto.linkApi,
      type: dto.type ?? (dto.link ? MENU_TYPE.ITEM : MENU_TYPE.GROUP),
      key: dto.key,
      numOrder: dto.numOrder ?? 0,
      icon: dto.icon,
      position: dto.position ?? MENU_POSITION.SIDEBAR,
    });

    if (this.registry.getMenuByCode(validated.code)) {
      throw new ConflictAppException(`Menu '${validated.code}' already exists`);
    }

    const resolvedParent = resolveParentMenuFromRegistry(this.registry, dto.parent, dto.parentCode);
    const level = resolvedParent ? resolvedParent.level + 1 : 1;
    const moduleName = (dto.module ?? 'settings').trim().toLowerCase();
    const nowIso = new Date().toISOString();
    let menuId = ++this.menuSeq;

    if (this.menuRepository) {
      try {
        const saved = await this.menuRepository.saveEntity({
          code: validated.code,
          name: validated.name,
          status: validated.status,
          link: validated.link,
          linkApi: validated.linkApi,
          type: validated.type,
          parent: resolvedParent ? resolvedParent.id : null,
          level,
          key: validated.key,
          numOrder: validated.numOrder,
          icon: validated.icon,
          position: validated.position,
        });
        menuId = saved.id;
      } catch (err) {
        if (err instanceof ConflictAppException) throw err;
      }
    }

    const registered = this.registry.registerMenu({
      id: menuId,
      code: validated.code,
      module: moduleName,
      name: validated.name,
      status: validated.status,
      link: validated.link,
      linkApi: validated.linkApi,
      type: validated.type,
      parent: resolvedParent ? resolvedParent.id : null,
      parentCode: resolvedParent ? resolvedParent.code : null,
      level,
      key: validated.key,
      numOrder: validated.numOrder,
      icon: validated.icon,
      position: validated.position,
      updatedAt: nowIso,
    });

    await this.clearL2CacheSafe();
    await this.recordAudit({
      action: 'CREATE',
      code: registered.code,
      oldState: null,
      newState: serializeMenuState(registered),
      actor,
      reason: dto.reason ?? `Created menu ${registered.code}`,
    });

    return mapMenuDefinitionToSummary(registered);
  }

  /**
   * 5.6.1 -> 5.6.3: Cập nhật thông tin mục menu (kiểm tra chống vòng lặp cha-con và tự động tính lại `level` nhánh con).
   */
  public async updateMenu(
    code: string,
    dto: UpdateMenuRequest,
    actor?: UserIdentity,
  ): Promise<MenuSummary> {
    await this.ensureHydrated();
    const normCode = code.trim().toUpperCase();
    const existing = this.registry.getMenuByCode(normCode);
    if (!existing) {
      throw new NotFoundAppException(`Menu '${normCode}' not found`);
    }

    const oldState = serializeMenuState(existing);

    let nextParentId = existing.parent;
    let nextParentCode = existing.parentCode;
    if (dto.parent !== undefined || dto.parentCode !== undefined) {
      const resolvedParent = resolveParentMenuFromRegistry(
        this.registry,
        dto.parent,
        dto.parentCode,
      );
      nextParentId = resolvedParent ? resolvedParent.id : null;
      nextParentCode = resolvedParent ? resolvedParent.code : null;
      detectMenuCycle(
        existing.id,
        nextParentId,
        (currId) => this.registry.getMenuById(currId)?.parent ?? null,
      );
    }

    const validated = validateMenuInput({
      code: existing.code,
      name: dto.name !== undefined ? dto.name : existing.name,
      status: dto.status !== undefined ? dto.status : existing.status,
      link: dto.link !== undefined ? dto.link : existing.link,
      linkApi: dto.linkApi !== undefined ? dto.linkApi : existing.linkApi,
      type: dto.type !== undefined ? dto.type : existing.type,
      key: dto.key !== undefined ? dto.key : existing.key,
      numOrder: dto.numOrder !== undefined ? dto.numOrder : existing.numOrder,
      icon: dto.icon !== undefined ? dto.icon : existing.icon,
      position: dto.position !== undefined ? dto.position : existing.position,
    });

    const parentDef = nextParentId !== null ? this.registry.getMenuById(nextParentId) : null;
    const nextLevel = parentDef ? parentDef.level + 1 : 1;
    const nowIso = new Date().toISOString();

    const updated = this.registry.registerMenu({
      ...existing,
      name: validated.name,
      status: validated.status,
      link: validated.link,
      linkApi: validated.linkApi,
      type: validated.type,
      parent: nextParentId,
      parentCode: nextParentCode,
      level: nextLevel,
      key: validated.key,
      numOrder: validated.numOrder,
      icon: validated.icon,
      position: validated.position,
      updatedAt: nowIso,
    });

    await persistMenuAndDescendantsToDatabaseSafe(updated.id, this.registry, this.menuRepository);
    await this.clearL2CacheSafe();
    await this.recordAudit({
      action: 'UPDATE',
      code: updated.code,
      oldState,
      newState: serializeMenuState(updated),
      actor,
      reason: dto.reason ?? `Updated menu ${updated.code}`,
    });

    return mapMenuDefinitionToSummary(updated);
  }

  /**
   * 5.6.1: Bật / Tắt hiển thị menu (`status: 1 <-> 0`), hỗ trợ `cascadeChildren` để bật/tắt toàn bộ mục con.
   */
  public async toggleMenu(
    code: string,
    dto?: ToggleMenuRequest,
    actor?: UserIdentity,
  ): Promise<MenuSummary> {
    await this.ensureHydrated();
    const normCode = code.trim().toUpperCase();
    const existing = this.registry.getMenuByCode(normCode);
    if (!existing) {
      throw new NotFoundAppException(`Menu '${normCode}' not found`);
    }

    const oldState = serializeMenuState(existing);
    const nextStatus: MenuStatusCode =
      dto?.status !== undefined
        ? parseMenuStatusCode(dto.status)
        : existing.status === MENU_STATUS.ACTIVE
          ? MENU_STATUS.INACTIVE
          : MENU_STATUS.ACTIVE;

    const nowIso = new Date().toISOString();
    const updated = this.registry.registerMenu({
      ...existing,
      status: nextStatus,
      updatedAt: nowIso,
    });

    if (dto?.cascadeChildren) {
      const descendantIds = this.registry.getDescendantIds(existing.id);
      for (const childId of descendantIds) {
        const child = this.registry.getMenuById(childId);
        if (child) {
          this.registry.registerMenu(
            {
              ...child,
              status: nextStatus,
              updatedAt: nowIso,
            },
            { silent: true },
          );
        }
      }
      this.registry.invalidateCache({ action: 'TOGGLE', code: updated.code });
    }

    await persistMenuAndDescendantsToDatabaseSafe(updated.id, this.registry, this.menuRepository);
    await this.clearL2CacheSafe();
    await this.recordAudit({
      action: 'TOGGLE',
      code: updated.code,
      oldState,
      newState: {
        ...serializeMenuState(updated),
        cascadeChildren: Boolean(dto?.cascadeChildren),
      },
      actor,
      reason:
        dto?.reason ??
        `Toggled menu ${updated.code} status to ${MENU_STATUS_NAME_BY_CODE[nextStatus]}`,
    });

    return mapMenuDefinitionToSummary(this.registry.getMenuByCode(normCode)!);
  }

  /**
   * 5.6.1: Sắp xếp lại thứ tự hiển thị (`numOrder`) và chuyển nhánh cha (`parent` / `parentCode`) hàng loạt.
   */
  public async reorderMenus(
    dto: ReorderMenusRequest,
    actor?: UserIdentity,
  ): Promise<MenuSummary[]> {
    await this.ensureHydrated();
    const updatedCodes: string[] = [];
    const nowIso = new Date().toISOString();

    for (const item of dto.items) {
      const normCode = item.code.trim().toUpperCase();
      const existing = this.registry.getMenuByCode(normCode);
      if (!existing) {
        throw new NotFoundAppException(`Menu '${normCode}' not found`);
      }

      let nextParentId = existing.parent;
      let nextParentCode = existing.parentCode;
      if (item.parent !== undefined || item.parentCode !== undefined) {
        const resolvedParent = resolveParentMenuFromRegistry(
          this.registry,
          item.parent,
          item.parentCode,
        );
        nextParentId = resolvedParent ? resolvedParent.id : null;
        nextParentCode = resolvedParent ? resolvedParent.code : null;
        detectMenuCycle(
          existing.id,
          nextParentId,
          (currId) => this.registry.getMenuById(currId)?.parent ?? null,
        );
      }

      this.registry.registerMenu(
        {
          ...existing,
          numOrder: Math.trunc(item.numOrder),
          parent: nextParentId,
          parentCode: nextParentCode,
          updatedAt: nowIso,
        },
        { silent: true },
      );
      updatedCodes.push(normCode);
    }

    this.registry.recomputeHierarchyLevels();
    this.registry.invalidateCache({ action: 'REORDER' });

    for (const code of updatedCodes) {
      const def = this.registry.getMenuByCode(code);
      if (def) {
        await persistSingleMenuToDatabaseSafe(def, this.menuRepository);
      }
    }

    await this.clearL2CacheSafe();
    await this.recordAudit({
      action: 'REORDER',
      code: updatedCodes.join(','),
      oldState: null,
      newState: { items: dto.items },
      actor,
      reason: dto.reason ?? `Reordered ${updatedCodes.length} menu item(s)`,
    });

    return updatedCodes
      .map((c) => this.registry.getMenuByCode(c))
      .filter((m): m is RegisteredMenuDefinition => Boolean(m))
      .map((m) => mapMenuDefinitionToSummary(m));
  }

  /**
   * 5.6.1: Xóa mục menu (chặn xóa nếu còn menu con trực thuộc để bảo vệ tính toàn vẹn của cây).
   */
  public async deleteMenu(code: string, actor?: UserIdentity): Promise<DeleteMenuResult> {
    await this.ensureHydrated();
    const normCode = code.trim().toUpperCase();
    const existing = this.registry.getMenuByCode(normCode);
    if (!existing) {
      throw new NotFoundAppException(`Menu '${normCode}' not found`);
    }

    const directChildren = this.registry.getDirectChildren(existing.id);
    if (directChildren.length > 0) {
      throw new ConflictAppException(
        `Cannot delete menu '${existing.code}' while it still has ${directChildren.length} child menu(s): ${directChildren.map((c) => c.code).join(', ')}`,
      );
    }

    const oldState = serializeMenuState(existing);

    if (this.menuRepository) {
      try {
        const dbEntity = await this.menuRepository.findByCode(normCode);
        if (dbEntity) {
          await this.menuRepository.repository.softDelete(dbEntity.id);
        }
      } catch {
        // Ignore when DB is offline in unit tests
      }
    }

    this.registry.removeMenu(normCode);
    await this.clearL2CacheSafe();
    await this.recordAudit({
      action: 'DELETE',
      code: existing.code,
      oldState,
      newState: { deleted: true },
      actor,
      reason: `Deleted menu ${existing.code}`,
    });

    return {
      deleted: true,
      code: existing.code,
      id: existing.id,
    };
  }

  /**
   * 5.6.4: Xóa cache điều hướng chủ động (L1 Memory + L2 Redis).
   */
  public async invalidateCache(): Promise<InvalidateMenuCacheResult> {
    const cacheVersion = this.registry.invalidateCache({ action: 'INVALIDATE' });
    await this.clearL2CacheSafe();
    return {
      invalidated: true,
      cacheVersion,
    };
  }

  private async ensureHydrated(): Promise<void> {
    if (!this.dbHydrated && this.registry.listMenus().length === 0) {
      await this.syncManifests();
      this.dbHydrated = true;
    }
  }

  private async clearL2CacheSafe(): Promise<void> {
    if (!this.cacheProvider) return;
    const keys = Array.from(this.trackedL2CacheKeys);
    this.trackedL2CacheKeys.clear();
    for (const key of keys) {
      try {
        await this.cacheProvider.delete(key);
      } catch {
        // Ignore L2 cache error
      }
    }
  }

  private async recordAudit(params: {
    action: MenuAuditActionType;
    code: string;
    oldState: Record<string, unknown> | null;
    newState: Record<string, unknown>;
    actor?: UserIdentity | undefined;
    reason?: string | null | undefined;
  }): Promise<void> {
    await recordMenuAuditLog({
      ...params,
      auditLogService: this.auditLogService,
    });
  }
}
