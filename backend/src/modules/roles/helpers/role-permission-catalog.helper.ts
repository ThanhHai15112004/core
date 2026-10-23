import {
  type ModulePermissionsManifestInput,
  PERMISSION_STATUS,
  type RoleSummary,
} from '../contracts/index.js';
import type { PermissionEntity } from '../entities/permission.entity.js';
import type { RoleEntity } from '../entities/role.entity.js';
import type {
  OrphanedPermissionWarningResponse,
  PermissionCatalogItemResponse,
  PermissionFunctionalGroupResponse,
  RolePermissionMatrixResponse,
  RolePermissionMatrixRowResponse,
} from '../responses/roles.response.js';
import type { NormalizedPermissionDeclaration } from '../types/roles.types.js';

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

/** Chuyển danh sách PermissionEntity sang danh mục quyền kèm trạng thái mồ côi */
export function mapPermissionsToCatalogItems(
  perms: readonly PermissionEntity[],
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

/** Tạo danh sách cảnh báo các quyền mồ côi kèm danh sách vai trò đang gán */
export function buildOrphanedPermissionWarnings(
  orphanedPerms: readonly PermissionEntity[],
  roles: readonly RoleEntity[],
  permsMap: ReadonlyMap<number, readonly PermissionEntity[]>,
): OrphanedPermissionWarningResponse[] {
  return orphanedPerms.map((perm) => {
    const assignedRoles = roles
      .filter((role) => {
        const rolePerms = permsMap.get(Number(role.id)) ?? [];
        return rolePerms.some((rp) => Number(rp.id) === Number(perm.id) || rp.code === perm.code);
      })
      .map((role) => ({
        id: Number(role.id),
        code: role.code,
        name: role.name,
      }));

    return {
      id: Number(perm.id),
      code: perm.code,
      name: perm.name,
      module: perm.module,
      assignedRoles,
      warningMessage:
        assignedRoles.length > 0
          ? `Permission '${perm.code}' is not declared by any active module manifest and is still assigned to ${assignedRoles.length} role(s).`
          : `Permission '${perm.code}' is not declared by any active module manifest (unused orphan permission).`,
    };
  });
}

/** Dựng bảng ma trận tổng hợp Vai trò × Quyền toàn hệ thống */
export function buildRolePermissionMatrix(
  roles: readonly RoleEntity[],
  catalog: readonly PermissionCatalogItemResponse[],
  permsMap: ReadonlyMap<number, readonly PermissionEntity[]>,
  toSummary: (role: RoleEntity, perms: readonly PermissionEntity[]) => RoleSummary,
): RolePermissionMatrixResponse {
  const rolePermCodeSets = new Map<number, Set<string>>();
  for (const role of roles) {
    const rId = Number(role.id);
    const rPerms = permsMap.get(rId) ?? [];
    rolePermCodeSets.set(rId, new Set(rPerms.map((p) => p.code.trim().toLowerCase())));
  }

  const rows: RolePermissionMatrixRowResponse[] = catalog.map((perm) => {
    const normalizedCode = perm.code.trim().toLowerCase();
    const grantedRoleIds: number[] = [];
    const grantedRoleCodes: string[] = [];
    const roleGrants: Record<string, boolean> = {};

    for (const role of roles) {
      const rId = Number(role.id);
      const hasPerm = rolePermCodeSets.get(rId)?.has(normalizedCode) ?? false;
      roleGrants[role.code] = hasPerm;
      if (hasPerm) {
        grantedRoleIds.push(rId);
        grantedRoleCodes.push(role.code);
      }
    }

    return {
      permissionId: perm.id,
      code: perm.code,
      name: perm.name,
      module: perm.module,
      featureGroup: perm.featureGroup,
      isOrphaned: perm.isOrphaned,
      grantedRoleIds,
      grantedRoleCodes,
      roleGrants,
    };
  });

  const modulesSet = new Set<string>(catalog.map((c) => c.module));
  const totalOrphanedPermissions = catalog.filter((c) => c.isOrphaned).length;

  return {
    roles: roles.map((role) => {
      const rId = Number(role.id);
      const mapped = toSummary(role, permsMap.get(rId) ?? []);
      return {
        id: mapped.id,
        code: mapped.code,
        name: mapped.name,
        isSystem: mapped.isSystem,
        dataScope: mapped.dataScope,
        dataScopeName: mapped.dataScopeName,
        status: mapped.status,
        statusName: mapped.statusName,
        totalGrantedPermissions: mapped.permissions.length,
      };
    }),
    modules: [...modulesSet].sort(),
    rows,
    summary: {
      totalRoles: roles.length,
      totalPermissions: catalog.length,
      totalOrphanedPermissions,
    },
  };
}
