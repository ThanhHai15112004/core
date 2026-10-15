import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import {
  FieldEncryptionService,
  PasswordHasherService,
  TokenService,
  TotpService,
} from '@packages/security/index.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import type { OrganizationUnitEntity } from '@modules/organizations/entities/organization-unit.entity.js';
import type { OrganizationUnitRepository } from '@modules/organizations/repositories/organization-unit.repository.js';
import { OrganizationsMapper } from '@modules/organizations/mappers/organizations.mapper.js';
import { OrganizationsService } from '@modules/organizations/services/organizations.service.js';
import type { RoleEntity } from '@modules/roles/entities/role.entity.js';
import type { RolePermissionEntity } from '@modules/roles/entities/role-permission.entity.js';
import type { RoleRepository } from '@modules/roles/repositories/role.repository.js';
import type { RolePermissionRepository } from '@modules/roles/repositories/role-permission.repository.js';
import { RolesMapper } from '@modules/roles/mappers/roles.mapper.js';
import { RolesService } from '@modules/roles/services/roles.service.js';
import type { UserEntity } from '@modules/users/entities/user.entity.js';
import type { UserRoleEntity } from '@modules/users/entities/user-role.entity.js';
import type { UserOrganizationUnitEntity } from '@modules/users/entities/user-organization-unit.entity.js';
import type { UserRepository, SearchUsersFilter } from '@modules/users/repositories/user.repository.js';
import type { UserRoleRepository } from '@modules/users/repositories/user-role.repository.js';
import type {
  UserOrganizationInputItem,
  UserOrganizationUnitRepository,
} from '@modules/users/repositories/user-organization-unit.repository.js';
import { UsersMapper } from '@modules/users/mappers/users.mapper.js';
import { UsersService } from '@modules/users/services/users.service.js';
import { UserImportExportService } from '@modules/users/services/user-import-export.service.js';
import type { AuthSessionEntity } from '@modules/auth/entities/auth-session.entity.js';
import type { AuthMfaConfigEntity } from '@modules/auth/entities/auth-mfa-config.entity.js';
import type { AuthPasswordResetEntity } from '@modules/auth/entities/auth-password-reset.entity.js';
import type { AuthSecuritySettingEntity } from '@modules/auth/entities/auth-security-setting.entity.js';
import type { AuthSessionRepository } from '@modules/auth/repositories/auth-session.repository.js';
import type { AuthMfaConfigRepository } from '@modules/auth/repositories/auth-mfa-config.repository.js';
import type { AuthPasswordResetRepository } from '@modules/auth/repositories/auth-password-reset.repository.js';
import type { AuthSecuritySettingRepository } from '@modules/auth/repositories/auth-security-setting.repository.js';
import { SessionService } from '@modules/auth/services/session.service.js';
import { PasswordService } from '@modules/auth/services/password.service.js';
import { MfaService } from '@modules/auth/services/mfa.service.js';
import { SecuritySettingsService } from '@modules/auth/services/security-settings.service.js';
import { AuthService } from '@modules/auth/services/auth.service.js';

/** Tạo bộ lưu trữ in-memory mô phỏng đầy đủ hành vi của các Repository phục vụ kiểm thử toàn bộ nghiệp vụ 3 & 3.1 */
function createIamInMemoryHarness() {
  applyTestEnv();
  const config = new CoreConfigService();
  const passwordHasher = new PasswordHasherService();
  const fieldEncryption = new FieldEncryptionService(config);
  const totpService = new TotpService();
  const tokenService = new TokenService(config);

  const orgStore = new Map<string, OrganizationUnitEntity>();
  const roleStore = new Map<string, RoleEntity>();
  const rolePermStore: RolePermissionEntity[] = [];
  const userStore = new Map<string, UserEntity>();
  const userRoleStore: UserRoleEntity[] = [];
  const userOrgStore: UserOrganizationUnitEntity[] = [];
  const sessionStore = new Map<string, AuthSessionEntity>();
  const mfaStore = new Map<string, AuthMfaConfigEntity>();
  const resetStore = new Map<string, AuthPasswordResetEntity>();

  const orgRepo = {
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
    repository: {
      softDelete: async (id: string) => {
        orgStore.delete(id);
      },
    },
  } as unknown as OrganizationUnitRepository;

  const roleRepo = {
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
    manager: {
      query: async () => [
        { code: 'users.read', module: 'users', description: 'Read users' },
        { code: 'users.create', module: 'users', description: 'Create users' },
      ],
    },
    repository: {
      softDelete: async (id: string) => {
        roleStore.delete(id);
      },
    },
  } as unknown as RoleRepository;

  const rolePermRepo = {
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
  } as unknown as RolePermissionRepository;

  const userRepo = {
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
  } as unknown as UserRepository;

  const userRoleRepo = {
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
  } as unknown as UserRoleRepository;

  const userOrgRepo = {
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
  } as unknown as UserOrganizationUnitRepository;

  const sessionRepo = {
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
  } as unknown as AuthSessionRepository;

  const mfaRepo = {
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
  } as unknown as AuthMfaConfigRepository;

  const resetRepo = {
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
  } as unknown as AuthPasswordResetRepository;

  let globalSecuritySetting: AuthSecuritySettingEntity | null = null;
  const securitySettingRepo = {
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
  } as unknown as AuthSecuritySettingRepository;

  const organizationsService = new OrganizationsService(orgRepo, new OrganizationsMapper());
  const rolesService = new RolesService(roleRepo, rolePermRepo, new RolesMapper());
  const usersService = new UsersService(
    userRepo,
    userRoleRepo,
    userOrgRepo,
    new UsersMapper(),
    passwordHasher,
    rolesService,
    organizationsService,
  );
  const importExportService = new UserImportExportService(
    usersService,
    userRepo,
    rolesService,
    organizationsService,
  );
  const sessionService = new SessionService(sessionRepo, tokenService, passwordHasher, config);
  const passwordService = new PasswordService(
    resetRepo,
    passwordHasher,
    sessionService,
    usersService,
    config,
  );
  const securitySettingsService = new SecuritySettingsService(securitySettingRepo);
  const mfaService = new MfaService(
    mfaRepo,
    totpService,
    passwordHasher,
    usersService,
    config,
    fieldEncryption,
  );
  const authService = new AuthService(
    passwordHasher,
    tokenService,
    sessionService,
    mfaService,
    usersService,
    securitySettingsService,
  );

  return {
    mfaStore,
    fieldEncryption,
    securitySettingsService,
    totpService,
    organizationsService,
    rolesService,
    usersService,
    importExportService,
    sessionService,
    passwordService,
    mfaService,
    authService,
  };
}

describe('Unit: Quản lý Người dùng (3.1) & Xác thực / Phiên / MFA (3)', () => {
  let h: ReturnType<typeof createIamInMemoryHarness>;

  beforeEach(() => {
    h = createIamInMemoryHarness();
  });

  it('3.1.1 -> 3.1.6 & 3.1.10: Tạo mới, cập nhật, gán nhiều đơn vị/chi nhánh, gán vai trò, khóa/mở khóa, vô hiệu hóa/lưu trữ người dùng', async () => {
    // 1. Tạo 2 đơn vị chi nhánh (Trụ sở & Chi nhánh HCM) và 2 vai trò
    const hq = await h.organizationsService.create({
      code: 'HQ',
      name: 'Trụ sở chính',
      type: 'UNIT',
      status: 'ACTIVE',
    });
    const hcmBranch = await h.organizationsService.create({
      code: 'BR_HCM',
      name: 'Chi nhánh TP.HCM',
      type: 'BRANCH',
      parentId: hq.id,
      status: 'ACTIVE',
    });

    const adminRole = await h.rolesService.create({
      code: 'admin',
      name: 'Administrator',
      status: 'ACTIVE',
      permissions: ['users.read', 'users.create', 'users.update', 'users.status'],
    });
    const managerRole = await h.rolesService.create({
      code: 'manager',
      name: 'Branch Manager',
      status: 'ACTIVE',
      permissions: ['users.read'],
    });

    // 2. Tạo mới người dùng (3.1.1) gắn với vai trò và đơn vị
    const createdUser = await h.usersService.create({
      username: 'nguyenvana',
      email: 'vana@core.local',
      fullName: 'Nguyễn Văn A',
      phone: '0901234567',
      password: 'Password@123',
      status: 'ACTIVE',
      roleIds: [managerRole.id],
      organizationUnits: [
        { organizationUnitId: hq.id, isPrimary: true, positionTitle: 'Trưởng phòng' },
      ],
    });

    expect(createdUser.username).toBe('nguyenvana');
    expect(createdUser.status).toBe('ACTIVE');
    expect(createdUser.roles).toHaveLength(1);
    expect(createdUser.roles[0]?.code).toBe('manager');
    expect(createdUser.primaryOrganizationUnitId).toBe(hq.id);

    // 3. Cập nhật thông tin người dùng (3.1.2)
    const updatedUser = await h.usersService.update(createdUser.id, {
      fullName: 'Nguyễn Văn A (Updated)',
      phone: '0988888888',
    });
    expect(updatedUser.fullName).toBe('Nguyễn Văn A (Updated)');
    expect(updatedUser.phone).toBe('0988888888');

    // 4. Gán vai trò cho người dùng (3.1.5)
    const roleAssigned = await h.usersService.assignRoles(createdUser.id, {
      roleIds: [adminRole.id, managerRole.id],
    });
    expect(roleAssigned.roles.map((r) => r.code).sort()).toEqual(['admin', 'manager']);

    // 5. Gán người dùng vào NHIỀU đơn vị/chi nhánh (3.1.6)
    const orgAssigned = await h.usersService.assignOrganizations(createdUser.id, {
      organizationUnits: [
        { organizationUnitId: hq.id, isPrimary: false, positionTitle: 'Cố vấn' },
        { organizationUnitId: hcmBranch.id, isPrimary: true, positionTitle: 'Giám đốc chi nhánh' },
      ],
    });
    expect(orgAssigned.organizationUnits).toHaveLength(2);
    expect(orgAssigned.primaryOrganizationUnitId).toBe(hcmBranch.id);

    // 6. Khóa và mở khóa tài khoản (3.1.3 & 3.1.10)
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const lockedUser = await h.usersService.lockUser(createdUser.id, {
      reason: 'Kiểm tra an ninh định kỳ',
      lockedUntil: futureDate,
    });
    expect(lockedUser.status).toBe('LOCKED');
    expect(lockedUser.lockReason).toBe('Kiểm tra an ninh định kỳ');

    const unlockedUser = await h.usersService.unlockUser(createdUser.id);
    expect(unlockedUser.status).toBe('ACTIVE');
    expect(unlockedUser.lockReason).toBeNull();

    // 7. Vô hiệu hóa, Lưu trữ (Archive) và Khôi phục người dùng (3.1.4 & 3.1.10)
    const deactivated = await h.usersService.deactivateUser(createdUser.id, 'Nghỉ phép dài hạn');
    expect(deactivated.status).toBe('INACTIVE');

    const archived = await h.usersService.archiveUser(createdUser.id);
    expect(archived.isArchived).toBe(true);
    expect(archived.status).toBe('INACTIVE');

    // Khi đã lưu trữ, tìm kiếm mặc định (includeArchived = false) không trả về
    const defaultSearch = await h.usersService.listPaginated({
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
    expect(defaultSearch.data).toHaveLength(0);

    // Khôi phục người dùng đã lưu trữ
    const restored = await h.usersService.restoreUser(createdUser.id);
    expect(restored.isArchived).toBe(false);
    const activeAgain = await h.usersService.activateUser(createdUser.id);
    expect(activeAgain.status).toBe('ACTIVE');
  });

  it('3.1.7, 3.1.8 & 3.1.9: Nhập người dùng hàng loạt từ CSV, Tìm kiếm/Lọc đa tiêu chí và Xuất CSV', async () => {
    const branchHn = await h.organizationsService.create({
      code: 'BR_HN',
      name: 'Chi nhánh Hà Nội',
      type: 'BRANCH',
      status: 'ACTIVE',
    });
    const staffRole = await h.rolesService.create({
      code: 'staff',
      name: 'Staff',
      status: 'ACTIVE',
      permissions: ['users.read'],
    });

    const csvInput = [
      'username,email,fullName,phone,password,status,roles,organizations',
      'tranvanb,tranvanb@core.local,"Trần Văn B",0911111111,Pass@12345,ACTIVE,staff,BR_HN',
      'lethic,lethic@core.local,"Lê Thị C",0922222222,Pass@12345,INACTIVE,staff,BR_HN',
      'tranvanb,tranvanb@core.local,"Trùng lặp",0911111111,Pass@12345,ACTIVE,staff,BR_HN',
    ].join('\n');

    const importResult = await h.importExportService.bulkImport({
      csvContent: csvInput,
      skipDuplicates: true,
    });

    expect(importResult.totalRows).toBe(3);
    expect(importResult.importedCount).toBe(2);
    expect(importResult.skippedCount).toBe(1);
    expect(importResult.failedCount).toBe(0);

    // Tìm kiếm theo từ khóa q + lọc theo đơn vị & vai trò (3.1.9)
    const searchRes = await h.usersService.listPaginated({
      q: 'Trần Văn B',
      roleId: staffRole.id,
      organizationUnitId: branchHn.id,
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
    expect(searchRes.data).toHaveLength(1);
    expect(searchRes.data[0]?.username).toBe('tranvanb');

    // Lọc theo trạng thái INACTIVE
    const inactiveRes = await h.usersService.listPaginated({
      status: 'INACTIVE',
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
    expect(inactiveRes.data).toHaveLength(1);
    expect(inactiveRes.data[0]?.username).toBe('lethic');

    // Xuất danh sách người dùng ra CSV (3.1.8)
    const exported = await h.importExportService.exportUsersCsv({
      page: 1,
      limit: 100,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
    expect(exported.totalExported).toBe(2);
    expect(exported.csvContent).toContain('tranvanb@core.local');
    expect(exported.csvContent).toContain('lethic@core.local');
  });

  it('Mục 3: Đăng nhập, chống Brute-Force (khóa tự động), Phiên đăng nhập, Đổi/Quên mật khẩu & MFA (TOTP + Email OTP + Recovery Codes)', async () => {
    const user = await h.usersService.create({
      username: 'secuser',
      email: 'secuser@core.local',
      fullName: 'Security User',
      password: 'InitialPassword@123',
      status: 'ACTIVE',
      roleIds: [],
      organizationUnits: [],
    });

    // 1. Đăng nhập thành công khi chưa bật MFA
    const login1 = await h.authService.login(
      { identifier: 'secuser', password: 'InitialPassword@123', deviceName: 'Chrome on Linux' },
      { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
    );
    expect(login1.mfaRequired).toBe(false);
    expect(login1.accessToken).toBeDefined();
    expect(login1.refreshToken).toBeDefined();
    expect(login1.sessionId).toBeDefined();

    // 2. Làm mới phiên đăng nhập (Refresh Token Rotation)
    const refreshed = await h.authService.refresh({ refreshToken: login1.refreshToken! });
    expect(refreshed.accessToken).toBeDefined();
    expect(refreshed.refreshToken).toBeDefined();

    // Dùng lại Refresh Token cũ đã xoay vòng -> bị từ chối và thu hồi phiên
    await expect(
      h.authService.refresh({ refreshToken: login1.refreshToken! }),
    ).rejects.toThrow();

    // 3. Bật xác thực 2 lớp bằng TOTP (Google Authenticator) & xác minh totpSecret được mã hóa AEAD xuống DB
    const totpSetup = await h.mfaService.setupTotp(user.id);
    const storedMfaEntity = h.mfaStore.get(user.id);
    expect(storedMfaEntity?.totpSecret?.startsWith('enc:v1:AES_256_GCM:')).toBe(true);
    expect(h.fieldEncryption.decrypt(storedMfaEntity!.totpSecret!)).toBe(totpSetup.secret);

    const validTotpCode = h.totpService.generateCode(totpSetup.secret);
    const totpEnabled = await h.mfaService.enableTotp(user.id, { code: validTotpCode });
    expect(totpEnabled.mfaEnabled).toBe(true);
    expect(totpEnabled.totpEnabled).toBe(true);
    expect(totpEnabled.recoveryCodes).toHaveLength(8);

    // 4. Bật thêm phương thức Email OTP
    await h.mfaService.enableEmailOtp(user.id, {});
    const mfaStatus = await h.mfaService.getStatus(user.id);
    expect(mfaStatus.totpEnabled).toBe(true);
    expect(mfaStatus.emailOtpEnabled).toBe(true);

    // 5. Khi đăng nhập lại -> hệ thống yêu cầu bước 2 MFA
    const loginChallenge = await h.authService.login({
      identifier: 'secuser@core.local',
      password: 'InitialPassword@123',
    });
    expect(loginChallenge.mfaRequired).toBe(true);
    expect(loginChallenge.mfaChallengeToken).toBeDefined();
    expect(loginChallenge.availableMfaMethods).toEqual(
      expect.arrayContaining(['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE']),
    );

    // 5a. Xác thực MFA bằng Email OTP (6 số)
    const sentOtp = await h.authService.sendMfaEmailOtp({
      mfaChallengeToken: loginChallenge.mfaChallengeToken!,
    });
    expect(sentOtp.sent).toBe(true);
    expect(sentOtp.devOtpCode).toMatch(/^\d{6}$/);

    const verifiedViaEmailOtp = await h.authService.verifyMfaChallenge({
      mfaChallengeToken: loginChallenge.mfaChallengeToken!,
      code: sentOtp.devOtpCode!,
      method: 'EMAIL_OTP',
    });
    expect(verifiedViaEmailOtp.mfaRequired).toBe(false);
    expect(verifiedViaEmailOtp.accessToken).toBeDefined();

    // 5b. Xác thực MFA bằng Recovery Code dự phòng
    const recoveryCode = totpEnabled.recoveryCodes[0]!;
    const verifiedViaRecovery = await h.authService.verifyMfaChallenge({
      mfaChallengeToken: loginChallenge.mfaChallengeToken!,
      code: recoveryCode,
      method: 'RECOVERY_CODE',
    });
    expect(verifiedViaRecovery.mfaRequired).toBe(false);

    // Dùng lại cùng 1 Recovery Code lần 2 -> bị từ chối
    await expect(
      h.authService.verifyMfaChallenge({
        mfaChallengeToken: loginChallenge.mfaChallengeToken!,
        code: recoveryCode,
        method: 'RECOVERY_CODE',
      }),
    ).rejects.toThrow();

    // 6. Quên mật khẩu & Đặt lại mật khẩu (Forgot & Reset Password)
    const forgotRes = await h.passwordService.requestPasswordReset({
      email: 'secuser@core.local',
    });
    expect(forgotRes.accepted).toBe(true);
    expect(forgotRes.devResetToken).toBeDefined();

    const resetRes = await h.passwordService.resetPassword({
      token: forgotRes.devResetToken!,
      newPassword: 'ResetPassword@2026',
    });
    expect(resetRes.reset).toBe(true);

    // 7. Nhập sai mật khẩu 5 lần liên tiếp -> tự động khóa tài khoản (LOCKED)
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(
        h.authService.login({
          identifier: 'secuser',
          password: 'WrongPassword!!!',
        }),
      ).rejects.toThrow();
    }
    const afterBruteForce = await h.usersService.getById(user.id);
    expect(afterBruteForce.status).toBe('LOCKED');
    expect(afterBruteForce.failedLoginAttempts).toBe(5);
  });
});
