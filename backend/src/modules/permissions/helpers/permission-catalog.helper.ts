import {
  type ModulePermissionsManifestInput,
  PERMISSION_STATUS,
  type PermissionItemSummary,
} from '../contracts/index.js';
import type {
  OrphanedPermissionWarningResponse,
  PermissionCatalogItemResponse,
  PermissionFunctionalGroupResponse,
} from '../responses/permissions.response.js';

export interface NormalizedPermissionDeclaration {
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly moduleDisplayName: string;
  readonly featureGroup: string;
  readonly description: string | null;
}

/** Trích xuất tên module từ mã quyền (ví dụ `users.read` -> `users`) */
export function extractModuleFromPermissionCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  return normalized.includes('.') ? normalized.split('.')[0]! : 'core';
}

/** Suy diễn nhóm chức năng từ mã quyền (ví dụ `auth.sessions.manage` -> `auth.sessions`, `users.read` -> `users`) */
export function derivePermissionFeatureGroup(code: string, moduleName: string): string {
  const parts = code.trim().toLowerCase().split('.').filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0]}.${parts[1]}`;
  }
  return moduleName || parts[0] || 'core';
}

/** Tạo tên hiển thị thân thiện từ mã quyền */
export function formatPermissionDisplayName(code: string): string {
  return code
    .trim()
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Tổng hợp bản đồ mã quyền -> thông tin quyền đã chuẩn hóa từ các module đang hoạt động */
export function buildDeclaredPermissionsMap(
  activeModules: ReadonlyMap<string, ModulePermissionsManifestInput>,
): Map<string, NormalizedPermissionDeclaration> {
  const map = new Map<string, NormalizedPermissionDeclaration>();

  for (const [modKey, manifest] of activeModules.entries()) {
    const moduleName = modKey.trim().toLowerCase();
    const moduleDisplayName = manifest.displayName?.trim() || moduleName;

    for (const permEntry of manifest.permissions) {
      if (typeof permEntry === 'string') {
        const code = permEntry.trim().toLowerCase();
        if (!code) continue;
        map.set(code, {
          code,
          name: formatPermissionDisplayName(code),
          module: moduleName,
          moduleDisplayName,
          featureGroup: derivePermissionFeatureGroup(code, moduleName),
          description: `Permission ${code} declared by module ${moduleName}`,
        });
      } else if (permEntry && typeof permEntry === 'object') {
        const code = permEntry.code.trim().toLowerCase();
        if (!code) continue;
        map.set(code, {
          code,
          name: permEntry.name?.trim() || formatPermissionDisplayName(code),
          module: moduleName,
          moduleDisplayName,
          featureGroup:
            permEntry.featureGroup?.trim() || derivePermissionFeatureGroup(code, moduleName),
          description:
            permEntry.description !== undefined
              ? permEntry.description
              : `Permission ${code} declared by module ${moduleName}`,
        });
      }
    }
  }

  return map;
}

/** Chuyển danh sách quyền sang danh mục quyền kèm trạng thái mồ côi */
export function mapPermissionsToCatalogItems(
  perms: readonly PermissionItemSummary[],
  declaredMap: ReadonlyMap<string, NormalizedPermissionDeclaration>,
): PermissionCatalogItemResponse[] {
  return perms.map((p) => {
    const normalizedCode = p.code.trim().toLowerCase();
    const declared = declaredMap.get(normalizedCode);
    const moduleName =
      p.module || declared?.module || extractModuleFromPermissionCode(normalizedCode);
    const featureGroup =
      declared?.featureGroup ?? derivePermissionFeatureGroup(normalizedCode, moduleName);

    return {
      id: Number(p.id),
      code: p.code,
      name: p.name,
      module: moduleName,
      featureGroup,
      description: p.description ?? null,
      status:
        p.status === PERMISSION_STATUS.INACTIVE
          ? PERMISSION_STATUS.INACTIVE
          : PERMISSION_STATUS.ACTIVE,
      statusName: p.status === PERMISSION_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
      isOrphaned: !declaredMap.has(normalizedCode),
    };
  });
}

/** Gom nhóm danh mục quyền theo module và nhóm chức năng */
export function groupPermissionCatalogItems(
  catalog: readonly PermissionCatalogItemResponse[],
  activeModules: ReadonlyMap<string, ModulePermissionsManifestInput>,
): PermissionFunctionalGroupResponse[] {
  const groupsMap = new Map<
    string,
    {
      module: string;
      moduleDisplayName: string;
      featureGroup: string;
      permissions: PermissionCatalogItemResponse[];
    }
  >();

  for (const item of catalog) {
    const key = `${item.module}::${item.featureGroup}`;
    const existing = groupsMap.get(key);
    if (existing) {
      existing.permissions.push(item);
    } else {
      const modManifest = activeModules.get(item.module.toLowerCase());
      groupsMap.set(key, {
        module: item.module,
        moduleDisplayName: modManifest?.displayName || item.module,
        featureGroup: item.featureGroup,
        permissions: [item],
      });
    }
  }

  return [...groupsMap.values()]
    .sort((a, b) =>
      a.module === b.module
        ? a.featureGroup.localeCompare(b.featureGroup)
        : a.module.localeCompare(b.module),
    )
    .map((g) => ({
      module: g.module,
      moduleDisplayName: g.moduleDisplayName,
      featureGroup: g.featureGroup,
      totalPermissions: g.permissions.length,
      permissions: g.permissions,
    }));
}

/** Tạo danh sách cảnh báo các quyền mồ côi không còn thuộc bất kỳ module hoạt động nào */
export function buildOrphanedPermissionWarnings(
  orphanedPerms: readonly PermissionItemSummary[],
): OrphanedPermissionWarningResponse[] {
  return orphanedPerms.map((perm) => ({
    id: Number(perm.id),
    code: perm.code,
    name: perm.name,
    module: perm.module,
    assignedRoles: [],
    warningMessage: `Permission '${perm.code}' is not declared by any active module manifest (unused orphan permission).`,
  }));
}
