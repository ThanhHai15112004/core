import { UnprocessableEntityAppException } from '../errors/http-exceptions.js';
import { discoverInstalledModules, scanModuleManifests } from './manifest.contract.js';

/**
 * Trạng thái Bật / Tắt của mục Menu (Mục 5.6.1):
 * - `1`: ACTIVE (Đang bật / Hiển thị)
 * - `0`: INACTIVE (Đang tắt / Ẩn)
 */
export const MENU_STATUS = {
  INACTIVE: 0,
  ACTIVE: 1,
} as const;

export type MenuStatusCode = (typeof MENU_STATUS)[keyof typeof MENU_STATUS];
export type MenuStatusName = keyof typeof MENU_STATUS;

export const MENU_STATUS_NAME_BY_CODE: Readonly<Record<MenuStatusCode, MenuStatusName>> = {
  [MENU_STATUS.INACTIVE]: 'INACTIVE',
  [MENU_STATUS.ACTIVE]: 'ACTIVE',
};

/**
 * Loại hiển thị của phần tử Menu (Mục 5.6.3):
 * - `1`: GROUP (Nhóm menu cha gom các mục con)
 * - `2`: ITEM (Mục điều hướng nội bộ có `link`)
 * - `3`: EXTERNAL (Liên kết mở ra trang ngoài)
 * - `4`: ACTION (Nút kích hoạt hành động nhanh)
 */
export const MENU_TYPE = {
  GROUP: 1,
  ITEM: 2,
  EXTERNAL: 3,
  ACTION: 4,
} as const;

export type MenuTypeCode = (typeof MENU_TYPE)[keyof typeof MENU_TYPE];
export type MenuTypeName = keyof typeof MENU_TYPE;

export const MENU_TYPE_NAME_BY_CODE: Readonly<Record<MenuTypeCode, MenuTypeName>> = {
  [MENU_TYPE.GROUP]: 'GROUP',
  [MENU_TYPE.ITEM]: 'ITEM',
  [MENU_TYPE.EXTERNAL]: 'EXTERNAL',
  [MENU_TYPE.ACTION]: 'ACTION',
};

/**
 * Vị trí hiển thị của Menu trên giao diện (Mục 5.6.3):
 * - `SIDEBAR`: Thanh điều hướng bên trái
 * - `TOPBAR`: Thanh điều hướng phía trên
 * - `FOOTER`: Chân trang
 * - `SYSTEM_CONSOLE`: Bảng điều khiển vận hành kỹ thuật
 */
export const MENU_POSITION = {
  SIDEBAR: 'SIDEBAR',
  TOPBAR: 'TOPBAR',
  FOOTER: 'FOOTER',
  SYSTEM_CONSOLE: 'SYSTEM_CONSOLE',
} as const;

export type MenuPositionCode = (typeof MENU_POSITION)[keyof typeof MENU_POSITION];

export const VALID_MENU_POSITIONS: ReadonlySet<string> = new Set<string>(
  Object.values(MENU_POSITION),
);

export interface MenuManifestItem {
  readonly code: string;
  readonly name: string;
  readonly module?: string | undefined;
  readonly status?: number | string | boolean | undefined;
  readonly link?: string | null | undefined;
  readonly linkApi?: string | null | undefined;
  readonly type?: number | string | undefined;
  readonly parent?: number | null | undefined;
  readonly parentCode?: string | null | undefined;
  readonly level?: number | undefined;
  /** Khóa phân quyền (`permission key`, vd: `users.read`, `roles.read`, `settings.read`) */
  readonly key?: string | null | undefined;
  readonly numOrder?: number | undefined;
  readonly icon?: string | null | undefined;
  readonly position?: string | undefined;
}

export interface RegisteredMenuDefinition {
  readonly id: number;
  readonly code: string;
  readonly module: string;
  readonly name: string;
  readonly status: MenuStatusCode;
  readonly statusName: MenuStatusName;
  readonly link: string | null;
  readonly linkApi: string | null;
  readonly type: MenuTypeCode;
  readonly typeName: MenuTypeName;
  readonly parent: number | null;
  readonly parentCode: string | null;
  readonly level: number;
  readonly key: string | null;
  readonly numOrder: number;
  readonly icon: string | null;
  readonly position: MenuPositionCode;
  readonly updatedAt?: string | undefined;
}

export interface MenuTreeNode extends RegisteredMenuDefinition {
  readonly children: MenuTreeNode[];
}

export interface BuildAuthorizedMenuTreeOptions {
  readonly position?: string | undefined;
  readonly type?: number | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly roles?: readonly string[] | undefined;
  readonly isSuperAdmin?: boolean | undefined;
  readonly includeInactive?: boolean | undefined;
}

export interface MenuTreeEvaluationResult {
  readonly position: string;
  readonly cacheVersion: number;
  readonly fromCache: boolean;
  readonly totalNodes: number;
  readonly items: MenuTreeNode[];
}

export type MenuChangeListener = (event: {
  readonly action: 'SYNC' | 'CREATE' | 'UPDATE' | 'TOGGLE' | 'REORDER' | 'DELETE' | 'INVALIDATE';
  readonly code?: string | undefined;
  readonly cacheVersion: number;
}) => void | Promise<void>;

export function parseMenuStatusCode(
  raw: unknown,
  defaultStatus: MenuStatusCode = MENU_STATUS.ACTIVE,
): MenuStatusCode {
  if (raw === undefined || raw === null || raw === '') return defaultStatus;
  if (typeof raw === 'boolean') return raw ? MENU_STATUS.ACTIVE : MENU_STATUS.INACTIVE;
  if (typeof raw === 'number') {
    if (raw === MENU_STATUS.ACTIVE) return MENU_STATUS.ACTIVE;
    if (raw === MENU_STATUS.INACTIVE) return MENU_STATUS.INACTIVE;
  }
  if (typeof raw === 'string') {
    const norm = raw.trim().toUpperCase();
    if (norm === '1' || norm === 'ACTIVE' || norm === 'TRUE' || norm === 'ENABLED') {
      return MENU_STATUS.ACTIVE;
    }
    if (norm === '0' || norm === 'INACTIVE' || norm === 'FALSE' || norm === 'DISABLED') {
      return MENU_STATUS.INACTIVE;
    }
  }
  throw new UnprocessableEntityAppException(
    `Invalid menu status '${String(raw)}'. Expected 0 (INACTIVE) or 1 (ACTIVE)`,
  );
}

export function parseMenuTypeCode(
  raw: unknown,
  defaultType: MenuTypeCode = MENU_TYPE.ITEM,
): MenuTypeCode {
  if (raw === undefined || raw === null || raw === '') return defaultType;
  if (typeof raw === 'number') {
    if (raw === 1 || raw === 2 || raw === 3 || raw === 4) {
      return raw as MenuTypeCode;
    }
  }
  if (typeof raw === 'string') {
    const norm = raw.trim().toUpperCase();
    if (norm === '1' || norm === 'GROUP') return MENU_TYPE.GROUP;
    if (norm === '2' || norm === 'ITEM' || norm === 'LINK') return MENU_TYPE.ITEM;
    if (norm === '3' || norm === 'EXTERNAL') return MENU_TYPE.EXTERNAL;
    if (norm === '4' || norm === 'ACTION') return MENU_TYPE.ACTION;
  }
  throw new UnprocessableEntityAppException(
    `Invalid menu type '${String(raw)}'. Allowed: 1 (GROUP), 2 (ITEM), 3 (EXTERNAL), 4 (ACTION)`,
  );
}

export function parseMenuPosition(
  raw: unknown,
  defaultPos: MenuPositionCode = MENU_POSITION.SIDEBAR,
): MenuPositionCode {
  if (raw === undefined || raw === null || raw === '') return defaultPos;
  if (typeof raw === 'string') {
    const norm = raw.trim().toUpperCase();
    if (VALID_MENU_POSITIONS.has(norm)) {
      return norm as MenuPositionCode;
    }
  }
  throw new UnprocessableEntityAppException(
    `Invalid menu position '${String(raw)}'. Allowed: ${Array.from(VALID_MENU_POSITIONS).join(', ')}`,
  );
}

export function validateMenuInput(input: {
  readonly code: string;
  readonly name: string;
  readonly status?: unknown;
  readonly link?: string | null | undefined;
  readonly linkApi?: string | null | undefined;
  readonly type?: unknown;
  readonly key?: string | null | undefined;
  readonly numOrder?: number | undefined;
  readonly icon?: string | null | undefined;
  readonly position?: unknown;
}): {
  readonly code: string;
  readonly name: string;
  readonly status: MenuStatusCode;
  readonly statusName: MenuStatusName;
  readonly link: string | null;
  readonly linkApi: string | null;
  readonly type: MenuTypeCode;
  readonly typeName: MenuTypeName;
  readonly key: string | null;
  readonly numOrder: number;
  readonly icon: string | null;
  readonly position: MenuPositionCode;
} {
  const code = input.code?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9][A-Z0-9._-]{1,99}$/.test(code)) {
    throw new UnprocessableEntityAppException(
      `Invalid menu code '${input.code}'. Code must be 2..100 characters using alphanumeric, dot, underscore or hyphen`,
    );
  }

  const name = input.name?.trim() ?? '';
  if (name.length < 1 || name.length > 255) {
    throw new UnprocessableEntityAppException('Menu name must be between 1 and 255 characters');
  }

  const type = parseMenuTypeCode(input.type, MENU_TYPE.ITEM);
  const status = parseMenuStatusCode(input.status, MENU_STATUS.ACTIVE);
  const position = parseMenuPosition(input.position, MENU_POSITION.SIDEBAR);
  const link = input.link?.trim() ? input.link.trim() : null;
  const linkApi = input.linkApi?.trim() ? input.linkApi.trim() : null;
  const key = input.key?.trim() ? input.key.trim().toLowerCase() : null;
  const icon = input.icon?.trim() ? input.icon.trim() : null;
  const numOrder =
    typeof input.numOrder === 'number' && Number.isFinite(input.numOrder)
      ? Math.trunc(input.numOrder)
      : 0;

  return {
    code,
    name,
    status,
    statusName: MENU_STATUS_NAME_BY_CODE[status],
    link,
    linkApi,
    type,
    typeName: MENU_TYPE_NAME_BY_CODE[type],
    key,
    numOrder,
    icon,
    position,
  };
}

/**
 * Kiểm tra chống vòng lặp Cha - Con trên cây menu (Cycle Detection — Mục 5.6.1).
 * Ném `UnprocessableEntityAppException` nếu `candidateParentId` trùng `candidateId`
 * hoặc `candidateParentId` là hậu duệ của `candidateId`.
 */
export function detectMenuCycle(
  candidateId: number,
  candidateParentId: number | null | undefined,
  getParentOf: (id: number) => number | null | undefined,
): void {
  if (candidateParentId === null || candidateParentId === undefined || candidateParentId <= 0) {
    return;
  }
  if (candidateId === candidateParentId) {
    throw new UnprocessableEntityAppException(
      `Circular menu hierarchy detected: menu #${candidateId} cannot be its own parent`,
    );
  }

  const visited = new Set<number>([candidateId]);
  let current: number | null | undefined = candidateParentId;
  let guard = 0;

  while (current !== null && current !== undefined && current > 0) {
    if (visited.has(current)) {
      throw new UnprocessableEntityAppException(
        `Circular menu hierarchy detected when setting parent #${candidateParentId} for menu #${candidateId}`,
      );
    }
    visited.add(current);
    current = getParentOf(current);
    if (++guard > 1000) {
      throw new UnprocessableEntityAppException('Menu hierarchy depth exceeded safe limit');
    }
  }
}

/**
 * Quét tập trung toàn bộ mục `"menus"` từ các tệp `module.manifest.json` trong hệ thống.
 */
export function discoverManifestMenus(): MenuManifestItem[] {
  const entries = scanModuleManifests<{
    name?: string;
    menus?: MenuManifestItem[];
  }>();

  const discovered: MenuManifestItem[] = [];
  for (const entry of entries) {
    const rawMenus = entry.raw.menus;
    if (!Array.isArray(rawMenus)) continue;
    for (const item of rawMenus) {
      if (!item || typeof item.code !== 'string' || typeof item.name !== 'string') continue;
      discovered.push({
        ...item,
        code: item.code.trim().toUpperCase(),
        module: (item.module ?? entry.moduleName).trim().toLowerCase(),
      });
    }
  }
  return discovered;
}

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

    // Bước 1: Đăng ký sơ bộ tất cả menu để cấp ID và lưu parentCode
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

    // Bước 2: Ánh xạ parentCode -> parent ID
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

    // Lọc các menu đủ điều kiện hiển thị
    const allMenus = Array.from(this.menusById.values());
    const activeById = new Map<number, RegisteredMenuDefinition>();

    for (const menu of allMenus) {
      if (!includeInactive && menu.status !== MENU_STATUS.ACTIVE) {
        continue;
      }
      const isSharedContainerGroup =
        menu.type === MENU_TYPE.GROUP && (!menu.link || menu.link.trim() === '');
      if (!isSharedContainerGroup && !this.isModuleInstalled(menu.module)) {
        continue;
      }
      if (positionFilter !== 'ALL' && menu.position !== positionFilter) {
        continue;
      }
      if (typeFilter !== undefined && menu.type !== typeFilter) {
        continue;
      }
      if (!this.isMenuAuthorized(menu, normPerms, normRoles, isSuperAdmin)) {
        continue;
      }
      activeById.set(menu.id, menu);
    }

    // Dựng cây theo quan hệ parent -> children
    const childrenByParentId = new Map<number | null, RegisteredMenuDefinition[]>();
    for (const menu of activeById.values()) {
      // Nếu menu có parent nhưng parent đã bị tắt (status=0) hoặc không thuộc tập activeById -> không hiển thị nhánh con mồ côi
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

        // 5.6.2: Tự động ẩn nhóm GROUP rỗng (không có link riêng và không còn menu con nào hiển thị)
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

    const tree = buildSubtree(null, new Set<number>());
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
