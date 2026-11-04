import {
  type PermissionItemSummary,
  buildDeclaredPermissionsMap,
  derivePermissionFeatureGroup,
  extractModuleFromPermissionCode,
  formatPermissionDisplayName,
  groupPermissionCatalogItems,
  mapPermissionsToCatalogItems,
} from '@modules/permissions/index.js';
import type { RoleSummary } from '../contracts/index.js';
import type { RoleEntity } from '../entities/role.entity.js';
import type {
  OrphanedPermissionWarningResponse,
  PermissionCatalogItemResponse,
  RolePermissionMatrixResponse,
  RolePermissionMatrixRowResponse,
} from '../responses/roles.response.js';

export {
  buildDeclaredPermissionsMap,
  derivePermissionFeatureGroup,
  extractModuleFromPermissionCode,
  formatPermissionDisplayName,
  groupPermissionCatalogItems,
  mapPermissionsToCatalogItems,
};

/** Tạo danh sách cảnh báo các quyền mồ côi kèm danh sách vai trò đang gán (1 chiều từ roles -> permissions) */
export function buildOrphanedPermissionWarnings(
  orphanedPerms: readonly PermissionItemSummary[],
  roles: readonly {
    id: number;
    code: string;
    name: string;
    permissions?: readonly { id: number; code: string }[];
  }[],
  permsMap?: ReadonlyMap<number, readonly { id: number; code: string }[]>,
): OrphanedPermissionWarningResponse[] {
  return orphanedPerms.map((perm) => {
    const assignedRoles = roles
      .filter((role) => {
        const rolePerms = permsMap
          ? (permsMap.get(Number(role.id)) ?? [])
          : (role.permissions ?? []);
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

/** Dựng bảng ma trận tổng hợp Vai trò × Quyền toàn hệ thống (1 chiều từ roles -> permissions) */
export function buildRolePermissionMatrix(
  roles: readonly RoleEntity[],
  catalog: readonly PermissionCatalogItemResponse[],
  permsMap: ReadonlyMap<number, readonly PermissionItemSummary[]>,
  toSummary: (role: RoleEntity, perms: readonly PermissionItemSummary[]) => RoleSummary,
): RolePermissionMatrixResponse {
  const roleSummaries = roles.map((role) => {
    const rId = Number(role.id);
    const rPerms = permsMap.get(rId) ?? [];
    return {
      summary: toSummary(role, rPerms),
      permCodes: new Set(rPerms.map((p) => p.code.trim().toLowerCase())),
      totalGranted: rPerms.length,
    };
  });

  const rows: RolePermissionMatrixRowResponse[] = catalog.map((perm) => {
    const normalizedCode = perm.code.trim().toLowerCase();
    const grantedRoleIds: number[] = [];
    const grantedRoleCodes: string[] = [];
    const roleGrants: Record<string, boolean> = {};

    for (const item of roleSummaries) {
      const rId = Number(item.summary.id);
      const hasPerm = item.permCodes.has(normalizedCode);
      roleGrants[item.summary.code] = hasPerm;
      if (hasPerm) {
        grantedRoleIds.push(rId);
        grantedRoleCodes.push(item.summary.code);
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
    roles: roleSummaries.map((item) => ({
      id: Number(item.summary.id),
      code: item.summary.code,
      name: item.summary.name,
      isSystem: item.summary.isSystem,
      dataScope: item.summary.dataScope,
      dataScopeName: item.summary.dataScopeName,
      status: item.summary.status,
      statusName: item.summary.statusName,
      totalGrantedPermissions: item.totalGranted,
    })),
    modules: [...modulesSet].sort(),
    rows,
    summary: {
      totalRoles: roleSummaries.length,
      totalPermissions: catalog.length,
      totalOrphanedPermissions,
    },
  };
}
