import { discoverInstalledModules } from '../contracts/manifest.contract.js';
import {
  MENU_POSITION,
  MENU_STATUS,
  MENU_STATUS_NAME_BY_CODE,
  MENU_TYPE,
  MENU_TYPE_NAME_BY_CODE,
  detectMenuCycle,
  discoverManifestMenus,
  parseMenuPosition,
  validateMenuInput,
  type BuildAuthorizedMenuTreeOptions,
  type MenuChangeListener,
  type MenuManifestItem,
  type MenuStatusName,
  type MenuTreeEvaluationResult,
  type MenuTreeNode,
  type MenuTypeName,
  type RegisteredMenuDefinition,
} from '../contracts/menu.contract.js';

/**
 * 5.6: Kernel Menu Registry Service
 * Quản lý cấu trúc cây menu đa cấp trong bộ nhớ L1, phân quyền ẩn/hiện theo `key` (Permission)
 * và `status` (Bật/Tắt), kèm cơ chế Cache điều hướng tự động làm mới khi có thay đổi.
 */
export class MenuRegistryService {
  private readonly menusByCode = new Map<string, RegisteredMenuDefinition>();
  private readonly menusById = new Map<number, RegisteredMenuDefinition>();
  private readonly installedModules = new Set<string>(['core']);
  private readonly treeCache = new Map<string, MenuTreeNode[]>();
  private readonly listeners = new Set<MenuChangeListener>();
  private rolePermissionsResolver:
    ((roleCodes: readonly string[]) => Promise<readonly string[]> | readonly string[]) | null =
    null;
  private cacheVersion = 1;
  private autoIdSeq = 1;

  constructor() {
    for (const mod of discoverInstalledModules()) {
      this.installedModules.add(mod.trim().toLowerCase());
    }
  }

  public registerRolePermissionsResolver(
    resolver: (roleCodes: readonly string[]) => Promise<readonly string[]> | readonly string[],
  ): void {
    this.rolePermissionsResolver = resolver;
    this.invalidateCache({ silent: true });
  }

  public async resolvePermissionsForRoles(roleCodes: readonly string[]): Promise<string[]> {
    if (!this.rolePermissionsResolver || roleCodes.length === 0) {
      return [];
    }
    try {
      const resolved = await this.rolePermissionsResolver(roleCodes);
      return Array.from(new Set(resolved.map((p) => p.trim().toLowerCase()).filter(Boolean)));
    } catch {
      return [];
    }
  }

  public setInstalledModules(modules: readonly string[]): void {
    this.installedModules.clear();
    this.installedModules.add('core');
    for (const mod of modules) {
      if (mod?.trim()) {
        this.installedModules.add(mod.trim().toLowerCase());
      }
    }
    this.invalidateCache({ silent: true });
  }

  public getInstalledModules(): string[] {
    return Array.from(this.installedModules).sort();
  }

  public isModuleInstalled(moduleName: string): boolean {
    const norm = moduleName.trim().toLowerCase();
    return norm === 'core' || this.installedModules.has(norm);
  }

  public getCacheVersion(): number {
    return this.cacheVersion;
  }

  public registerMenu(
    menu: Omit<RegisteredMenuDefinition, 'statusName' | 'typeName' | 'level' | 'parentCode'> & {
      readonly statusName?: MenuStatusName | undefined;
      readonly typeName?: MenuTypeName | undefined;
      readonly level?: number | undefined;
      readonly parentCode?: string | null | undefined;
    },
    options?: { silent?: boolean },
  ): RegisteredMenuDefinition {
    const code = menu.code.trim().toUpperCase();
    const id = menu.id > 0 ? menu.id : ++this.autoIdSeq;
    if (id >= this.autoIdSeq) {
      this.autoIdSeq = id + 1;
    }

    const parentId = menu.parent && menu.parent > 0 ? menu.parent : null;
    if (parentId !== null) {
      detectMenuCycle(id, parentId, (currId) => this.menusById.get(currId)?.parent ?? null);
    }

    const parentDef = parentId !== null ? (this.menusById.get(parentId) ?? null) : null;
    const computedLevel = parentDef
      ? parentDef.level + 1
      : menu.level && menu.level > 0
        ? menu.level
        : 1;
    const computedParentCode = parentDef
      ? parentDef.code
      : (menu.parentCode?.trim().toUpperCase() ?? null);

    const normalized: RegisteredMenuDefinition = {
      id,
      code,
      module: (menu.module || 'settings').trim().toLowerCase(),
      name: menu.name.trim(),
      status: menu.status,
      statusName: MENU_STATUS_NAME_BY_CODE[menu.status],
      link: menu.link?.trim() ? menu.link.trim() : null,
      linkApi: menu.linkApi?.trim() ? menu.linkApi.trim() : null,
      type: menu.type,
      typeName: MENU_TYPE_NAME_BY_CODE[menu.type],
      parent: parentId,
      parentCode: computedParentCode,
      level: computedLevel,
      key: menu.key?.trim() ? menu.key.trim().toLowerCase() : null,
      numOrder: Number.isFinite(menu.numOrder) ? Math.trunc(menu.numOrder) : 0,
      icon: menu.icon?.trim() ? menu.icon.trim() : null,
      position: menu.position,
      updatedAt: menu.updatedAt ?? new Date().toISOString(),
    };

    const prevByCode = this.menusByCode.get(code);
    if (prevByCode && prevByCode.id !== id) {
      this.menusById.delete(prevByCode.id);
    }

    this.menusByCode.set(code, normalized);
    this.menusById.set(id, normalized);
    this.recomputeHierarchyLevels();

    if (!options?.silent) {
      this.invalidateCache({ action: 'UPDATE', code });
    } else {
      this.treeCache.clear();
    }

    return this.menusByCode.get(code)!;
  }

  public removeMenu(codeOrId: string | number, options?: { silent?: boolean }): boolean {
    const target =
      typeof codeOrId === 'number'
        ? this.menusById.get(codeOrId)
        : this.menusByCode.get(codeOrId.trim().toUpperCase());
    if (!target) return false;

    this.menusByCode.delete(target.code);
    this.menusById.delete(target.id);
    if (!options?.silent) {
      this.invalidateCache({ action: 'DELETE', code: target.code });
    } else {
      this.treeCache.clear();
    }
    return true;
  }

  public getMenuByCode(code: string): RegisteredMenuDefinition | null {
    return this.menusByCode.get(code.trim().toUpperCase()) ?? null;
  }

  public getMenuById(id: number): RegisteredMenuDefinition | null {
    return this.menusById.get(id) ?? null;
  }

  public getDirectChildren(parentId: number): RegisteredMenuDefinition[] {
    return Array.from(this.menusById.values())
      .filter((m) => m.parent === parentId)
      .sort((a, b) => a.numOrder - b.numOrder || a.id - b.id);
  }

  public getDescendantIds(rootId: number): number[] {
    const descendants: number[] = [];
    const queue: number[] = [rootId];
    const visited = new Set<number>([rootId]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const item of this.menusById.values()) {
        if (item.parent === currentId && !visited.has(item.id)) {
          visited.add(item.id);
          descendants.push(item.id);
          queue.push(item.id);
        }
      }
    }
    return descendants;
  }

  public listMenus(filter?: {
    readonly module?: string | undefined;
    readonly status?: number | undefined;
    readonly type?: number | undefined;
    readonly parent?: number | null | undefined;
    readonly level?: number | undefined;
    readonly position?: string | undefined;
    readonly search?: string | undefined;
  }): RegisteredMenuDefinition[] {
    let items = Array.from(this.menusByCode.values());

    if (filter?.module?.trim()) {
      const mod = filter.module.trim().toLowerCase();
      items = items.filter((m) => m.module === mod);
    }
    if (filter?.status !== undefined) {
      items = items.filter((m) => m.status === filter.status);
    }
    if (filter?.type !== undefined) {
      items = items.filter((m) => m.type === filter.type);
    }
    if (filter?.parent !== undefined) {
      items = items.filter((m) => m.parent === filter.parent);
    }
    if (filter?.level !== undefined) {
      items = items.filter((m) => m.level === filter.level);
    }
    if (filter?.position?.trim()) {
      const pos = filter.position.trim().toUpperCase();
      items = items.filter((m) => m.position === pos);
    }
    if (filter?.search?.trim()) {
      const kw = filter.search.trim().toLowerCase();
      items = items.filter(
        (m) =>
          m.code.toLowerCase().includes(kw) ||
          m.name.toLowerCase().includes(kw) ||
          (m.link?.toLowerCase().includes(kw) ?? false) ||
          (m.linkApi?.toLowerCase().includes(kw) ?? false) ||
          (m.key?.toLowerCase().includes(kw) ?? false),
      );
    }

    return items.sort((a, b) => a.level - b.level || a.numOrder - b.numOrder || a.id - b.id);
  }

  /**
   * Đồng bộ danh sách `MenuManifestItem` vào L1 Registry (tự động giải quyết `parentCode` -> `parent` ID và `level`).
   */
  public registerManifestMenus(items?: readonly MenuManifestItem[]): number {
    const manifestItems = items ?? discoverManifestMenus();
    let count = 0;

    const pendingParentCodeByMenuCode = new Map<string, string>();
    for (const raw of manifestItems) {
      const validated = validateMenuInput({
        code: raw.code,
        name: raw.name,
        status: raw.status ?? MENU_STATUS.ACTIVE,
        link: raw.link,
        linkApi: raw.linkApi,
        type: raw.type ?? (raw.link ? MENU_TYPE.ITEM : MENU_TYPE.GROUP),
        key: raw.key,
        numOrder: raw.numOrder ?? 0,
        icon: raw.icon,
        position: raw.position ?? MENU_POSITION.SIDEBAR,
      });

      const existing = this.menusByCode.get(validated.code);
      const id = existing?.id ?? ++this.autoIdSeq;
      const parentCode = raw.parentCode?.trim().toUpperCase() ?? null;
      if (parentCode) {
        pendingParentCodeByMenuCode.set(validated.code, parentCode);
      }

      this.registerMenu(
        {
          id,
          code: validated.code,
          module: (raw.module ?? 'settings').trim().toLowerCase(),
          name: existing?.name ?? validated.name,
          status: existing?.status ?? validated.status,
          link: existing?.link ?? validated.link,
          linkApi: existing?.linkApi ?? validated.linkApi,
          type: existing?.type ?? validated.type,
          parent: existing?.parent ?? raw.parent ?? null,
          parentCode,
          level: raw.level ?? 1,
          key: existing?.key !== undefined ? existing.key : validated.key,
          numOrder: existing?.numOrder ?? validated.numOrder,
          icon: existing?.icon !== undefined ? existing.icon : validated.icon,
          position: existing?.position ?? validated.position,
        },
        { silent: true },
      );
      count++;
    }

    for (const [childCode, parentCode] of pendingParentCodeByMenuCode.entries()) {
      const child = this.menusByCode.get(childCode);
      const parent = this.menusByCode.get(parentCode);
      if (child && parent && child.parent !== parent.id) {
        const updatedChild: RegisteredMenuDefinition = {
          ...child,
          parent: parent.id,
          parentCode: parent.code,
          level: parent.level + 1,
        };
        this.menusByCode.set(child.code, updatedChild);
        this.menusById.set(child.id, updatedChild);
      }
    }

    this.recomputeHierarchyLevels();
    this.invalidateCache({ action: 'SYNC', silent: true });
    return count;
  }

  /**
   * 5.6.1 -> 5.6.4: Dựng cây menu đa cấp đã lọc theo trạng thái bật/tắt (`status = 1`),
   * trạng thái module đã cài đặt (`installedModules`), và quyền của người dùng (`key`),
   * kèm Cache L1 tự động xóa khi thay đổi.
   */
  public buildAuthorizedMenuTree(
    options?: BuildAuthorizedMenuTreeOptions,
  ): MenuTreeEvaluationResult {
    const positionFilter = options?.position?.trim() ? parseMenuPosition(options.position) : 'ALL';
    const typeFilter = options?.type;
    const includeInactive = Boolean(options?.includeInactive);

    const normRoles = new Set<string>(
      (options?.roles ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean),
    );
    const normPerms = new Set<string>(
      (options?.permissions ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean),
    );
    const isSuperAdmin =
      Boolean(options?.isSuperAdmin) ||
      normRoles.has('super_admin') ||
      normRoles.has('superadmin') ||
      normPerms.has('*');

    const cacheKey = [
      `v:${this.cacheVersion}`,
      `pos:${positionFilter}`,
      `type:${typeFilter ?? 'ALL'}`,
      `inact:${includeInactive ? 1 : 0}`,
      `sa:${isSuperAdmin ? 1 : 0}`,
      `roles:${Array.from(normRoles).sort().join(',')}`,
      `perms:${Array.from(normPerms).sort().join(',')}`,
    ].join('|');

    const cached = this.treeCache.get(cacheKey);
    if (cached) {
      const cloned = this.cloneTreeNodes(cached);
      return {
        position: positionFilter,
        cacheVersion: this.cacheVersion,
        fromCache: true,
        totalNodes: this.countTreeNodes(cloned),
        items: cloned,
      };
    }

    const activeById = this.filterAuthorizedMenuMap({
      includeInactive,
      positionFilter,
      typeFilter,
      normPerms,
      normRoles,
      isSuperAdmin,
    });

    const tree = this.assembleMenuHierarchyTree(activeById, includeInactive);
    this.treeCache.set(cacheKey, this.cloneTreeNodes(tree));

    return {
      position: positionFilter,
      cacheVersion: this.cacheVersion,
      fromCache: false,
      totalNodes: this.countTreeNodes(tree),
      items: tree,
    };
  }

  public invalidateCache(options?: {
    readonly action?:
      'SYNC' | 'CREATE' | 'UPDATE' | 'TOGGLE' | 'REORDER' | 'DELETE' | 'INVALIDATE' | undefined;
    readonly code?: string | undefined;
    readonly silent?: boolean | undefined;
  }): number {
    this.cacheVersion++;
    this.treeCache.clear();
    if (!options?.silent) {
      const evt = {
        action: options?.action ?? 'INVALIDATE',
        code: options?.code,
        cacheVersion: this.cacheVersion,
      };
      for (const listener of this.listeners) {
        try {
          void listener(evt);
        } catch {
          // Ignore listener error
        }
      }
    }
    return this.cacheVersion;
  }

  public onMenuChanged(listener: MenuChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public clear(): void {
    this.menusByCode.clear();
    this.menusById.clear();
    this.treeCache.clear();
    this.cacheVersion++;
  }

  public recomputeHierarchyLevels(): void {
    for (const item of this.menusById.values()) {
      let level = 1;
      let parentCode: string | null = null;
      if (item.parent !== null) {
        const directParent = this.menusById.get(item.parent);
        parentCode = directParent?.code ?? item.parentCode;
        let curr = directParent;
        const seen = new Set<number>([item.id]);
        while (curr && !seen.has(curr.id)) {
          seen.add(curr.id);
          level++;
          curr = curr.parent !== null ? this.menusById.get(curr.parent) : undefined;
        }
      }
      if (item.level !== level || item.parentCode !== parentCode) {
        const updated: RegisteredMenuDefinition = {
          ...item,
          level,
          parentCode,
        };
        this.menusById.set(item.id, updated);
        this.menusByCode.set(item.code, updated);
      }
    }
  }

  private filterAuthorizedMenuMap(params: {
    includeInactive: boolean;
    positionFilter: string;
    typeFilter: number | undefined;
    normPerms: ReadonlySet<string>;
    normRoles: ReadonlySet<string>;
    isSuperAdmin: boolean;
  }): Map<number, RegisteredMenuDefinition> {
    const activeById = new Map<number, RegisteredMenuDefinition>();
    for (const menu of this.menusById.values()) {
      if (!params.includeInactive && menu.status !== MENU_STATUS.ACTIVE) {
        continue;
      }
      const isSharedContainerGroup =
        menu.type === MENU_TYPE.GROUP && (!menu.link || menu.link.trim() === '');
      if (!isSharedContainerGroup && !this.isModuleInstalled(menu.module)) {
        continue;
      }
      if (params.positionFilter !== 'ALL' && menu.position !== params.positionFilter) {
        continue;
      }
      if (params.typeFilter !== undefined && menu.type !== params.typeFilter) {
        continue;
      }
      if (!this.isMenuAuthorized(menu, params.normPerms, params.normRoles, params.isSuperAdmin)) {
        continue;
      }
      activeById.set(menu.id, menu);
    }
    return activeById;
  }

  private assembleMenuHierarchyTree(
    activeById: Map<number, RegisteredMenuDefinition>,
    includeInactive: boolean,
  ): MenuTreeNode[] {
    const childrenByParentId = new Map<number | null, RegisteredMenuDefinition[]>();
    for (const menu of activeById.values()) {
      if (menu.parent !== null && !activeById.has(menu.parent)) {
        continue;
      }
      const list = childrenByParentId.get(menu.parent) ?? [];
      list.push(menu);
      childrenByParentId.set(menu.parent, list);
    }

    const buildSubtree = (parentId: number | null, visitedIds: Set<number>): MenuTreeNode[] => {
      const rawChildren = childrenByParentId.get(parentId) ?? [];
      rawChildren.sort((a, b) => a.numOrder - b.numOrder || a.id - b.id);

      const result: MenuTreeNode[] = [];
      for (const item of rawChildren) {
        if (visitedIds.has(item.id)) continue;
        const nextVisited = new Set(visitedIds);
        nextVisited.add(item.id);

        const childNodes = buildSubtree(item.id, nextVisited);
        if (
          !includeInactive &&
          item.type === MENU_TYPE.GROUP &&
          childNodes.length === 0 &&
          (!item.link || item.link.trim() === '')
        ) {
          continue;
        }

        result.push({
          ...item,
          children: childNodes,
        });
      }
      return result;
    };

    return buildSubtree(null, new Set<number>());
  }

  private isMenuAuthorized(
    menu: RegisteredMenuDefinition,
    userPerms: ReadonlySet<string>,
    userRoles: ReadonlySet<string>,
    isSuperAdmin: boolean,
  ): boolean {
    if (!menu.key || menu.key.trim() === '') {
      return true;
    }
    if (isSuperAdmin) {
      return true;
    }
    const requiredKeys = menu.key
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (requiredKeys.length === 0) {
      return true;
    }
    return requiredKeys.some((reqKey) => userPerms.has(reqKey) || userRoles.has(reqKey));
  }

  private countTreeNodes(nodes: readonly MenuTreeNode[]): number {
    let total = 0;
    for (const node of nodes) {
      total += 1 + this.countTreeNodes(node.children);
    }
    return total;
  }

  private cloneTreeNodes(nodes: readonly MenuTreeNode[]): MenuTreeNode[] {
    return nodes.map((n) => ({
      ...n,
      children: this.cloneTreeNodes(n.children),
    }));
  }
}

export const defaultMenuRegistry = new MenuRegistryService();
