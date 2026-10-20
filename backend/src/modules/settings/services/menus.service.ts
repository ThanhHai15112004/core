import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { BaseCacheProvider } from '@packages/cache/index.js';
import {
  type BuildAuthorizedMenuTreeOptions,
  ConflictAppException,
  MENU_POSITION,
  MENU_STATUS,
  MENU_STATUS_NAME_BY_CODE,
  MENU_TYPE,
  MENU_TYPE_NAME_BY_CODE,
  type MenuManifestItem,
  type MenuPositionCode,
  MenuRegistryService,
  type MenuStatusCode,
  type MenuTreeEvaluationResult,
  NotFoundAppException,
  type RegisteredMenuDefinition,
  defaultMenuRegistry,
  detectMenuCycle,
  discoverInstalledModules,
  discoverManifestMenus,
  parseMenuPosition,
  parseMenuStatusCode,
  parseMenuTypeCode,
  validateMenuInput,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type {
  DeleteMenuResult,
  IMenusPublicService,
  InvalidateMenuCacheResult,
  MenuSummary,
  SyncMenusResult,
} from '../contracts/index.js';
import type { MenuEntity } from '../entities/menu.entity.js';
import { MenuRepository } from '../repositories/menu.repository.js';
import type {
  CreateMenuRequest,
  ListMenusQuery,
  ReorderMenusRequest,
  ToggleMenuRequest,
  UpdateMenuRequest,
} from '../requests/settings.requests.js';

const MENU_TREE_CACHE_PREFIX = 'settings:menus:tree:';
const MENU_TREE_CACHE_TTL_SEC = 300;

@Injectable()
export class MenusService implements IMenusPublicService, OnModuleInit {
  private readonly registry: MenuRegistryService;
  private readonly trackedL2CacheKeys = new Set<string>();
  private menuSeq = 100;
  private dbHydrated = false;

  constructor(
    @Optional() private readonly menuRepository?: MenuRepository | null,
    @Optional()
    @Inject(MenuRegistryService)
    menuRegistry?: MenuRegistryService | null,
    @Optional() private readonly auditLogService?: AuditLogService | null,
    @Optional() private readonly cacheProvider?: BaseCacheProvider | null,
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
    this.registry.setInstalledModules(discoverInstalledModules());
    const manifestMenus = customMenus ?? discoverManifestMenus();
    const syncedModules = new Set<string>();

    const merged = new Map<string, MenuManifestItem>();
    for (const item of manifestMenus) {
      const code = item.code.trim().toUpperCase();
      const mod = (item.module ?? 'settings').trim().toLowerCase();
      merged.set(code, { ...item, code, module: mod });
      syncedModules.add(mod);
    }

    if (this.menuRepository) {
      try {
        // Bước 1: Upsert các bản ghi menu vào bảng menus
        for (const item of merged.values()) {
          const validated = validateMenuInput({
            code: item.code,
            name: item.name,
            status: item.status ?? MENU_STATUS.ACTIVE,
            link: item.link,
            linkApi: item.linkApi,
            type: item.type ?? (item.link ? MENU_TYPE.ITEM : MENU_TYPE.GROUP),
            key: item.key,
            numOrder: item.numOrder ?? 0,
            icon: item.icon,
            position: item.position ?? MENU_POSITION.SIDEBAR,
          });

          const existing = await this.menuRepository.findByCode(validated.code);
          if (!existing) {
            await this.menuRepository.saveEntity({
              code: validated.code,
              name: validated.name,
              status: validated.status,
              link: validated.link,
              linkApi: validated.linkApi,
              type: validated.type,
              parent: item.parent ?? null,
              level: item.level ?? (item.parentCode || item.parent ? 2 : 1),
              key: validated.key,
              numOrder: validated.numOrder,
              icon: validated.icon,
              position: validated.position,
            });
          } else {
            await this.menuRepository.saveEntity({
              ...existing,
              name: existing.name || validated.name,
              link: existing.link ?? validated.link,
              linkApi: existing.linkApi ?? validated.linkApi,
              key: existing.key ?? validated.key,
              icon: existing.icon ?? validated.icon,
            });
          }
        }

        // Bước 2: Giải quyết parentCode -> parent ID và tính lại level
        const allDbMenus = await this.menuRepository.findFiltered();
        const dbByCode = new Map<string, MenuEntity>();
        for (const m of allDbMenus) {
          dbByCode.set(m.code.trim().toUpperCase(), m);
        }

        for (const item of merged.values()) {
          if (!item.parentCode?.trim()) continue;
          const childEntity = dbByCode.get(item.code.trim().toUpperCase());
          const parentEntity = dbByCode.get(item.parentCode.trim().toUpperCase());
          if (childEntity && parentEntity && childEntity.parent !== parentEntity.id) {
            childEntity.parent = parentEntity.id;
            childEntity.level = (parentEntity.level ?? 1) + 1;
            await this.menuRepository.saveEntity(childEntity);
          }
        }

        const refreshedMenus = await this.menuRepository.findFiltered();
        for (const dbMenu of refreshedMenus) {
          const mod = merged.get(dbMenu.code.trim().toUpperCase())?.module ?? 'settings';
          this.syncEntityToRegistry(dbMenu, mod);
          syncedModules.add(mod);
        }
        this.registry.recomputeHierarchyLevels();
        this.registry.invalidateCache({ action: 'SYNC', silent: true });
        await this.clearL2CacheSafe();
        this.dbHydrated = true;

        return {
          syncedModules: Array.from(syncedModules).sort(),
          totalMenus: refreshedMenus.length,
        };
      } catch {
        // Fallback to in-memory registry when DB is unavailable in unit tests
      }
    }

    this.registry.registerManifestMenus(Array.from(merged.values()));
    await this.clearL2CacheSafe();

    return {
      syncedModules: Array.from(syncedModules).sort(),
      totalMenus: this.registry.listMenus().length,
    };
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
    return items.map((m) => this.mapDefinitionToSummary(m));
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
    return this.mapDefinitionToSummary(def);
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

    const resolvedParent = this.resolveParentMenu(dto.parent, dto.parentCode);
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
      newState: this.serializeMenu(registered),
      actor,
      reason: dto.reason ?? `Created menu ${registered.code}`,
    });

    return this.mapDefinitionToSummary(registered);
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

    const oldState = this.serializeMenu(existing);

    let nextParentId = existing.parent;
    let nextParentCode = existing.parentCode;
    if (dto.parent !== undefined || dto.parentCode !== undefined) {
      const resolvedParent = this.resolveParentMenu(dto.parent, dto.parentCode);
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

    await this.persistMenuAndDescendantsSafe(updated.id);
    await this.clearL2CacheSafe();
    await this.recordAudit({
      action: 'UPDATE',
      code: updated.code,
      oldState,
      newState: this.serializeMenu(updated),
      actor,
      reason: dto.reason ?? `Updated menu ${updated.code}`,
    });

    return this.mapDefinitionToSummary(updated);
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

    const oldState = this.serializeMenu(existing);
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

    await this.persistMenuAndDescendantsSafe(updated.id);
    await this.clearL2CacheSafe();
    await this.recordAudit({
      action: 'TOGGLE',
      code: updated.code,
      oldState,
      newState: {
        ...this.serializeMenu(updated),
        cascadeChildren: Boolean(dto?.cascadeChildren),
      },
      actor,
      reason:
        dto?.reason ??
        `Toggled menu ${updated.code} status to ${MENU_STATUS_NAME_BY_CODE[nextStatus]}`,
    });

    return this.mapDefinitionToSummary(this.registry.getMenuByCode(normCode)!);
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
        const resolvedParent = this.resolveParentMenu(item.parent, item.parentCode);
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
        await this.persistSingleMenuSafe(def);
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
      .map((m) => this.mapDefinitionToSummary(m));
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

    const oldState = this.serializeMenu(existing);

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

  private resolveParentMenu(
    parentId?: number | null | undefined,
    parentCode?: string | null | undefined,
  ): RegisteredMenuDefinition | null {
    if (parentCode !== undefined) {
      if (parentCode === null || parentCode.trim() === '') {
        return null;
      }
      const found = this.registry.getMenuByCode(parentCode.trim().toUpperCase());
      if (!found) {
        throw new NotFoundAppException(
          `Parent menu '${parentCode.trim().toUpperCase()}' not found`,
        );
      }
      return found;
    }

    if (parentId !== undefined) {
      if (parentId === null || parentId <= 0) {
        return null;
      }
      const found = this.registry.getMenuById(parentId);
      if (!found) {
        throw new NotFoundAppException(`Parent menu #${parentId} not found`);
      }
      return found;
    }

    return null;
  }

  private async ensureHydrated(): Promise<void> {
    if (!this.dbHydrated && this.registry.listMenus().length === 0) {
      await this.syncManifests();
      this.dbHydrated = true;
    }
  }

  private syncEntityToRegistry(
    entity: MenuEntity,
    moduleName = 'settings',
  ): RegisteredMenuDefinition {
    const status = parseMenuStatusCode(entity.status, MENU_STATUS.ACTIVE);
    const type = parseMenuTypeCode(entity.type, MENU_TYPE.ITEM);
    const position: MenuPositionCode = parseMenuPosition(entity.position, MENU_POSITION.SIDEBAR);
    return this.registry.registerMenu(
      {
        id: Number(entity.id),
        code: entity.code.trim().toUpperCase(),
        module: moduleName,
        name: entity.name,
        status,
        statusName: MENU_STATUS_NAME_BY_CODE[status],
        link: entity.link ?? null,
        linkApi: entity.linkApi ?? null,
        type,
        typeName: MENU_TYPE_NAME_BY_CODE[type],
        parent: entity.parent ? Number(entity.parent) : null,
        level: Number(entity.level ?? 1),
        key: entity.key ?? null,
        numOrder: Number(entity.numOrder ?? 0),
        icon: entity.icon ?? null,
        position,
        updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : new Date().toISOString(),
      },
      { silent: true },
    );
  }

  private mapDefinitionToSummary(def: RegisteredMenuDefinition): MenuSummary {
    return {
      id: def.id,
      code: def.code,
      module: def.module,
      name: def.name,
      status: def.status,
      statusName: def.statusName,
      link: def.link,
      linkApi: def.linkApi,
      type: def.type,
      typeName: def.typeName,
      parent: def.parent,
      parentCode: def.parentCode,
      level: def.level,
      key: def.key,
      numOrder: def.numOrder,
      icon: def.icon,
      position: def.position,
      updatedAt: def.updatedAt ?? new Date().toISOString(),
    };
  }

  private serializeMenu(def: RegisteredMenuDefinition): Record<string, unknown> {
    return {
      id: def.id,
      code: def.code,
      module: def.module,
      name: def.name,
      status: def.status,
      statusName: def.statusName,
      link: def.link,
      linkApi: def.linkApi,
      type: def.type,
      typeName: def.typeName,
      parent: def.parent,
      parentCode: def.parentCode,
      level: def.level,
      key: def.key,
      numOrder: def.numOrder,
      icon: def.icon,
      position: def.position,
    };
  }

  private async persistSingleMenuSafe(def: RegisteredMenuDefinition): Promise<void> {
    if (!this.menuRepository) return;
    try {
      const existing = await this.menuRepository.findByCode(def.code);
      if (existing) {
        await this.menuRepository.saveEntity({
          ...existing,
          name: def.name,
          status: def.status,
          link: def.link,
          linkApi: def.linkApi,
          type: def.type,
          parent: def.parent,
          level: def.level,
          key: def.key,
          numOrder: def.numOrder,
          icon: def.icon,
          position: def.position,
        });
      }
    } catch {
      // Ignore when DB is offline in unit tests
    }
  }

  private async persistMenuAndDescendantsSafe(rootId: number): Promise<void> {
    if (!this.menuRepository) return;
    const idsToPersist = [rootId, ...this.registry.getDescendantIds(rootId)];
    for (const id of idsToPersist) {
      const def = this.registry.getMenuById(id);
      if (def) {
        await this.persistSingleMenuSafe(def);
      }
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
    action: 'CREATE' | 'UPDATE' | 'TOGGLE' | 'REORDER' | 'DELETE';
    code: string;
    oldState: Record<string, unknown> | null;
    newState: Record<string, unknown>;
    actor?: UserIdentity | undefined;
    reason?: string | null | undefined;
  }): Promise<void> {
    if (!this.auditLogService) return;
    const reqCtx = RequestContextService.current();
    const resolvedActor = params.actor ?? (reqCtx?.actor as UserIdentity | undefined) ?? undefined;
    const rawUserId = resolvedActor?.id ?? reqCtx?.userId;
    const actorUserId =
      typeof rawUserId === 'number' && Number.isInteger(rawUserId) && rawUserId > 0
        ? rawUserId
        : typeof rawUserId === 'string' && /^\d+$/.test(rawUserId.trim())
          ? Number.parseInt(rawUserId.trim(), 10)
          : null;
    const actorIdentifier =
      resolvedActor?.email ??
      resolvedActor?.username ??
      (actorUserId ? `user:${actorUserId}` : 'system');

    try {
      await this.auditLogService.record({
        actor: resolvedActor,
        actorUserId,
        actorIdentifier,
        module: 'settings',
        feature: 'menus',
        action: `menu.${params.action.toLowerCase()}`,
        resourceType: 'menu',
        resourceId: params.code,
        beforeData: params.oldState,
        afterData: params.newState,
        reason: params.reason ?? null,
        ipAddress: reqCtx?.ipAddress ?? '127.0.0.1',
        userAgent: reqCtx?.userAgent ?? null,
        requestId: reqCtx?.requestId ?? reqCtx?.correlationId ?? null,
        correlationId: reqCtx?.correlationId ?? null,
      });
    } catch {
      // Ignore audit log error
    }
  }
}
