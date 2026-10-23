import {
  ConflictAppException,
  ForbiddenAppException,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import {
  DATA_SCOPE,
  PERMISSION_STATUS,
  ROLE_STATUS,
  RolesMapper,
  RolesService,
  assertDataScopeAllAllowedForRole,
  buildDeclaredPermissionsMap,
  buildOrphanedPermissionWarnings,
  buildRolePermissionMatrix,
  derivePermissionFeatureGroup,
  extractModuleFromPermissionCode,
  formatPermissionDisplayName,
  groupPermissionCatalogItems,
  mapPermissionsToCatalogItems,
  matchesWildcardPattern,
} from '@modules/roles/index.js';
import type { PermissionEntity } from '@modules/roles/entities/permission.entity.js';
import type { RoleEntity } from '@modules/roles/entities/role.entity.js';
import type { PermissionRepository } from '@modules/roles/repositories/permission.repository.js';
import type { RoleRepository } from '@modules/roles/repositories/role.repository.js';
import type { RolePermissionRepository } from '@modules/roles/repositories/role-permission.repository.js';

function createMockRole(overrides: Partial<RoleEntity> & { id: number; code: string }): RoleEntity {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: overrides.id,
    code: overrides.code,
    name: overrides.name ?? overrides.code.toUpperCase(),
    description: overrides.description ?? null,
    isSystem: overrides.isSystem ?? false,
    dataScope: overrides.dataScope ?? DATA_SCOPE.SELF,
    status: overrides.status ?? ROLE_STATUS.ACTIVE,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
  } as RoleEntity;
}

function createMockPermission(
  overrides: Partial<PermissionEntity> & { id: number; code: string },
): PermissionEntity {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: overrides.id,
    code: overrides.code,
    name: overrides.name ?? formatPermissionDisplayName(overrides.code),
    module: overrides.module ?? extractModuleFromPermissionCode(overrides.code),
    description: overrides.description ?? null,
    status: overrides.status ?? PERMISSION_STATUS.ACTIVE,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  } as PermissionEntity;
}

describe('Roles Module — Helpers & RolesService Unit Suite', () => {
  describe('role-permission-catalog.helper', () => {
    it('extracts module and featureGroup and formats display names accurately', () => {
      expect(extractModuleFromPermissionCode('users.read')).toBe('users');
      expect(extractModuleFromPermissionCode('global_access')).toBe('core');
      expect(derivePermissionFeatureGroup('auth.sessions.manage', 'auth')).toBe('auth.sessions');
      expect(derivePermissionFeatureGroup('roles.read', 'roles')).toBe('roles');
      expect(formatPermissionDisplayName('roles.audit_logs.read')).toBe('Roles Audit Logs Read');
    });

    it('builds declared permissions map, catalog items, grouped permissions, orphans and matrix', () => {
      const activeModules = new Map([
        [
          'roles',
          {
            module: 'roles',
            displayName: 'Roles & Permissions',
            permissions: [
              'roles.read',
              {
                code: 'roles.manage',
                name: 'Manage Roles',
                featureGroup: 'roles.admin',
                description: 'Full role management',
              },
            ],
          },
        ],
      ]);

      const declaredMap = buildDeclaredPermissionsMap(activeModules);
      expect(declaredMap.size).toBe(2);
      expect(declaredMap.get('roles.manage')?.featureGroup).toBe('roles.admin');

      const perms: PermissionEntity[] = [
        createMockPermission({ id: 1, code: 'roles.read', module: 'roles' }),
        createMockPermission({ id: 2, code: 'roles.manage', module: 'roles' }),
        createMockPermission({ id: 3, code: 'legacy.orphan.perm', module: 'legacy' }),
      ];

      const catalog = mapPermissionsToCatalogItems(perms, declaredMap);
      expect(catalog).toHaveLength(3);
      expect(catalog.find((c) => c.code === 'legacy.orphan.perm')?.isOrphaned).toBe(true);

      const grouped = groupPermissionCatalogItems(catalog, activeModules);
      expect(grouped.length).toBeGreaterThanOrEqual(2);

      const adminRole = createMockRole({
        id: 10,
        code: 'admin',
        name: 'Administrator',
        isSystem: true,
        dataScope: DATA_SCOPE.ALL,
      });
      const permsMap = new Map<number, PermissionEntity[]>([[10, [perms[0]!, perms[2]!]]]);

      const orphans = buildOrphanedPermissionWarnings([perms[2]!], [adminRole], permsMap);
      expect(orphans).toHaveLength(1);
      expect(orphans[0]?.assignedRoles).toHaveLength(1);
      expect(orphans[0]?.assignedRoles[0]?.code).toBe('admin');

      const mapper = new RolesMapper();
      const matrix = buildRolePermissionMatrix([adminRole], catalog, permsMap, (r, p) =>
        mapper.toSummary(r, p),
      );
      expect(matrix.summary.totalRoles).toBe(1);
      expect(matrix.summary.totalPermissions).toBe(3);
      expect(matrix.summary.totalOrphanedPermissions).toBe(1);
      expect(matrix.rows.find((r) => r.code === 'roles.read')?.roleGrants['admin']).toBe(true);
      expect(matrix.rows.find((r) => r.code === 'roles.manage')?.roleGrants['admin']).toBe(false);
    });
  });

  describe('role-data-scope.helper', () => {
    it('matches wildcard patterns and enforces DATA_SCOPE.ALL guard', () => {
      expect(matchesWildcardPattern('admin_finance', ['admin_*', 'root'])).toBe(true);
      expect(matchesWildcardPattern('staff_member', ['admin_*', 'root'])).toBe(false);

      // Allowed via role code pattern
      expect(() =>
        assertDataScopeAllAllowedForRole({
          roleCode: 'admin_regional',
          dataScope: DATA_SCOPE.ALL,
          permissionCodes: ['users.read'],
          settingRegistry: defaultSettingRegistry,
        }),
      ).not.toThrow();

      // Allowed via system-wide permission
      expect(() =>
        assertDataScopeAllAllowedForRole({
          roleCode: 'custom_auditor_role',
          dataScope: DATA_SCOPE.ALL,
          permissionCodes: ['roles.manage'],
          settingRegistry: defaultSettingRegistry,
        }),
      ).not.toThrow();

      // Forbidden when non-privileged role requests DATA_SCOPE.ALL
      expect(() =>
        assertDataScopeAllAllowedForRole({
          roleCode: 'regular_teacher',
          dataScope: DATA_SCOPE.ALL,
          permissionCodes: ['courses.read'],
          settingRegistry: defaultSettingRegistry,
        }),
      ).toThrow(ForbiddenAppException);
    });
  });

  describe('RolesService', () => {
    it('supports role creation, cloning, system role protection and assigned user deletion guard', async () => {
      const rolesStore = new Map<number, RoleEntity>([
        [
          1,
          createMockRole({
            id: 1,
            code: 'super_admin',
            name: 'Super Admin',
            isSystem: true,
            dataScope: DATA_SCOPE.ALL,
          }),
        ],
      ]);
      const permsStore = new Map<number, PermissionEntity>([
        [101, createMockPermission({ id: 101, code: 'roles.read', module: 'roles' })],
        [102, createMockPermission({ id: 102, code: 'roles.manage', module: 'roles' })],
      ]);
      const rolePermsStore = new Map<number, number[]>([[1, [101, 102]]]);
      let nextRoleId = 2;

      const mockRoleRepo = {
        findFiltered: async () => [...rolesStore.values()],
        findById: async (id: number) => rolesStore.get(Number(id)) ?? null,
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => rolesStore.get(Number(id))).filter((r): r is RoleEntity => Boolean(r)),
        findByCode: async (code: string) =>
          [...rolesStore.values()].find((r) => r.code === code) ?? null,
        findByCodes: async (codes: readonly string[]) =>
          [...rolesStore.values()].filter((r) => codes.includes(r.code)),
        saveEntity: async (data: Partial<RoleEntity>) => {
          const id = data.id ? Number(data.id) : nextRoleId++;
          const entity = createMockRole({
            ...data,
            id,
            code: data.code ?? `role_${id}`,
          });
          rolesStore.set(id, entity);
          return entity;
        },
        repository: {
          softDelete: async (id: number) => {
            rolesStore.delete(Number(id));
          },
        },
      } as unknown as RoleRepository;

      const mockRolePermRepo = {
        findByRoleIds: async (roleIds: readonly number[]) => {
          const result: { roleId: number; permissionId: number }[] = [];
          for (const rId of roleIds) {
            for (const pId of rolePermsStore.get(Number(rId)) ?? []) {
              result.push({ roleId: Number(rId), permissionId: pId });
            }
          }
          return result;
        },
        replacePermissionsForRole: async (roleId: number, permissionIds: readonly number[]) => {
          rolePermsStore.set(Number(roleId), [...permissionIds]);
        },
      } as unknown as RolePermissionRepository;

      const mockPermRepo = {
        findAll: async () => [...permsStore.values()],
        findByIds: async (ids: readonly number[]) =>
          ids
            .map((id) => permsStore.get(Number(id)))
            .filter((p): p is PermissionEntity => Boolean(p)),
        ensurePermissionsByCodes: async (codes: readonly string[]) =>
          [...permsStore.values()].filter((p) => codes.includes(p.code)),
      } as unknown as PermissionRepository;

      const service = new RolesService(
        mockRoleRepo,
        mockRolePermRepo,
        new RolesMapper(),
        mockPermRepo,
      );

      // Register user count delegate: role #2 will have 3 users once created
      const userCounts = new Map<number, number>();
      service.registerRoleUserCountDelegate(async () => userCounts);

      // 1. Create custom role with ORG_UNIT scope
      const created = await service.create({
        code: 'branch_manager',
        name: 'Branch Manager',
        dataScope: DATA_SCOPE.ORG_UNIT,
        permissionIds: [101],
      });
      expect(created.code).toBe('branch_manager');
      expect(created.dataScopeName).toBe('ORG_UNIT');
      expect(created.permissions).toEqual(['roles.read']);

      // 2. Clone role
      const cloned = await service.clone(created.id, {
        code: 'deputy_branch_manager',
        name: 'Deputy Branch Manager',
      });
      expect(cloned.code).toBe('deputy_branch_manager');
      expect(cloned.dataScope).toBe(DATA_SCOPE.ORG_UNIT);
      expect(cloned.permissions).toEqual(['roles.read']);

      // 3. Cannot deactivate or delete system role
      await expect(service.update(1, { status: ROLE_STATUS.INACTIVE })).rejects.toThrow(
        ForbiddenAppException,
      );
      await expect(service.remove(1)).rejects.toThrow(ForbiddenAppException);

      // 4. Cannot delete custom role while users are assigned
      userCounts.set(created.id, 3);
      await expect(service.remove(created.id)).rejects.toThrow(ConflictAppException);

      // 5. Can delete custom role with 0 assigned users
      const deleted = await service.remove(cloned.id);
      expect(deleted).toEqual({ deleted: true, id: cloned.id });
    });
  });
});
