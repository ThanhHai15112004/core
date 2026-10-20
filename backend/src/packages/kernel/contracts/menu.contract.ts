import { UnprocessableEntityAppException } from '../errors/http-exceptions.js';
import { scanModuleManifests } from './manifest.contract.js';

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
    throw new UnprocessableEntityAppException('kernel.menu.invalidNameLength');
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
      throw new UnprocessableEntityAppException('kernel.menu.hierarchyDepthExceeded');
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
