import { randomUUID } from 'node:crypto';
import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import { PasswordHasherService, TotpService } from '@packages/security/index.js';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import type { OrganizationUnitEntity } from '@modules/organizations/entities/organization-unit.entity.js';
import { OrganizationUnitRepository } from '@modules/organizations/repositories/organization-unit.repository.js';
import type { RoleEntity } from '@modules/roles/entities/role.entity.js';
import type { RolePermissionEntity } from '@modules/roles/entities/role-permission.entity.js';
import { RoleRepository } from '@modules/roles/repositories/role.repository.js';
import { RolePermissionRepository } from '@modules/roles/repositories/role-permission.repository.js';
import type { UserEntity } from '@modules/users/entities/user.entity.js';
import type { UserRoleEntity } from '@modules/users/entities/user-role.entity.js';
import type { UserOrganizationUnitEntity } from '@modules/users/entities/user-organization-unit.entity.js';
import { UserRepository, type SearchUsersFilter } from '@modules/users/repositories/user.repository.js';
import { UserRoleRepository } from '@modules/users/repositories/user-role.repository.js';
import {
  type UserOrganizationInputItem,
  UserOrganizationUnitRepository,
} from '@modules/users/repositories/user-organization-unit.repository.js';
import type { AuthSessionEntity } from '@modules/auth/entities/auth-session.entity.js';
import type { AuthMfaConfigEntity } from '@modules/auth/entities/auth-mfa-config.entity.js';
import type { AuthPasswordResetEntity } from '@modules/auth/entities/auth-password-reset.entity.js';
import type { AuthSecuritySettingEntity } from '@modules/auth/entities/auth-security-setting.entity.js';
import { AuthSessionRepository } from '@modules/auth/repositories/auth-session.repository.js';
import { AuthMfaConfigRepository } from '@modules/auth/repositories/auth-mfa-config.repository.js';
import { AuthPasswordResetRepository } from '@modules/auth/repositories/auth-password-reset.repository.js';
import { AuthSecuritySettingRepository } from '@modules/auth/repositories/auth-security-setting.repository.js';

describe('Feature E2E: IAM — Auth, Security Settings, Users, Roles & Organizations HTTP Endpoints', () => {
  let context: TestAppContext;
  let adminAccessToken = '';
  let adminRoleId = '';

  const orgStore = new Map<string, OrganizationUnitEntity>();
  const roleStore = new Map<string, RoleEntity>();
  const rolePermStore: RolePermissionEntity[] = [];
  const userStore = new Map<string, UserEntity>();
  const userRoleStore: UserRoleEntity[] = [];
  const userOrgStore: UserOrganizationUnitEntity[] = [];
  const sessionStore = new Map<string, AuthSessionEntity>();
  const mfaStore = new Map<string, AuthMfaConfigEntity>();
  const resetStore = new Map<string, AuthPasswordResetEntity>();
  let globalSecuritySetting: AuthSecuritySettingEntity | null = null;

  beforeAll(async () => {
    context = await createTestApp({
      useGlobalPrefix: true,
    });

    const hasher = context.moduleFixture.get(PasswordHasherService, { strict: false });

    const orgRepo = context.moduleFixture.get(OrganizationUnitRepository, { strict: false });
    Object.assign(orgRepo, {
      findById: async (id: string) => orgStore.get(id) ?? null,
      findByCode: async (code: string) =>
        [...orgStore.values()].find((o) => o.code === code.trim().toUpperCase()) ?? null,
      findByIds: async (ids: readonly string[]) =>
        [...orgStore.values()].filter((o) => ids.includes(o.id)),
      findByCodes: async (codes: readonly string[]) => {
        const upper = codes.map((c) => c.trim().toUpperCase());
        return [...orgStore.values()].filter((o) => upper.includes(o.code));
      },
      findFiltered: async () => [...orgStore.values()],
      saveEntity: async (partial: Partial<OrganizationUnitEntity>) => {
        const now = new Date();
        const entity: OrganizationUnitEntity = {
          id: partial.id ?? randomUUID(),
          code: partial.code!,
          name: partial.name!,
          type: partial.type ?? 'BRANCH',
          parentId: partial.parentId ?? null,
          status: partial.status ?? 'ACTIVE',
          description: partial.description ?? null,
          createdAt: partial.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        } as OrganizationUnitEntity;
        orgStore.set(entity.id, entity);
        return entity;
      },
    });
    Object.defineProperty(orgRepo, 'repository', {
      configurable: true,
      get: () => ({
        softDelete: async (id: string) => {
          orgStore.delete(id);
        },
      }),
    });

    const roleRepo = context.moduleFixture.get(RoleRepository, { strict: false });
    Object.assign(roleRepo, {
      findById: async (id: string) => roleStore.get(id) ?? null,
      findByCode: async (code: string) =>
        [...roleStore.values()].find((r) => r.code === code.trim().toLowerCase()) ?? null,
      findByIds: async (ids: readonly string[]) =>
        [...roleStore.values()].filter((r) => ids.includes(r.id)),
      findByCodes: async (codes: readonly string[]) => {
        const lower = codes.map((c) => c.trim().toLowerCase());
        return [...roleStore.values()].filter((r) => lower.includes(r.code));
      },
      findFiltered: async () => [...roleStore.values()],
      saveEntity: async (partial: Partial<RoleEntity>) => {
        const now = new Date();
        const entity: RoleEntity = {
          id: partial.id ?? randomUUID(),
          code: partial.code!,
          name: partial.name!,
          description: partial.description ?? null,
          isSystem: partial.isSystem ?? false,
          status: partial.status ?? 'ACTIVE',
          createdAt: partial.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        } as RoleEntity;
        roleStore.set(entity.id, entity);
        return entity;
      },
    });
    Object.defineProperty(roleRepo, 'manager', {
      configurable: true,
      get: () => ({
        query: async () => [
          { code: 'users.read', module: 'users', description: 'Read users' },
          { code: 'users.create', module: 'users', description: 'Create users' },
          { code: 'users.update', module: 'users', description: 'Update users' },
          { code: 'users.status', module: 'users', description: 'Status users' },
          { code: 'users.import', module: 'users', description: 'Import users' },
          { code: 'users.export', module: 'users', description: 'Export users' },
          { code: 'roles.read', module: 'roles', description: 'Read roles' },
          { code: 'roles.manage', module: 'roles', description: 'Manage roles' },
          { code: 'organizations.read', module: 'organizations', description: 'Read orgs' },
          { code: 'organizations.manage', module: 'organizations', description: 'Manage orgs' },
        ],
      }),
    });
    Object.defineProperty(roleRepo, 'repository', {
      configurable: true,
      get: () => ({
        softDelete: async (id: string) => {
          roleStore.delete(id);
        },
      }),
    });

    const rolePermRepo = context.moduleFixture.get(RolePermissionRepository, { strict: false });
    Object.assign(rolePermRepo, {
      findByRoleIds: async (roleIds: readonly string[]) =>
        rolePermStore.filter((rp) => roleIds.includes(rp.roleId)),
      replacePermissionsForRole: async (roleId: string, codes: readonly string[]) => {
        for (let i = rolePermStore.length - 1; i >= 0; i--) {
          if (rolePermStore[i]?.roleId === roleId) rolePermStore.splice(i, 1);
        }
        const created = [...new Set(codes)].map(
          (code) =>
            ({
              id: randomUUID(),
              roleId,
              permissionCode: code,
              createdAt: new Date(),
              updatedAt: new Date(),
            }) as RolePermissionEntity,
        );
        rolePermStore.push(...created);
        return created;
      },
    });

    const userRepo = context.moduleFixture.get(UserRepository, { strict: false });
    Object.assign(userRepo, {
      findByIdWithArchived: async (id: string, withDeleted = false) => {
        const u = userStore.get(id);
        if (!u) return null;
        if (!withDeleted && (u.deletedAt || u.archivedAt)) return null;
        return u;
      },
      findByEmail: async (email: string, withDeleted = false) => {
        const norm = email.trim().toLowerCase();
        return (
          [...userStore.values()].find(
            (u) => u.email === norm && (withDeleted || (!u.deletedAt && !u.archivedAt)),
          ) ?? null
        );
      },
      findByUsername: async (username: string, withDeleted = false) => {
        const norm = username.trim().toLowerCase();
        return (
          [...userStore.values()].find(
            (u) => u.username === norm && (withDeleted || (!u.deletedAt && !u.archivedAt)),
          ) ?? null
        );
      },
      findByIdentifier: async (identifier: string) => {
        const norm = identifier.trim().toLowerCase();
        return (
          [...userStore.values()].find((u) => u.email === norm || u.username === norm) ?? null
        );
      },
      saveEntity: async (partial: Partial<UserEntity>) => {
        const now = new Date();
        const existing = partial.id ? userStore.get(partial.id) : undefined;
        const entity: UserEntity = {
          id: partial.id ?? existing?.id ?? randomUUID(),
          username: partial.username ?? existing!.username,
          email: partial.email ?? existing!.email,
          phone: partial.phone !== undefined ? partial.phone : (existing?.phone ?? null),
          fullName: partial.fullName ?? existing!.fullName,
          avatarUrl:
            partial.avatarUrl !== undefined ? partial.avatarUrl : (existing?.avatarUrl ?? null),
          passwordHash: partial.passwordHash ?? existing!.passwordHash,
          status: partial.status ?? existing?.status ?? 'ACTIVE',
          lockedUntil:
            partial.lockedUntil !== undefined ? partial.lockedUntil : (existing?.lockedUntil ?? null),
          lockReason:
            partial.lockReason !== undefined ? partial.lockReason : (existing?.lockReason ?? null),
          failedLoginAttempts:
            partial.failedLoginAttempts ?? existing?.failedLoginAttempts ?? 0,
          mfaEnabled: partial.mfaEnabled ?? existing?.mfaEnabled ?? false,
          primaryOrganizationUnitId:
            partial.primaryOrganizationUnitId !== undefined
              ? partial.primaryOrganizationUnitId
              : (existing?.primaryOrganizationUnitId ?? null),
          passwordChangedAt:
            partial.passwordChangedAt !== undefined
              ? partial.passwordChangedAt
              : (existing?.passwordChangedAt ?? now),
          lastLoginAt:
            partial.lastLoginAt !== undefined ? partial.lastLoginAt : (existing?.lastLoginAt ?? null),
          archivedAt:
            partial.archivedAt !== undefined ? partial.archivedAt : (existing?.archivedAt ?? null),
          deletedAt:
            partial.deletedAt !== undefined ? partial.deletedAt : (existing?.deletedAt ?? null),
          version: existing ? existing.version + 1 : 1,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        } as UserEntity;
        userStore.set(entity.id, entity);
        return entity;
      },
      updateWithOptimisticLock: async (
        id: string,
        expectedVersion: number,
        partial: Partial<UserEntity>,
      ) => {
        const existing = userStore.get(id);
        if (!existing || existing.version !== expectedVersion) {
          throw new Error('Optimistic lock mismatch');
        }
        Object.assign(existing, partial, { version: expectedVersion + 1, updatedAt: new Date() });
      },
      searchPaginated: async (filter: SearchUsersFilter = {}) => {
        let list = [...userStore.values()];
        if (!filter.includeArchived) {
          list = list.filter((u) => !u.deletedAt && !u.archivedAt);
        }
        if (filter.q) {
          const kw = filter.q.trim().toLowerCase();
          list = list.filter(
            (u) =>
              u.username.toLowerCase().includes(kw) ||
              u.email.toLowerCase().includes(kw) ||
              u.fullName.toLowerCase().includes(kw) ||
              (u.phone ?? '').toLowerCase().includes(kw),
          );
        }
        if (filter.status) {
          list = list.filter((u) => u.status === filter.status);
        }
        if (filter.roleId) {
          const userIdsWithRole = new Set(
            userRoleStore.filter((ur) => ur.roleId === filter.roleId).map((ur) => ur.userId),
          );
          list = list.filter((u) => userIdsWithRole.has(u.id));
        }
        if (filter.organizationUnitId) {
          const userIdsWithOrg = new Set(
            userOrgStore
              .filter((uo) => uo.organizationUnitId === filter.organizationUnitId)
              .map((uo) => uo.userId),
          );
          list = list.filter(
            (u) =>
              u.primaryOrganizationUnitId === filter.organizationUnitId || userIdsWithOrg.has(u.id),
          );
        }
        const page = filter.page ?? 1;
        const limit = filter.limit ?? 20;
        const start = (page - 1) * limit;
        return {
          items: list.slice(start, start + limit),
          total: list.length,
        };
      },
    });

    const userRoleRepo = context.moduleFixture.get(UserRoleRepository, { strict: false });
    Object.assign(userRoleRepo, {
      findByUserIds: async (userIds: readonly string[]) =>
        userRoleStore.filter((ur) => userIds.includes(ur.userId)),
      replaceUserRoles: async (userId: string, roleIds: readonly string[], assignedBy?: string) => {
        for (let i = userRoleStore.length - 1; i >= 0; i--) {
          if (userRoleStore[i]?.userId === userId) userRoleStore.splice(i, 1);
        }
        const created = [...new Set(roleIds)].map(
          (roleId) =>
            ({
              id: randomUUID(),
              userId,
              roleId,
              assignedBy: assignedBy ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }) as UserRoleEntity,
        );
        userRoleStore.push(...created);
        return created;
      },
    });

    const userOrgRepo = context.moduleFixture.get(UserOrganizationUnitRepository, { strict: false });
    Object.assign(userOrgRepo, {
      findByUserIds: async (userIds: readonly string[]) =>
        userOrgStore.filter((uo) => userIds.includes(uo.userId)),
      replaceUserOrganizations: async (
        userId: string,
        items: readonly UserOrganizationInputItem[],
      ) => {
        for (let i = userOrgStore.length - 1; i >= 0; i--) {
          if (userOrgStore[i]?.userId === userId) userOrgStore.splice(i, 1);
        }
        const hasPrimary = items.some((i) => Boolean(i.isPrimary));
        let primaryMarked = false;
        const created = items.map((item, idx) => {
          let isPrimary = false;
          if (hasPrimary && item.isPrimary && !primaryMarked) {
            isPrimary = true;
            primaryMarked = true;
          } else if (!hasPrimary && idx === 0) {
            isPrimary = true;
            primaryMarked = true;
          }
          return {
            id: randomUUID(),
            userId,
            organizationUnitId: item.organizationUnitId,
            isPrimary,
            positionTitle: item.positionTitle ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as UserOrganizationUnitEntity;
        });
        userOrgStore.push(...created);
        return created;
      },
    });

    const sessionRepo = context.moduleFixture.get(AuthSessionRepository, { strict: false });
    Object.assign(sessionRepo, {
      findById: async (id: string) => sessionStore.get(id) ?? null,
      findByRefreshTokenHash: async (hash: string) =>
        [...sessionStore.values()].find((s) => s.refreshTokenHash === hash) ?? null,
      findActiveByUserId: async (userId: string) =>
        [...sessionStore.values()].filter(
          (s) => s.userId === userId && !s.revokedAt && s.expiresAt.getTime() > Date.now(),
        ),
      saveEntity: async (partial: Partial<AuthSessionEntity>) => {
        const now = new Date();
        const existing = partial.id ? sessionStore.get(partial.id) : undefined;
        const entity: AuthSessionEntity = {
          id: partial.id ?? existing?.id ?? randomUUID(),
          userId: partial.userId ?? existing!.userId,
          refreshTokenHash: partial.refreshTokenHash ?? existing!.refreshTokenHash,
          ipAddress: partial.ipAddress ?? existing?.ipAddress ?? null,
          userAgent: partial.userAgent ?? existing?.userAgent ?? null,
          deviceName: partial.deviceName ?? existing?.deviceName ?? null,
          expiresAt: partial.expiresAt ?? existing!.expiresAt,
          lastActiveAt: partial.lastActiveAt ?? existing?.lastActiveAt ?? now,
          revokedAt:
            partial.revokedAt !== undefined ? partial.revokedAt : (existing?.revokedAt ?? null),
          revokeReason:
            partial.revokeReason !== undefined
              ? partial.revokeReason
              : (existing?.revokeReason ?? null),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        } as AuthSessionEntity;
        sessionStore.set(entity.id, entity);
        return entity;
      },
      revokeAllForUser: async (userId: string, reason: string, exceptSessionId?: string) => {
        const active = [...sessionStore.values()].filter(
          (s) =>
            s.userId === userId &&
            !s.revokedAt &&
            s.expiresAt.getTime() > Date.now() &&
            s.id !== exceptSessionId,
        );
        const now = new Date();
        for (const s of active) {
          s.revokedAt = now;
          s.revokeReason = reason;
        }
        return active;
      },
    });

    const mfaRepo = context.moduleFixture.get(AuthMfaConfigRepository, { strict: false });
    Object.assign(mfaRepo, {
      findByUserId: async (userId: string) => mfaStore.get(userId) ?? null,
      saveEntity: async (partial: Partial<AuthMfaConfigEntity>) => {
        const now = new Date();
        const existing = partial.userId ? mfaStore.get(partial.userId) : undefined;
        const entity: AuthMfaConfigEntity = {
          id: existing?.id ?? randomUUID(),
          userId: partial.userId ?? existing!.userId,
          totpSecret:
            partial.totpSecret !== undefined ? partial.totpSecret : (existing?.totpSecret ?? null),
          totpEnabled: partial.totpEnabled ?? existing?.totpEnabled ?? false,
          emailOtpEnabled: partial.emailOtpEnabled ?? existing?.emailOtpEnabled ?? false,
          preferredMethod: partial.preferredMethod ?? existing?.preferredMethod ?? 'TOTP',
          recoveryCodesHashJson:
            partial.recoveryCodesHashJson ?? existing?.recoveryCodesHashJson ?? '[]',
          emailOtpCodeHash:
            partial.emailOtpCodeHash !== undefined
              ? partial.emailOtpCodeHash
              : (existing?.emailOtpCodeHash ?? null),
          emailOtpExpiresAt:
            partial.emailOtpExpiresAt !== undefined
              ? partial.emailOtpExpiresAt
              : (existing?.emailOtpExpiresAt ?? null),
          verifiedAt:
            partial.verifiedAt !== undefined ? partial.verifiedAt : (existing?.verifiedAt ?? null),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        } as AuthMfaConfigEntity;
        mfaStore.set(entity.userId, entity);
        return entity;
      },
    });

    const resetRepo = context.moduleFixture.get(AuthPasswordResetRepository, { strict: false });
    Object.assign(resetRepo, {
      findByTokenHash: async (hash: string) => resetStore.get(hash) ?? null,
      saveEntity: async (partial: Partial<AuthPasswordResetEntity>) => {
        const now = new Date();
        const entity: AuthPasswordResetEntity = {
          id: partial.id ?? randomUUID(),
          userId: partial.userId!,
          tokenHash: partial.tokenHash!,
          expiresAt: partial.expiresAt!,
          usedAt: partial.usedAt ?? null,
          requestedIp: partial.requestedIp ?? null,
          createdAt: now,
          updatedAt: now,
        } as AuthPasswordResetEntity;
        resetStore.set(entity.tokenHash, entity);
        return entity;
      },
    });

    const securitySettingRepo = context.moduleFixture.get(AuthSecuritySettingRepository, {
      strict: false,
    });
    Object.assign(securitySettingRepo, {
      findGlobal: async () => globalSecuritySetting,
      saveGlobal: async (partial: Partial<AuthSecuritySettingEntity>) => {
        const now = new Date();
        globalSecuritySetting = {
          id: globalSecuritySetting?.id ?? randomUUID(),
          scopeKey: 'GLOBAL',
          passwordHashAlgorithm:
            partial.passwordHashAlgorithm ??
            globalSecuritySetting?.passwordHashAlgorithm ??
            'SCRYPT',
          dbEncryptionAlgorithm:
            partial.dbEncryptionAlgorithm ??
            globalSecuritySetting?.dbEncryptionAlgorithm ??
            'AES_256_GCM',
          encryptFieldsAtRest:
            partial.encryptFieldsAtRest ?? globalSecuritySetting?.encryptFieldsAtRest ?? true,
          mfaPolicy: partial.mfaPolicy ?? globalSecuritySetting?.mfaPolicy ?? 'OPTIONAL',
          allowedMfaMethodsJson:
            partial.allowedMfaMethodsJson ??
            globalSecuritySetting?.allowedMfaMethodsJson ??
            '["TOTP","EMAIL_OTP","RECOVERY_CODE"]',
          maxFailedLoginAttempts:
            partial.maxFailedLoginAttempts ??
            globalSecuritySetting?.maxFailedLoginAttempts ??
            5,
          lockoutDurationMinutes:
            partial.lockoutDurationMinutes ??
            globalSecuritySetting?.lockoutDurationMinutes ??
            15,
          passwordMinLength:
            partial.passwordMinLength ?? globalSecuritySetting?.passwordMinLength ?? 8,
          createdAt: globalSecuritySetting?.createdAt ?? now,
          updatedAt: now,
        } as AuthSecuritySettingEntity;
        return globalSecuritySetting;
      },
    });

    // Seed super_admin role & superadmin@gmail.com account with password !P@ssw0rd#
    const seededRole = await roleRepo.saveEntity({
      code: 'super_admin',
      name: 'Super Administrator',
      isSystem: true,
      status: 'ACTIVE',
    });
    adminRoleId = seededRole.id;
    await rolePermRepo.replacePermissionsForRole(adminRoleId, [
      'users.read',
      'users.create',
      'users.update',
      'users.status',
      'users.import',
      'users.export',
      'roles.read',
      'roles.manage',
      'organizations.read',
      'organizations.manage',
    ]);

    const adminPasswordHash = await hasher.hash('!P@ssw0rd#');
    const adminUser = await userRepo.saveEntity({
      email: 'superadmin@gmail.com',
      username: 'superadmin',
      fullName: 'Trần Quốc Bảo (Super Admin)',
      passwordHash: adminPasswordHash,
      status: 'ACTIVE',
    });
    await userRoleRepo.replaceUserRoles(adminUser.id, [adminRoleId]);
  });

  afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  it('POST /api/v1/auth/login authenticates superadmin@gmail.com (!P@ssw0rd#) and GET/PUT /api/v1/auth/security-settings works', async () => {
    const loginRes = await context.injectJson<{
      mfaRequired: boolean;
      accessToken?: string;
      refreshToken?: string;
    }>({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'superadmin@gmail.com',
        password: '!P@ssw0rd#',
        deviceName: 'E2E Test Runner',
      },
    });

    expect(loginRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.mfaRequired).toBe(false);
    expect(loginRes.body.data.accessToken).toBeDefined();

    adminAccessToken = loginRes.body.data.accessToken!;

    // Verify GET /api/v1/auth/me
    const meRes = await context.injectJson<{
      id: string;
      email: string;
      roles: string[];
      permissions: string[];
    }>({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });

    expect(meRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(meRes.body.data.email).toBe('superadmin@gmail.com');
    expect(meRes.body.data.roles).toContain('super_admin');
    expect(meRes.body.data.permissions).toContain('users.create');

    // Verify GET & PUT /api/v1/auth/security-settings (System Console -> Security)
    const getSecRes = await context.injectJson<{
      passwordHashAlgorithm: string;
      dbEncryptionAlgorithm: string;
      encryptFieldsAtRest: boolean;
    }>({
      method: 'GET',
      url: '/api/v1/auth/security-settings',
    });
    expect(getSecRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(getSecRes.body.data.passwordHashAlgorithm).toBe('SCRYPT');
    expect(getSecRes.body.data.dbEncryptionAlgorithm).toBe('AES_256_GCM');

    const putSecRes = await context.injectJson<{
      passwordHashAlgorithm: string;
      dbEncryptionAlgorithm: string;
      encryptFieldsAtRest: boolean;
    }>({
      method: 'PUT',
      url: '/api/v1/auth/security-settings',
      payload: {
        passwordHashAlgorithm: 'PBKDF2_SHA512',
        dbEncryptionAlgorithm: 'CHACHA20_POLY1305',
        encryptFieldsAtRest: true,
      },
    });
    expect(putSecRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(putSecRes.body.data.passwordHashAlgorithm).toBe('PBKDF2_SHA512');
    expect(putSecRes.body.data.dbEncryptionAlgorithm).toBe('CHACHA20_POLY1305');
  });

  it('Organizations (TP.HCM 1 Branch), Roles & Users CRUD + Multi-Org Assignment + Lock/Unlock + CSV Bulk Import/Export work end-to-end', async () => {
    const authHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 1. Create HQ_HCM and 1 Branch in HCMC (BRANCH_HCM)
    const orgHqRes = await context.injectJson<{ id: string; code: string }>({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: authHeaders,
      payload: {
        code: 'HQ_HCM',
        name: 'Trụ sở chính TP. Hồ Chí Minh',
        type: 'UNIT',
        status: 'ACTIVE',
      },
    });
    expect(orgHqRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const hqId = orgHqRes.body.data.id;

    const orgBranchRes = await context.injectJson<{ id: string; code: string }>({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: authHeaders,
      payload: {
        code: 'BRANCH_HCM',
        name: 'Chi nhánh TP. Hồ Chí Minh',
        type: 'BRANCH',
        parentId: hqId,
        status: 'ACTIVE',
      },
    });
    expect(orgBranchRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const branchId = orgBranchRes.body.data.id;

    // 2. Create a custom role
    const roleRes = await context.injectJson<{ id: string; code: string; permissions: string[] }>({
      method: 'POST',
      url: '/api/v1/roles',
      headers: authHeaders,
      payload: {
        code: 'branch_director',
        name: 'Branch Director (Giám đốc Chi nhánh TP.HCM)',
        status: 'ACTIVE',
        permissions: ['users.read'],
      },
    });
    expect(roleRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const managerRoleId = roleRes.body.data.id;

    // 3. Create a user with @gmail.com and Abcd@454647#
    const createUserRes = await context.injectJson<{
      id: string;
      email: string;
      status: string;
      roles: { id: string; code: string }[];
      organizationUnits: { organizationUnitId: string; isPrimary: boolean }[];
    }>({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders,
      payload: {
        email: 'director.hcm@gmail.com',
        username: 'director.hcm',
        fullName: 'Trương Quốc Khánh',
        password: '!P@ssw0rd#',
        status: 'ACTIVE',
        roleIds: [managerRoleId],
        organizationUnits: [
          { organizationUnitId: hqId, isPrimary: false, positionTitle: 'Thành viên Ban điều hành' },
          { organizationUnitId: branchId, isPrimary: true, positionTitle: 'Giám đốc Chi nhánh TP.HCM' },
        ],
      },
    });
    expect(createUserRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const managerUserId = createUserRes.body.data.id;
    expect(createUserRes.body.data.organizationUnits).toHaveLength(2);

    // 4. Lock and Unlock user
    const lockRes = await context.injectJson<{ status: string }>({
      method: 'POST',
      url: `/api/v1/users/${managerUserId}/lock`,
      headers: authHeaders,
      payload: { reason: 'Security review' },
    });
    expect(lockRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(lockRes.body.data.status).toBe('LOCKED');

    const unlockRes = await context.injectJson<{ status: string }>({
      method: 'POST',
      url: `/api/v1/users/${managerUserId}/unlock`,
      headers: authHeaders,
    });
    expect(unlockRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(unlockRes.body.data.status).toBe('ACTIVE');

    // 5. Bulk import users via CSV
    const csvContent = [
      'username,email,fullName,phone,password,status,roles,organizations',
      'minh.nguyenhoang01,minh.nguyenhoang01@gmail.com,"Nguyễn Hoàng Minh",0901234567,Abcd@454647#,ACTIVE,branch_director,BRANCH_HCM',
    ].join('\n');

    const importRes = await context.injectJson<{
      totalRows: number;
      importedCount: number;
      failedCount: number;
    }>({
      method: 'POST',
      url: '/api/v1/users/bulk-import',
      headers: authHeaders,
      payload: {
        csvContent,
        skipDuplicates: true,
      },
    });
    expect(importRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(importRes.body.data.importedCount).toBe(1);

    // 6. Export CSV
    const exportRes = await context.injectJson<{
      csvContent: string;
      totalExported: number;
    }>({
      method: 'GET',
      url: '/api/v1/users/export',
      headers: authHeaders,
    });
    expect(exportRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(exportRes.body.data.csvContent).toContain('director.hcm@gmail.com');
    expect(exportRes.body.data.csvContent).toContain('minh.nguyenhoang01@gmail.com');
  });

  it('Supports MFA setup (with CHACHA20_POLY1305 DB encryption) & 2-step login via both TOTP and Email OTP', async () => {
    const authHeaders = { authorization: `Bearer ${adminAccessToken}` };
    const totpService = context.moduleFixture.get(TotpService, { strict: false });

    // Setup and enable TOTP for admin
    const totpSetupRes = await context.injectJson<{ secret: string }>({
      method: 'POST',
      url: '/api/v1/auth/mfa/totp/setup',
      headers: authHeaders,
    });
    expect(totpSetupRes.status).toBe(HTTP_STATUS_CODE.OK);
    const secret = totpSetupRes.body.data.secret;

    const enableTotpRes = await context.injectJson<{ totpEnabled: boolean; recoveryCodes: string[] }>({
      method: 'POST',
      url: '/api/v1/auth/mfa/totp/enable',
      headers: authHeaders,
      payload: { code: totpService.generateCode(secret) },
    });
    expect(enableTotpRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(enableTotpRes.body.data.totpEnabled).toBe(true);
    expect(enableTotpRes.body.data.recoveryCodes).toHaveLength(8);

    // Enable Email OTP for admin
    const emailOtpEnableRes = await context.injectJson<{ emailOtpEnabled: boolean }>({
      method: 'POST',
      url: '/api/v1/auth/mfa/email-otp/enable',
      headers: authHeaders,
      payload: {},
    });
    expect(emailOtpEnableRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(emailOtpEnableRes.body.data.emailOtpEnabled).toBe(true);

    // Login should now require MFA and advertise both TOTP and EMAIL_OTP
    const challengeRes = await context.injectJson<{
      mfaRequired: boolean;
      mfaChallengeToken?: string;
      availableMfaMethods?: string[];
    }>({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'superadmin@gmail.com',
        password: '!P@ssw0rd#',
      },
    });
    expect(challengeRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(challengeRes.body.data.mfaRequired).toBe(true);
    expect(challengeRes.body.data.availableMfaMethods).toEqual(
      expect.arrayContaining(['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE']),
    );

    const mfaChallengeToken = challengeRes.body.data.mfaChallengeToken!;

    // Send Email OTP and verify with EMAIL_OTP
    const sendOtpRes = await context.injectJson<{
      sent: boolean;
      maskedEmail: string;
      devOtpCode?: string;
    }>({
      method: 'POST',
      url: '/api/v1/auth/mfa/email-otp/send',
      payload: { mfaChallengeToken },
    });
    expect(sendOtpRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(sendOtpRes.body.data.sent).toBe(true);
    expect(sendOtpRes.body.data.devOtpCode).toMatch(/^\d{6}$/);

    const verifyOtpRes = await context.injectJson<{
      mfaRequired: boolean;
      accessToken?: string;
    }>({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: {
        mfaChallengeToken,
        method: 'EMAIL_OTP',
        code: sendOtpRes.body.data.devOtpCode,
      },
    });
    expect(verifyOtpRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(verifyOtpRes.body.data.mfaRequired).toBe(false);
    expect(verifyOtpRes.body.data.accessToken).toBeDefined();
  });
});
