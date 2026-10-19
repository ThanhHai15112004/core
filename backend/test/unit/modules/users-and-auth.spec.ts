import { describe, it, expect, beforeEach } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import {
  FieldEncryptionService,
  PasswordHasherService,
  TokenService,
  TotpService,
} from '@packages/security/index.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import {
  ORGANIZATION_UNIT_STATUS,
  ORGANIZATION_UNIT_TYPE,
} from '@modules/organizations/contracts/index.js';
import type { OrganizationUnitEntity } from '@modules/organizations/entities/organization-unit.entity.js';
import type { OrganizationUnitRepository } from '@modules/organizations/repositories/organization-unit.repository.js';
import { OrganizationsMapper } from '@modules/organizations/mappers/organizations.mapper.js';
import { OrganizationsService } from '@modules/organizations/services/organizations.service.js';
import { PERMISSION_STATUS, ROLE_STATUS } from '@modules/roles/contracts/index.js';
import type { PermissionEntity } from '@modules/roles/entities/permission.entity.js';
import type { RoleEntity } from '@modules/roles/entities/role.entity.js';
import type { RolePermissionEntity } from '@modules/roles/entities/role-permission.entity.js';
import type { PermissionRepository } from '@modules/roles/repositories/permission.repository.js';
import type { RoleRepository } from '@modules/roles/repositories/role.repository.js';
import type { RolePermissionRepository } from '@modules/roles/repositories/role-permission.repository.js';
import { RolesMapper } from '@modules/roles/mappers/roles.mapper.js';
import { RolesService } from '@modules/roles/services/roles.service.js';
import { USER_STATUS, normalizePhoneNumber } from '@modules/users/contracts/index.js';
import type { UserEntity } from '@modules/users/entities/user.entity.js';
import type { UserProfileEntity } from '@modules/users/entities/user-profile.entity.js';
import type { UserRoleEntity } from '@modules/users/entities/user-role.entity.js';
import type { UserOrganizationUnitEntity } from '@modules/users/entities/user-organization-unit.entity.js';
import type { UserStatusHistoryEntity } from '@modules/users/entities/user-status-history.entity.js';
import type {
  UserRepository,
  SearchUsersFilter,
} from '@modules/users/repositories/user.repository.js';
import type { UserProfileRepository } from '@modules/users/repositories/user-profile.repository.js';
import type { UserRoleRepository } from '@modules/users/repositories/user-role.repository.js';
import type {
  UserOrganizationInputItem,
  UserOrganizationUnitRepository,
} from '@modules/users/repositories/user-organization-unit.repository.js';
import type { UserStatusHistoryRepository } from '@modules/users/repositories/user-status-history.repository.js';
import { UsersMapper } from '@modules/users/mappers/users.mapper.js';
import { UsersService } from '@modules/users/services/users.service.js';
import { UserImportService } from '@modules/users/import/index.js';
import { UserExportService } from '@modules/users/export/index.js';
import {
  API_CLIENT_STATUS,
  DB_ENCRYPTION_ALGO_CODE,
  MFA_METHOD,
  MFA_POLICY_CODE,
  PASSWORD_HASH_ALGO_CODE,
  SERVICE_ACCOUNT_STATUS,
} from '@modules/auth/contracts/index.js';
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
import {
  DefaultEmailNotificationAdapter,
  DefaultSmsOtpProvider,
} from '@modules/auth/services/notification-adapters.provider.js';
import { SecuritySettingsService } from '@modules/auth/services/security-settings.service.js';
import { VerificationService } from '@modules/auth/services/verification.service.js';
import { ServiceAccountService } from '@modules/auth/services/service-account.service.js';
import { UserIdentityResolverService } from '@modules/auth/services/user-identity-resolver.service.js';
import { AuthService } from '@modules/auth/services/auth.service.js';

/** Tạo bộ lưu trữ in-memory với ID số nguyên tăng dần (1, 2, 3...) và bảng permissions + user_profiles độc lập */
function createIamInMemoryHarness() {
  applyTestEnv();
  const config = new CoreConfigService();
  const passwordHasher = new PasswordHasherService();
  const fieldEncryption = new FieldEncryptionService(config);
  const totpService = new TotpService();
  const tokenService = new TokenService(config);

  let orgSeq = 0;
  let permSeq = 0;
  let roleSeq = 0;
  let rolePermSeq = 0;
  let userSeq = 0;
  let userProfileSeq = 0;
  let userRoleSeq = 0;
  let userOrgSeq = 0;
  let historySeq = 0;
  let sessionSeq = 0;
  let mfaSeq = 0;
  let resetSeq = 0;

  const orgStore = new Map<number, OrganizationUnitEntity>();
  const permStore = new Map<number, PermissionEntity>();
  const roleStore = new Map<number, RoleEntity>();
  const rolePermStore: RolePermissionEntity[] = [];
  const userStore = new Map<number, UserEntity>();
  const userProfileStore = new Map<number, UserProfileEntity>();
  const userRoleStore: UserRoleEntity[] = [];
  const userOrgStore: UserOrganizationUnitEntity[] = [];
  const statusHistoryStore: UserStatusHistoryEntity[] = [];
  const sessionStore = new Map<number, AuthSessionEntity>();
  const mfaStore = new Map<number, AuthMfaConfigEntity>();
  const resetStore = new Map<string, AuthPasswordResetEntity>();

  const orgRepo = {
    findById: async (id: number) => orgStore.get(Number(id)) ?? null,
    findByCode: async (code: string) =>
      [...orgStore.values()].find((o) => o.code === code.trim().toUpperCase()) ?? null,
    findByIds: async (ids: readonly number[]) => {
      const set = new Set(ids.map(Number));
      return [...orgStore.values()].filter((o) => set.has(o.id));
    },
    findByCodes: async (codes: readonly string[]) => {
      const upper = codes.map((c) => c.trim().toUpperCase());
      return [...orgStore.values()].filter((o) => upper.includes(o.code));
    },
    findFiltered: async () => [...orgStore.values()],
    saveEntity: async (partial: Partial<OrganizationUnitEntity>) => {
      const now = new Date();
      const entity: OrganizationUnitEntity = {
        id: partial.id ?? ++orgSeq,
        code: partial.code!,
        name: partial.name!,
        type: partial.type ?? ORGANIZATION_UNIT_TYPE.BRANCH,
        parentId: partial.parentId ?? null,
        status: partial.status ?? ORGANIZATION_UNIT_STATUS.ACTIVE,
        description: partial.description ?? null,
        createdAt: partial.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      } as OrganizationUnitEntity;
      orgStore.set(entity.id, entity);
      return entity;
    },
    repository: {
      softDelete: async (id: number) => {
        orgStore.delete(Number(id));
      },
    },
  } as unknown as OrganizationUnitRepository;

  const ensureByCodesFn = async (codes: readonly string[]) => {
    const uniqueCodes = [...new Set(codes.map((c) => c.trim().toLowerCase()).filter(Boolean))];
    const result: PermissionEntity[] = [];
    for (const code of uniqueCodes) {
      let found = [...permStore.values()].find((p) => p.code === code);
      if (!found) {
        const now = new Date();
        found = {
          id: ++permSeq,
          code,
          name: code,
          module: code.split('.')[0] ?? 'core',
          description: `Permission ${code}`,
          status: PERMISSION_STATUS.ACTIVE,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        } as PermissionEntity;
        permStore.set(found.id, found);
      }
      result.push(found);
    }
    return result;
  };

  const permRepo = {
    findAll: async () => [...permStore.values()].sort((a, b) => a.id - b.id),
    findAllOrdered: async () => [...permStore.values()].sort((a, b) => a.id - b.id),
    findByIds: async (ids: readonly number[]) => {
      const set = new Set(ids.map(Number));
      return [...permStore.values()].filter((p) => set.has(p.id));
    },
    findByCodes: async (codes: readonly string[]) => {
      const lower = codes.map((c) => c.trim().toLowerCase());
      return [...permStore.values()].filter((p) => lower.includes(p.code));
    },
    ensureByCodes: ensureByCodesFn,
    ensurePermissionsByCodes: ensureByCodesFn,
  } as unknown as PermissionRepository;

  const roleRepo = {
    findById: async (id: number) => roleStore.get(Number(id)) ?? null,
    findByCode: async (code: string) =>
      [...roleStore.values()].find((r) => r.code === code.trim().toLowerCase()) ?? null,
    findByIds: async (ids: readonly number[]) => {
      const set = new Set(ids.map(Number));
      return [...roleStore.values()].filter((r) => set.has(r.id));
    },
    findByCodes: async (codes: readonly string[]) => {
      const lower = codes.map((c) => c.trim().toLowerCase());
      return [...roleStore.values()].filter((r) => lower.includes(r.code));
    },
    findFiltered: async () => [...roleStore.values()],
    saveEntity: async (partial: Partial<RoleEntity>) => {
      const now = new Date();
      const entity: RoleEntity = {
        id: partial.id ?? ++roleSeq,
        code: partial.code!,
        name: partial.name!,
        description: partial.description ?? null,
        isSystem: partial.isSystem ?? false,
        status: partial.status ?? ROLE_STATUS.ACTIVE,
        createdAt: partial.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      } as RoleEntity;
      roleStore.set(entity.id, entity);
      return entity;
    },
    repository: {
      softDelete: async (id: number) => {
        roleStore.delete(Number(id));
      },
    },
  } as unknown as RoleRepository;

  const rolePermRepo = {
    findByRoleIds: async (roleIds: readonly number[]) => {
      const set = new Set(roleIds.map(Number));
      return rolePermStore.filter((rp) => set.has(rp.roleId));
    },
    replacePermissionsForRole: async (roleId: number, permissionIds: readonly number[]) => {
      for (let i = rolePermStore.length - 1; i >= 0; i--) {
        if (rolePermStore[i]?.roleId === roleId) rolePermStore.splice(i, 1);
      }
      const created = [...new Set(permissionIds.map(Number))].map(
        (permissionId) =>
          ({
            id: ++rolePermSeq,
            roleId,
            permissionId,
            createdAt: new Date(),
            updatedAt: new Date(),
          }) as RolePermissionEntity,
      );
      rolePermStore.push(...created);
      return created;
    },
  } as unknown as RolePermissionRepository;

  const userProfileRepo = {
    findByUserId: async (userId: number) => userProfileStore.get(Number(userId)) ?? null,
    findByUserIds: async (userIds: readonly number[]) => {
      const set = new Set(userIds.map(Number));
      return [...userProfileStore.values()].filter((p) => set.has(p.userId));
    },
    upsertByUserId: async (userId: number, partial: Partial<UserProfileEntity>) => {
      const now = new Date();
      const existing = userProfileStore.get(Number(userId));
      const entity = {
        id: existing?.id ?? ++userProfileSeq,
        userId: Number(userId),
        firstName: partial.firstName ?? existing?.firstName ?? '',
        lastName: partial.lastName ?? existing?.lastName ?? '',
        fullName: partial.fullName ?? existing?.fullName ?? '',
        avatarUrl:
          partial.avatarUrl !== undefined ? partial.avatarUrl : (existing?.avatarUrl ?? null),
        dateOfBirth:
          partial.dateOfBirth !== undefined
            ? partial.dateOfBirth
            : (existing?.dateOfBirth ?? null),
        gender: partial.gender !== undefined ? partial.gender : (existing?.gender ?? null),
        identityNumber:
          partial.identityNumber !== undefined
            ? partial.identityNumber
            : (existing?.identityNumber ?? null),
        address: partial.address !== undefined ? partial.address : (existing?.address ?? null),
        city: partial.city !== undefined ? partial.city : (existing?.city ?? null),
        country: partial.country !== undefined ? partial.country : (existing?.country ?? null),
        bio: partial.bio !== undefined ? partial.bio : (existing?.bio ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      } as unknown as UserProfileEntity;
      userProfileStore.set(Number(userId), entity);
      return entity;
    },
  } as unknown as UserProfileRepository;

  const userRepo = {
    findByIdWithArchived: async (id: number, withDeleted = false) => {
      const u = userStore.get(Number(id));
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
    findByPhoneHash: async (phoneHash: string, withDeleted = false) => {
      return (
        [...userStore.values()].find(
          (u) => u.phoneHash === phoneHash && (withDeleted || (!u.deletedAt && !u.archivedAt)),
        ) ?? null
      );
    },
    findByIdentifier: async (identifier: string, phoneHash?: string | null) => {
      const norm = identifier.trim().toLowerCase();
      return (
        [...userStore.values()].find(
          (u) =>
            u.email === norm ||
            u.username === norm ||
            (phoneHash && u.phoneHash === phoneHash) ||
            u.phone === identifier.trim(),
        ) ?? null
      );
    },
    saveEntity: async (partial: Partial<UserEntity>) => {
      const now = new Date();
      const existing = partial.id ? userStore.get(Number(partial.id)) : undefined;
      const entity = {
        id: partial.id ?? existing?.id ?? ++userSeq,
        username: partial.username ?? existing!.username,
        email: partial.email ?? existing!.email,
        phone: partial.phone !== undefined ? partial.phone : (existing?.phone ?? null),
        phoneHash:
          partial.phoneHash !== undefined ? partial.phoneHash : (existing?.phoneHash ?? null),
        passwordHash: partial.passwordHash ?? existing!.passwordHash,
        passwordHistoryHashesJson:
          partial.passwordHistoryHashesJson ?? existing?.passwordHistoryHashesJson ?? '[]',
        status: partial.status ?? existing?.status ?? USER_STATUS.ACTIVE,
        emailVerifiedAt:
          partial.emailVerifiedAt !== undefined
            ? partial.emailVerifiedAt
            : (existing?.emailVerifiedAt ?? null),
        phoneVerifiedAt:
          partial.phoneVerifiedAt !== undefined
            ? partial.phoneVerifiedAt
            : (existing?.phoneVerifiedAt ?? null),
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
      } as unknown as UserEntity;
      userStore.set(entity.id, entity);
      return entity;
    },
    updateWithOptimisticLock: async (
      id: number,
      expectedVersion: number,
      partial: Partial<UserEntity>,
    ) => {
      const existing = userStore.get(Number(id));
      if (!existing || existing.version !== expectedVersion) {
        throw new Error('Optimistic lock mismatch');
      }
      Object.assign(existing, partial, { version: expectedVersion + 1, updatedAt: new Date() });
    },
    searchPaginated: async (filter: SearchUsersFilter = {}) => {
      let list = [...userStore.values()];
      if (!filter.includeArchived) {
        list = list.filter(
          (u) => !u.deletedAt && !u.archivedAt && u.status !== USER_STATUS.ARCHIVED,
        );
      }
      if (filter.q) {
        const kw = filter.q.trim().toLowerCase();
        const normPhone = normalizePhoneNumber(kw);
        const kwPhoneHash = normPhone ? passwordHasher.sha256(normPhone) : null;
        list = list.filter((u) => {
          const prof = userProfileStore.get(u.id);
          return (
            u.username.toLowerCase().includes(kw) ||
            u.email.toLowerCase().includes(kw) ||
            (prof?.firstName ?? '').toLowerCase().includes(kw) ||
            (prof?.lastName ?? '').toLowerCase().includes(kw) ||
            (prof?.fullName ?? '').toLowerCase().includes(kw) ||
            (u.phone ?? '').toLowerCase().includes(kw) ||
            (kwPhoneHash && u.phoneHash === kwPhoneHash)
          );
        });
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
    findByUserIds: async (userIds: readonly number[]) => {
      const set = new Set(userIds.map(Number));
      return userRoleStore.filter((ur) => set.has(ur.userId));
    },
    replaceUserRoles: async (userId: number, roleIds: readonly number[], assignedBy?: number) => {
      for (let i = userRoleStore.length - 1; i >= 0; i--) {
        if (userRoleStore[i]?.userId === userId) userRoleStore.splice(i, 1);
      }
      const created = [...new Set(roleIds.map(Number))].map(
        (roleId) =>
          ({
            id: ++userRoleSeq,
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
    findByUserIds: async (userIds: readonly number[]) => {
      const set = new Set(userIds.map(Number));
      return userOrgStore.filter((uo) => set.has(uo.userId));
    },
    replaceUserOrganizations: async (
      userId: number,
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
          id: ++userOrgSeq,
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

  const userStatusHistoryRepo = {
    recordTransition: async (params: {
      userId: number;
      fromStatus: number | null;
      toStatus: number;
      reason?: string | null;
      changedBy?: number | null;
    }) => {
      const now = new Date();
      const entry = {
        id: ++historySeq,
        userId: params.userId,
        fromStatus: params.fromStatus,
        toStatus: params.toStatus,
        reason: params.reason ?? null,
        changedBy: params.changedBy ?? null,
        createdAt: now,
        updatedAt: now,
      } as UserStatusHistoryEntity;
      statusHistoryStore.push(entry);
      return entry;
    },
    findByUserId: async (userId: number) =>
      statusHistoryStore
        .filter((h) => h.userId === Number(userId))
        .sort((a, b) => b.id - a.id),
  } as unknown as UserStatusHistoryRepository;

  const sessionRepo = {
    findById: async (id: number) => sessionStore.get(Number(id)) ?? null,
    findByRefreshTokenHash: async (hash: string) =>
      [...sessionStore.values()].find((s) => s.refreshTokenHash === hash) ?? null,
    findActiveByUserId: async (userId: number) =>
      [...sessionStore.values()].filter(
        (s) => s.userId === Number(userId) && !s.revokedAt && s.expiresAt.getTime() > Date.now(),
      ),
    saveEntity: async (partial: Partial<AuthSessionEntity>) => {
      const now = new Date();
      const existing = partial.id ? sessionStore.get(Number(partial.id)) : undefined;
      const entity: AuthSessionEntity = {
        id: partial.id ?? existing?.id ?? ++sessionSeq,
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
    revokeAllForUser: async (userId: number, reason: string, exceptSessionId?: number) => {
      const active = [...sessionStore.values()].filter(
        (s) =>
          s.userId === Number(userId) &&
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
    findByUserId: async (userId: number) => mfaStore.get(Number(userId)) ?? null,
    saveEntity: async (partial: Partial<AuthMfaConfigEntity>) => {
      const now = new Date();
      const existing = partial.userId ? mfaStore.get(Number(partial.userId)) : undefined;
      const entity: AuthMfaConfigEntity = {
        id: existing?.id ?? ++mfaSeq,
        userId: partial.userId ?? existing!.userId,
        totpSecret:
          partial.totpSecret !== undefined ? partial.totpSecret : (existing?.totpSecret ?? null),
        totpEnabled: partial.totpEnabled ?? existing?.totpEnabled ?? false,
        emailOtpEnabled: partial.emailOtpEnabled ?? existing?.emailOtpEnabled ?? false,
        preferredMethod: partial.preferredMethod ?? existing?.preferredMethod ?? MFA_METHOD.TOTP,
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
        emailOtpFailedAttempts:
          partial.emailOtpFailedAttempts ?? existing?.emailOtpFailedAttempts ?? 0,
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
    findByOtpCodeHash: async (otpHash: string) =>
      [...resetStore.values()]
        .sort((a, b) => b.id - a.id)
        .find((r) => r.otpCodeHash === otpHash) ?? null,
    findLatestByUserId: async (userId: number) =>
      [...resetStore.values()]
        .filter((r) => r.userId === Number(userId))
        .sort((a, b) => b.id - a.id)[0] ?? null,
    saveEntity: async (partial: Partial<AuthPasswordResetEntity>) => {
      const now = new Date();
      const existing = partial.tokenHash ? resetStore.get(partial.tokenHash) : undefined;
      const entity: AuthPasswordResetEntity = {
        id: partial.id ?? existing?.id ?? ++resetSeq,
        userId: partial.userId ?? existing!.userId,
        tokenHash: partial.tokenHash ?? existing!.tokenHash,
        otpCodeHash:
          partial.otpCodeHash !== undefined
            ? partial.otpCodeHash
            : (existing?.otpCodeHash ?? null),
        attemptCount: partial.attemptCount ?? existing?.attemptCount ?? 0,
        maxAttempts: partial.maxAttempts ?? existing?.maxAttempts ?? 5,
        expiresAt: partial.expiresAt ?? existing!.expiresAt,
        usedAt: partial.usedAt !== undefined ? partial.usedAt : (existing?.usedAt ?? null),
        requestedIp:
          partial.requestedIp !== undefined
            ? partial.requestedIp
            : (existing?.requestedIp ?? null),
        createdAt: existing?.createdAt ?? now,
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
        id: globalSecuritySetting?.id ?? 1,
        scopeKey: 'GLOBAL',
        passwordHashAlgorithm:
          partial.passwordHashAlgorithm ??
          globalSecuritySetting?.passwordHashAlgorithm ??
          PASSWORD_HASH_ALGO_CODE.SCRYPT,
        dbEncryptionAlgorithm:
          partial.dbEncryptionAlgorithm ??
          globalSecuritySetting?.dbEncryptionAlgorithm ??
          DB_ENCRYPTION_ALGO_CODE.AES_256_GCM,
        encryptFieldsAtRest:
          partial.encryptFieldsAtRest ?? globalSecuritySetting?.encryptFieldsAtRest ?? true,
        mfaPolicy:
          partial.mfaPolicy ??
          globalSecuritySetting?.mfaPolicy ??
          MFA_POLICY_CODE.OPTIONAL,
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
        requireUppercase:
          partial.requireUppercase ?? globalSecuritySetting?.requireUppercase ?? true,
        requireNumbers:
          partial.requireNumbers ?? globalSecuritySetting?.requireNumbers ?? true,
        requireSpecialChars:
          partial.requireSpecialChars ?? globalSecuritySetting?.requireSpecialChars ?? false,
        requireCurrentPasswordOnChange:
          partial.requireCurrentPasswordOnChange ??
          globalSecuritySetting?.requireCurrentPasswordOnChange ??
          true,
        disallowedPasswordsJson:
          partial.disallowedPasswordsJson ??
          globalSecuritySetting?.disallowedPasswordsJson ??
          '["password","12345678","123456789","1234567890","qwerty123","admin123","welcome123","letmein123","iloveyou","abcd1234"]',
        disallowUserInfoInPassword:
          partial.disallowUserInfoInPassword ??
          globalSecuritySetting?.disallowUserInfoInPassword ??
          true,
        preventPasswordReuse:
          partial.preventPasswordReuse ??
          globalSecuritySetting?.preventPasswordReuse ??
          true,
        passwordHistoryLimit:
          partial.passwordHistoryLimit ??
          globalSecuritySetting?.passwordHistoryLimit ??
          5,
        revokeSessionsOnPasswordChange:
          partial.revokeSessionsOnPasswordChange ??
          globalSecuritySetting?.revokeSessionsOnPasswordChange ??
          true,
        allowEmailRegistration:
          partial.allowEmailRegistration ?? globalSecuritySetting?.allowEmailRegistration ?? true,
        allowPhoneRegistration:
          partial.allowPhoneRegistration ?? globalSecuritySetting?.allowPhoneRegistration ?? true,
        requireEmailVerification:
          partial.requireEmailVerification ??
          globalSecuritySetting?.requireEmailVerification ??
          false,
        requirePhoneVerification:
          partial.requirePhoneVerification ??
          globalSecuritySetting?.requirePhoneVerification ??
          false,
        otpMaxSendCount:
          partial.otpMaxSendCount ?? globalSecuritySetting?.otpMaxSendCount ?? 5,
        otpMaxAttempts:
          partial.otpMaxAttempts ?? globalSecuritySetting?.otpMaxAttempts ?? 5,
        otpCooldownSeconds:
          partial.otpCooldownSeconds ?? globalSecuritySetting?.otpCooldownSeconds ?? 60,
        sessionIdleTimeoutMinutes:
          partial.sessionIdleTimeoutMinutes ??
          globalSecuritySetting?.sessionIdleTimeoutMinutes ??
          30,
        sessionMaxLifetimeMinutes:
          partial.sessionMaxLifetimeMinutes ??
          globalSecuritySetting?.sessionMaxLifetimeMinutes ??
          10080,
        enableLoginAuditLog:
          partial.enableLoginAuditLog ?? globalSecuritySetting?.enableLoginAuditLog ?? true,
        createdAt: globalSecuritySetting?.createdAt ?? now,
        updatedAt: now,
      } as AuthSecuritySettingEntity;
      return globalSecuritySetting;
    },
  } as unknown as AuthSecuritySettingRepository;

  const organizationsService = new OrganizationsService(orgRepo, new OrganizationsMapper());
  const rolesService = new RolesService(roleRepo, rolePermRepo, new RolesMapper(), permRepo);
  const usersService = new UsersService(
    userRepo,
    userRoleRepo,
    userOrgRepo,
    new UsersMapper(),
    passwordHasher,
    rolesService,
    organizationsService,
    userStatusHistoryRepo,
    fieldEncryption,
    null,
    null,
    userProfileRepo,
  );
  const importService = new UserImportService(
    usersService,
    userRepo,
    rolesService,
    organizationsService,
  );
  const exportService = new UserExportService(usersService, userRepo);
  const emailAdapter = new DefaultEmailNotificationAdapter();
  const smsProvider = new DefaultSmsOtpProvider();
  const sessionService = new SessionService(sessionRepo, tokenService, passwordHasher, config);
  const securitySettingsService = new SecuritySettingsService(securitySettingRepo);
  const passwordService = new PasswordService(
    resetRepo,
    passwordHasher,
    sessionService,
    usersService,
    config,
    securitySettingsService,
    emailAdapter,
  );
  const mfaService = new MfaService(
    mfaRepo,
    totpService,
    passwordHasher,
    usersService,
    config,
    fieldEncryption,
    emailAdapter,
    smsProvider,
  );
  const verificationService = new VerificationService(
    passwordHasher,
    usersService,
    undefined,
    securitySettingsService,
    config,
    emailAdapter,
    smsProvider,
  );
  const serviceAccountService = new ServiceAccountService(passwordHasher, tokenService);
  const identityResolver = new UserIdentityResolverService(
    sessionService,
    usersService,
    serviceAccountService,
    tokenService,
  );
  const authService = new AuthService(
    passwordHasher,
    tokenService,
    sessionService,
    mfaService,
    usersService,
    securitySettingsService,
    verificationService,
  );

  usersService.registerAdminRevokeSessionsDelegate((userId, reason) =>
    sessionService.revokeAllUserSessions(userId, reason),
  );
  usersService.registerUserLoginHistoryDelegate((userId, limit) =>
    sessionService.listUserLoginHistory(userId, limit),
  );

  return {
    userStore,
    userProfileStore,
    sessionStore,
    mfaStore,
    permStore,
    fieldEncryption,
    emailAdapter,
    smsProvider,
    securitySettingsService,
    totpService,
    tokenService,
    organizationsService,
    rolesService,
    usersService,
    importService,
    exportService,
    sessionService,
    passwordService,
    mfaService,
    verificationService,
    serviceAccountService,
    identityResolver,
    authService,
  };
}

describe('Unit: Quản lý Người dùng (3.1) & Xác thực / Phiên / MFA (3) — Integer ID & Status STT', () => {
  let h: ReturnType<typeof createIamInMemoryHarness>;

  beforeEach(() => {
    h = createIamInMemoryHarness();
  });

  it('3.1.1 -> 3.1.6 & 3.1.10: Tạo mới (firstName + lastName + ID số nguyên), cập nhật, gán nhiều đơn vị/chi nhánh, gán vai trò (bảng permissions riêng), khóa/mở khóa, vô hiệu hóa/lưu trữ và lưu lịch sử trạng thái', async () => {
    // 1. Tạo 2 đơn vị chi nhánh (ID 1 & 2) và 2 vai trò (ID 1 & 2)
    const hq = await h.organizationsService.create({
      code: 'HQ_HCM',
      name: 'Trụ sở chính TP.HCM',
      type: ORGANIZATION_UNIT_TYPE.HEADQUARTERS,
      status: ORGANIZATION_UNIT_STATUS.ACTIVE,
    });
    expect(hq.id).toBe(1);
    expect(hq.type).toBe(1);
    expect(hq.status).toBe(1);

    const hcmBranch = await h.organizationsService.create({
      code: 'BR_HCM',
      name: 'Chi nhánh TP.HCM',
      type: ORGANIZATION_UNIT_TYPE.BRANCH,
      parentId: hq.id,
      status: ORGANIZATION_UNIT_STATUS.ACTIVE,
    });
    expect(hcmBranch.id).toBe(2);

    const adminRole = await h.rolesService.create({
      code: 'admin',
      name: 'Administrator',
      status: ROLE_STATUS.ACTIVE,
      permissions: ['users.read', 'users.create', 'users.update', 'users.status'],
    });
    expect(adminRole.id).toBe(1);
    expect(adminRole.status).toBe(1);
    expect(h.permStore.size).toBe(4);

    const managerRole = await h.rolesService.create({
      code: 'manager',
      name: 'Branch Manager',
      status: ROLE_STATUS.ACTIVE,
      permissions: ['users.read'],
    });
    expect(managerRole.id).toBe(2);

    // 2. Tạo mới người dùng (3.1.1) với firstName, lastName, ID = 1, status = 1 (ACTIVE)
    const createdUser = await h.usersService.create({
      username: 'nguyenvana',
      email: 'vana@gmail.com',
      firstName: 'An',
      lastName: 'Nguyễn Văn',
      phone: '0901234567',
      password: 'Password@123',
      status: USER_STATUS.ACTIVE,
      roleIds: [managerRole.id],
      organizationUnits: [
        { organizationUnitId: hq.id, isPrimary: true, positionTitle: 'Trưởng phòng' },
      ],
    });

    expect(createdUser.id).toBe(1);
    expect(createdUser.username).toBe('nguyenvana');
    expect(createdUser.firstName).toBe('An');
    expect(createdUser.lastName).toBe('Nguyễn Văn');
    expect(createdUser.fullName).toBe('Nguyễn Văn An');
    expect(createdUser.status).toBe(USER_STATUS.ACTIVE);
    expect(createdUser.statusName).toBe('ACTIVE');
    expect(createdUser.roles).toHaveLength(1);
    expect(createdUser.roles[0]?.code).toBe('manager');
    expect(createdUser.primaryOrganizationUnitId).toBe(hq.id);

    // 3. Cập nhật thông tin người dùng (3.1.2)
    const updatedUser = await h.usersService.update(createdUser.id, {
      firstName: 'Bảo',
      lastName: 'Nguyễn Văn',
      phone: '0988888888',
    });
    expect(updatedUser.firstName).toBe('Bảo');
    expect(updatedUser.fullName).toBe('Nguyễn Văn Bảo');
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

    // 6. Khóa và mở khóa tài khoản (3.1.3 & 3.1.10) -> status = 3 (LOCKED) rồi 1 (ACTIVE)
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const lockedUser = await h.usersService.lockUser(createdUser.id, {
      reason: 'Kiểm tra an ninh định kỳ',
      lockedUntil: futureDate,
    });
    expect(lockedUser.status).toBe(USER_STATUS.LOCKED);
    expect(lockedUser.statusName).toBe('LOCKED');
    expect(lockedUser.lockReason).toBe('Kiểm tra an ninh định kỳ');

    const unlockedUser = await h.usersService.unlockUser(createdUser.id);
    expect(unlockedUser.status).toBe(USER_STATUS.ACTIVE);
    expect(unlockedUser.lockReason).toBeNull();

    // 7. Vô hiệu hóa (2 = INACTIVE), Lưu trữ (4 = ARCHIVED) và Khôi phục người dùng (3.1.4 & 3.1.10)
    const deactivated = await h.usersService.deactivateUser(createdUser.id, 'Nghỉ phép dài hạn');
    expect(deactivated.status).toBe(USER_STATUS.INACTIVE);

    const archived = await h.usersService.archiveUser(createdUser.id);
    expect(archived.isArchived).toBe(true);
    expect(archived.status).toBe(USER_STATUS.ARCHIVED);

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
    expect(activeAgain.status).toBe(USER_STATUS.ACTIVE);

    // Kiểm tra lịch sử thay đổi trạng thái (3.1.10)
    const statusHistory = await h.usersService.getStatusHistory(createdUser.id);
    expect(statusHistory.length).toBeGreaterThanOrEqual(5);
  });

  it('3.1.7, 3.1.8 & 3.1.9: Nhập người dùng hàng loạt từ CSV, Tìm kiếm/Lọc đa tiêu chí và Xuất CSV', async () => {
    const branchHcm = await h.organizationsService.create({
      code: 'BRANCH_HCM',
      name: 'Chi nhánh TP.HCM',
      type: ORGANIZATION_UNIT_TYPE.BRANCH,
      status: ORGANIZATION_UNIT_STATUS.ACTIVE,
    });
    const staffRole = await h.rolesService.create({
      code: 'staff',
      name: 'Staff',
      status: ROLE_STATUS.ACTIVE,
      permissions: ['users.read'],
    });

    const csvInput = [
      'username,email,firstName,lastName,fullName,phone,password,status,roles,organizations',
      'tranvanb,tranvanb@gmail.com,Bình,"Trần Văn","Trần Văn Bình",0911111111,Abcd@454647#,1,staff,BRANCH_HCM',
      'lethic,lethic@gmail.com,Châu,"Lê Thị","Lê Thị Châu",0922222222,Abcd@454647#,2,staff,BRANCH_HCM',
      'tranvanb,tranvanb@gmail.com,Bình,"Trần Văn","Trùng lặp",0911111111,Abcd@454647#,1,staff,BRANCH_HCM',
    ].join('\n');

    const importResult = await h.importService.bulkImport({
      csvContent: csvInput,
      skipDuplicates: true,
    });

    expect(importResult.totalRows).toBe(3);
    expect(importResult.importedCount).toBe(2);
    expect(importResult.skippedCount).toBe(1);
    expect(importResult.failedCount).toBe(0);

    // Tìm kiếm theo từ khóa q + lọc theo đơn vị & vai trò (3.1.9)
    const searchRes = await h.usersService.listPaginated({
      q: 'Trần Văn Bình',
      roleId: staffRole.id,
      organizationUnitId: branchHcm.id,
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
    expect(searchRes.data).toHaveLength(1);
    expect(searchRes.data[0]?.username).toBe('tranvanb');
    expect(searchRes.data[0]?.firstName).toBe('Bình');
    expect(searchRes.data[0]?.lastName).toBe('Trần Văn');

    // Lọc theo trạng thái 2 (INACTIVE)
    const inactiveRes = await h.usersService.listPaginated({
      status: USER_STATUS.INACTIVE,
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
    expect(inactiveRes.data).toHaveLength(1);
    expect(inactiveRes.data[0]?.username).toBe('lethic');

    // Xuất danh sách người dùng ra Excel (.xlsx) & CSV (3.1.8)
    const exported = await h.exportService.exportUsersCsv({
      page: 1,
      limit: 100,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
      format: 'xlsx',
    });
    expect(exported.totalExported).toBe(2);
    expect(exported.fileName).toMatch(/^danh_sach_nhan_vien_.*\.xlsx$/);
    expect(exported.csvContent).toContain('tranvanb@gmail.com');
    expect(exported.csvContent).toContain('lethic@gmail.com');
    expect(exported.xlsxBase64.length).toBeGreaterThan(100);

    // Xuất file mẫu Import (.xlsx) và kiểm tra import ngược từ file Excel có dòng tiêu đề + ngày xuất ở trên
    const templateRes = h.exportService.exportImportTemplate('xlsx');
    expect(templateRes.fileName).toBe('mau_import_nhan_vien.xlsx');
    expect(templateRes.totalExported).toBe(3);

    const importFromTemplate = await h.importService.bulkImport({
      xlsxBase64: templateRes.xlsxBase64,
      skipDuplicates: true,
    });
    expect(importFromTemplate.importedCount).toBe(3);
    expect(importFromTemplate.failedCount).toBe(0);

    // Import lại chính file báo cáo danh_sach_nhan_vien.xlsx (có dòng 1 Tiêu đề, dòng 2 Ngày xuất, dòng 3 Header)
    const reimportReport = await h.importService.bulkImport({
      xlsxBase64: exported.xlsxBase64,
      skipDuplicates: true,
    });
    expect(reimportReport.totalRows).toBe(2);
    expect(reimportReport.skippedCount).toBe(2);
    expect(reimportReport.failedCount).toBe(0);
  });

  it('Mục 3: Đăng nhập, chống Brute-Force (khóa tự động), Phiên đăng nhập (ID số nguyên), Đổi/Quên mật khẩu & MFA (TOTP + Email OTP + Recovery Codes)', async () => {
    const user = await h.usersService.create({
      username: 'secuser',
      email: 'secuser@gmail.com',
      firstName: 'Sơn',
      lastName: 'Nguyễn Thái',
      password: '!P@ssw0rd#',
      status: USER_STATUS.ACTIVE,
      roleIds: [],
      organizationUnits: [],
    });

    // 1. Đăng nhập thành công khi chưa bật MFA
    const login1 = await h.authService.login(
      { identifier: 'secuser', password: '!P@ssw0rd#', deviceName: 'Chrome on Linux' },
      { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
    );
    expect(login1.mfaRequired).toBe(false);
    expect(login1.accessToken).toBeDefined();
    expect(login1.refreshToken).toBeDefined();
    expect(login1.sessionId).toBe(1);

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
      identifier: 'secuser@gmail.com',
      password: '!P@ssw0rd#',
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
      email: 'secuser@gmail.com',
    });
    expect(forgotRes.accepted).toBe(true);
    expect(forgotRes.devResetToken).toBeDefined();

    const resetRes = await h.passwordService.resetPassword({
      token: forgotRes.devResetToken!,
      newPassword: 'ResetPassword@2026',
    });
    expect(resetRes.reset).toBe(true);

    // 7. Nhập sai mật khẩu 5 lần liên tiếp -> tự động khóa tài khoản (status = 3 LOCKED)
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(
        h.authService.login({
          identifier: 'secuser',
          password: 'WrongPassword!!!',
        }),
      ).rejects.toThrow();
    }
    const afterBruteForce = await h.usersService.getById(user.id);
    expect(afterBruteForce.status).toBe(USER_STATUS.LOCKED);
    expect(afterBruteForce.failedLoginAttempts).toBe(5);
  });

  it('Mục 3.2 & Tách bảng users (Core) / user_profiles (Chi tiết): Đăng ký Email/SĐT (bật/tắt theo dự án), Đăng nhập bằng SĐT, Đăng xuất tất cả thiết bị, Xác minh Email & Xác minh SĐT bằng OTP (giới hạn gửi & nhập sai)', async () => {
    // 1. Đăng ký bằng Email + mật khẩu (3.2.1) và kiểm tra dữ liệu lưu tách bạch giữa users (Core) và user_profiles
    const regEmail = await h.authService.register(
      {
        email: 'member.email@gmail.com',
        password: 'Password@123',
        firstName: 'Hương',
        lastName: 'Trần Thị',
        city: 'Hồ Chí Minh',
        country: 'Vietnam',
        bio: 'Product Designer',
        deviceName: 'MacBook Pro',
      },
      { ipAddress: '10.0.0.10', userAgent: 'Safari/17.0' },
    );
    expect(regEmail.registered).toBe(true);
    expect(regEmail.verificationRequired).toBe(false);
    expect(regEmail.accessToken).toBeDefined();
    expect(regEmail.user.email).toBe('member.email@gmail.com');
    expect(regEmail.user.firstName).toBe('Hương');
    expect(regEmail.user.lastName).toBe('Trần Thị');
    expect(regEmail.user.fullName).toBe('Trần Thị Hương');
    expect(regEmail.user.profile?.city).toBe('Hồ Chí Minh');
    expect(regEmail.user.profile?.bio).toBe('Product Designer');

    // Xác minh bảng users chỉ chứa trường Core và bảng user_profiles chứa trường cá nhân
    const coreEntity = h.userStore.get(regEmail.user.id);
    const profileEntity = h.userProfileStore.get(regEmail.user.id);
    expect(coreEntity).toBeDefined();
    expect('firstName' in (coreEntity as unknown as Record<string, unknown>)).toBe(false);
    expect(profileEntity?.firstName).toBe('Hương');
    expect(profileEntity?.city).toBe('Hồ Chí Minh');

    // 2. Bật/tắt đăng ký bằng Email hoặc SĐT theo dự án (3.2.1 & 3.2.2)
    await h.securitySettingsService.updateSettings({
      allowEmailRegistration: false,
      allowPhoneRegistration: true,
      otpCooldownSeconds: 0,
      otpMaxSendCount: 2,
      otpMaxAttempts: 3,
    });

    await expect(
      h.authService.register({
        email: 'blocked@gmail.com',
        password: 'Password@123',
      }),
    ).rejects.toThrow();

    // 3. Đăng ký bằng SĐT + mật khẩu (3.2.2) khi allowPhoneRegistration = true
    const regPhone = await h.authService.register(
      {
        phone: '+84 912 345 678',
        password: 'Password@123',
        firstName: 'Khang',
        lastName: 'Lê Minh',
        deviceName: 'iPhone 15',
      },
      { ipAddress: '10.0.0.20', userAgent: 'MobileSafari' },
    );
    expect(regPhone.registered).toBe(true);
    expect(regPhone.user.phone).toBe('0912345678');
    expect(regPhone.user.fullName).toBe('Lê Minh Khang');

    // Khi tắt allowPhoneRegistration -> từ chối đăng ký bằng SĐT
    await h.securitySettingsService.updateSettings({
      allowPhoneRegistration: false,
    });
    await expect(
      h.authService.register({
        phone: '0987654321',
        password: 'Password@123',
      }),
    ).rejects.toThrow();

    // 4. Đăng nhập bằng SĐT (3.2.3) với nhiều định dạng (+84 / 0...) và không tiết lộ tài khoản tồn tại
    const loginByPhone = await h.authService.login(
      {
        identifier: '0912345678',
        password: 'Password@123',
        deviceName: 'iPad Pro',
      },
      { ipAddress: '10.0.0.21', userAgent: 'iPadOS' },
    );
    expect(loginByPhone.mfaRequired).toBe(false);
    expect(loginByPhone.accessToken).toBeDefined();
    expect(loginByPhone.user?.id).toBe(regPhone.user.id);

    // 5. Đăng xuất khỏi tất cả thiết bị (3.2.5)
    const activeBefore = await h.sessionService.listUserSessions(regPhone.user.id);
    expect(activeBefore).toHaveLength(2);
    const revokedAll = await h.authService.revokeAllUserSessions(
      regPhone.user.id,
      'Logout all devices',
    );
    expect(revokedAll).toBe(2);
    const activeAfter = await h.sessionService.listUserSessions(regPhone.user.id);
    expect(activeAfter).toHaveLength(0);

    // 6. Xác minh Email có thời hạn bằng mã hoặc link token (3.2.6)
    const emailVerSend = await h.verificationService.sendEmailVerification(
      { email: 'member.email@gmail.com' },
      { userId: regEmail.user.id },
    );
    expect(emailVerSend.sent).toBe(true);
    expect(emailVerSend.devVerificationToken).toBeDefined();

    const emailVerConfirm = await h.verificationService.confirmEmailVerification({
      email: 'member.email@gmail.com',
      tokenOrCode: emailVerSend.devVerificationToken!,
    });
    expect(emailVerConfirm.verified).toBe(true);
    expect(emailVerConfirm.channel).toBe('EMAIL');
    const verifiedEmailUser = await h.usersService.getById(regEmail.user.id);
    expect(verifiedEmailUser.emailVerifiedAt).not.toBeNull();

    // 7. Xác minh SĐT bằng OTP có giới hạn số lần gửi (maxSends = 2) và số lần nhập sai (maxAttempts = 3) (3.2.7)
    const phoneOtp1 = await h.verificationService.sendPhoneOtp({ phone: '0912345678' });
    expect(phoneOtp1.sendCount).toBe(1);
    const phoneOtp2 = await h.verificationService.sendPhoneOtp({ phone: '0912345678' });
    expect(phoneOtp2.sendCount).toBe(2);

    // Lần gửi thứ 3 vượt quá otpMaxSendCount (2) -> bị chặn
    await expect(
      h.verificationService.sendPhoneOtp({ phone: '0912345678' }),
    ).rejects.toThrow();

    // Nhập sai OTP 3 lần liên tiếp -> vượt quá otpMaxAttempts (3) -> hủy hiệu lực mã
    await expect(
      h.verificationService.confirmPhoneOtp({ phone: '0912345678', code: '000000' }),
    ).rejects.toThrow();
    await expect(
      h.verificationService.confirmPhoneOtp({ phone: '0912345678', code: '111111' }),
    ).rejects.toThrow();
    await expect(
      h.verificationService.confirmPhoneOtp({ phone: '0912345678', code: '222222' }),
    ).rejects.toThrow();

    // Tăng giới hạn gửi để gửi lại mã mới và xác nhận đúng
    await h.securitySettingsService.updateSettings({ otpMaxSendCount: 5 });
    const phoneOtpValid = await h.verificationService.sendPhoneOtp({ phone: '0912345678' });
    const phoneConfirmed = await h.verificationService.confirmPhoneOtp({
      phone: '0912345678',
      code: phoneOtpValid.devVerificationCode!,
    });
    expect(phoneConfirmed.verified).toBe(true);
    expect(phoneConfirmed.channel).toBe('PHONE_OTP');

    const verifiedPhoneUser = await h.usersService.getById(regPhone.user.id);
    expect(verifiedPhoneUser.phoneVerifiedAt).not.toBeNull();
  });

  it('Mục 3.3: Mật khẩu gợi ý, Chính sách mật khẩu (disallowed + userInfo), Đổi mật khẩu (biến setting requireCurrentPasswordOnChange), Chống dùng lại mật khẩu cũ, Quên mật khẩu bằng OTP 6 số, Admin Reset mật khẩu & Thu hồi phiên', async () => {
    // 1. Gợi ý mật khẩu mạnh (Suggested Strong Password)
    const suggested = await h.passwordService.suggestPasswords({ count: 3, length: 16 });
    expect(suggested.suggestions).toHaveLength(3);
    expect(suggested.password).toBe(suggested.suggestions[0]);
    for (const pwd of suggested.suggestions) {
      expect(pwd.length).toBeGreaterThanOrEqual(16);
      expect(/[A-Z]/.test(pwd)).toBe(true);
      expect(/[a-z]/.test(pwd)).toBe(true);
      expect(/[0-9]/.test(pwd)).toBe(true);
      expect(/[^A-Za-z0-9]/.test(pwd)).toBe(true);
    }

    // 2. Tạo tài khoản kiểm thử và thiết lập chính sách mật khẩu qua biến setting
    await h.securitySettingsService.updateSettings({
      passwordMinLength: 10,
      requireUppercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
      requireCurrentPasswordOnChange: true,
      disallowedPasswords: ['qwerty123', 'summer2026!'],
      disallowUserInfoInPassword: true,
      preventPasswordReuse: true,
      passwordHistoryLimit: 3,
      revokeSessionsOnPasswordChange: true,
    });

    const user = await h.usersService.create({
      username: 'hoanglong99',
      email: 'hoanglong99@gmail.com',
      firstName: 'Long',
      lastName: 'Hoàng',
      phone: '0933445566',
      password: 'Init#Password101',
      status: USER_STATUS.ACTIVE,
      roleIds: [],
      organizationUnits: [],
    });

    // Đăng nhập 2 phiên thiết bị khác nhau
    const session1 = await h.authService.login({
      identifier: 'hoanglong99',
      password: 'Init#Password101',
      deviceName: 'Device 1',
    });
    const session2 = await h.authService.login({
      identifier: 'hoanglong99',
      password: 'Init#Password101',
      deviceName: 'Device 2',
    });
    expect(session1.sessionId).toBeDefined();
    expect(session2.sessionId).toBeDefined();

    // 3. Kiểm tra chính sách mật khẩu: cấm mật khẩu trong danh sách đen hoặc chứa username/email
    await expect(
      h.passwordService.changePassword(
        user.id,
        {
          currentPassword: 'Init#Password101',
          newPassword: 'Summer2026!',
        },
        session1.sessionId,
      ),
    ).rejects.toThrow();

    await expect(
      h.passwordService.changePassword(
        user.id,
        {
          currentPassword: 'Init#Password101',
          newPassword: 'Hoanglong99#Secure1',
        },
        session1.sessionId,
      ),
    ).rejects.toThrow();

    // 4. Đổi mật khẩu thành công (yêu cầu mật khẩu hiện tại) & tự động thu hồi phiên khác
    await expect(
      h.passwordService.changePassword(user.id, {
        newPassword: 'Valid#Password202',
      }),
    ).rejects.toThrow();

    const change1 = await h.passwordService.changePassword(
      user.id,
      {
        currentPassword: 'Init#Password101',
        newPassword: 'Valid#Password202',
      },
      session1.sessionId,
    );
    expect(change1.changed).toBe(true);
    expect(change1.revokedSessionsCount).toBe(1); // Thu hồi session2, giữ lại session1 hiện tại

    // 5. Không cho dùng lại mật khẩu cũ (preventPasswordReuse = true)
    await expect(
      h.passwordService.changePassword(
        user.id,
        {
          currentPassword: 'Valid#Password202',
          newPassword: 'Init#Password101',
        },
        session1.sessionId,
      ),
    ).rejects.toThrow();

    // 6. Tắt biến setting requireCurrentPasswordOnChange -> đổi mật khẩu không cần truyền currentPassword
    await h.securitySettingsService.updateSettings({
      requireCurrentPasswordOnChange: false,
    });
    const changeNoCurrent = await h.passwordService.changePassword(
      user.id,
      {
        newPassword: 'Third#Password303',
      },
      session1.sessionId,
    );
    expect(changeNoCurrent.changed).toBe(true);

    // 7. Quên mật khẩu & Khôi phục bằng mã OTP 6 chữ số (3.3.2)
    const forgotOtpRes = await h.passwordService.requestPasswordReset({
      email: 'hoanglong99@gmail.com',
    });
    expect(forgotOtpRes.accepted).toBe(true);
    expect(forgotOtpRes.devResetToken).toBeDefined();
    expect(forgotOtpRes.devResetOtp).toMatch(/^\d{6}$/);

    // Khôi phục bằng OTP 6 chữ số và kiểm tra thu hồi toàn bộ phiên
    const resetByOtp = await h.passwordService.resetPassword({
      email: 'hoanglong99@gmail.com',
      otpCode: forgotOtpRes.devResetOtp!,
      newPassword: 'Fourth#Password404',
    });
    expect(resetByOtp.reset).toBe(true);
    expect(resetByOtp.revokedSessionsCount).toBe(1); // session1 cũng bị thu hồi sau khi reset

    // 8. Admin Reset mật khẩu người dùng từ trang quản trị (dùng mật khẩu gợi ý tự động & thu hồi phiên)
    await h.authService.login({
      identifier: 'hoanglong99',
      password: 'Fourth#Password404',
      deviceName: 'Device After Reset',
    });
    const adminResetRes = await h.usersService.adminResetPassword(
      user.id,
      { useSuggestedPassword: true, revokeSessions: true },
      1,
    );
    expect(adminResetRes.reset).toBe(true);
    expect(adminResetRes.userId).toBe(user.id);
    expect(adminResetRes.generatedPassword).toBeDefined();
    expect(adminResetRes.revokedSessionsCount).toBe(1);

    // 9. Tự nâng cấp thuật toán băm mật khẩu khi người dùng đăng nhập (3.3.6: SCRYPT -> PBKDF2_SHA512)
    expect(h.userStore.get(user.id)?.passwordHash.startsWith('scrypt$')).toBe(true);
    await h.securitySettingsService.updateSettings({
      passwordHashAlgorithm: 'PBKDF2_SHA512',
    });

    const loginAfterAdminReset = await h.authService.login({
      identifier: 'hoanglong99',
      password: adminResetRes.generatedPassword!,
    });
    expect(loginAfterAdminReset.accessToken).toBeDefined();
    expect(h.userStore.get(user.id)?.passwordHash.startsWith('pbkdf2_sha512$')).toBe(true);
  });

  it('Mục 3.4: Quản lý phiên đăng nhập — Idle Timeout, Max Session Lifetime, Thu hồi phiên từ xa / Khẩn cấp (Admin & User) và Ghi lịch sử đăng nhập & đăng xuất (bật/tắt enableLoginAuditLog)', async () => {
    await h.securitySettingsService.updateSettings({
      sessionIdleTimeoutMinutes: 15,
      sessionMaxLifetimeMinutes: 120,
      enableLoginAuditLog: true,
    });

    const user = await h.usersService.create({
      username: 'sessiontester',
      email: 'sessiontester@gmail.com',
      firstName: 'Phúc',
      lastName: 'Đặng Hồng',
      password: 'Session#Pass123',
      status: USER_STATUS.ACTIVE,
      roleIds: [],
      organizationUnits: [],
    });

    // 1. Đăng nhập thất bại (sai mật khẩu) -> được ghi nhận vào lịch sử đăng nhập (LOGIN_FAILED)
    await expect(
      h.authService.login(
        {
          identifier: 'sessiontester@gmail.com',
          password: 'Wrong#Pass999',
          deviceName: 'Suspicious Browser',
        },
        { ipAddress: '203.0.113.99', userAgent: 'KaliLinux/1.0' },
      ),
    ).rejects.toThrow();

    // 2. Đăng nhập thành công trên 2 thiết bị -> được ghi nhận vào lịch sử (LOGIN_SUCCESS)
    const dev1 = await h.authService.login(
      {
        identifier: 'sessiontester@gmail.com',
        password: 'Session#Pass123',
        deviceName: 'MacBook Air M3',
      },
      { ipAddress: '192.168.1.10', userAgent: 'Mozilla/5.0 (Macintosh)' },
    );
    const dev2 = await h.authService.login(
      {
        identifier: 'sessiontester@gmail.com',
        password: 'Session#Pass123',
        deviceName: 'iPhone 16 Pro',
      },
      { ipAddress: '192.168.1.11', userAgent: 'Mozilla/5.0 (iPhone)' },
    );

    expect(dev1.sessionId).toBeDefined();
    expect(dev2.sessionId).toBeDefined();

    // 3. Kiểm tra danh sách thiết bị đang đăng nhập
    const activeList = await h.sessionService.listUserSessions(user.id, dev1.sessionId);
    expect(activeList).toHaveLength(2);
    expect(activeList.find((s) => s.id === dev1.sessionId)?.isCurrent).toBe(true);

    // 4. Kiểm tra tự động hết hạn phiên do Idle Timeout (quá 15 phút không hoạt động)
    const s1Entity = h.sessionStore.get(dev1.sessionId!)!;
    s1Entity.lastActiveAt = new Date(Date.now() - 16 * 60 * 1000); // 16 phút trước (> 15 phút Idle Timeout)
    await expect(
      h.authService.refresh({ refreshToken: dev1.refreshToken! }),
    ).rejects.toThrow();
    expect(h.sessionStore.get(dev1.sessionId!)?.revokeReason).toContain('Session idle timeout');

    // 5. Kiểm tra tự động hết hạn phiên do Max Session Lifetime (vượt quá 120 phút kể từ lúc tạo phiên)
    const dev3 = await h.authService.login(
      {
        identifier: 'sessiontester@gmail.com',
        password: 'Session#Pass123',
        deviceName: 'Windows Workstation',
      },
      { ipAddress: '192.168.1.12', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
    );
    const s3Entity = h.sessionStore.get(dev3.sessionId!)!;
    s3Entity.createdAt = new Date(Date.now() - 125 * 60 * 1000); // Tạo 125 phút trước (> 120 phút Max Lifetime)
    s3Entity.lastActiveAt = new Date(Date.now() - 2 * 60 * 1000); // Mới hoạt động 2 phút trước
    await expect(
      h.authService.refresh({ refreshToken: dev3.refreshToken! }),
    ).rejects.toThrow();
    expect(h.sessionStore.get(dev3.sessionId!)?.revokeReason).toContain(
      'Session maximum lifetime exceeded',
    );

    // 6. Đăng xuất (Logout) thiết bị dev2 -> ghi nhận sự kiện LOGOUT
    await h.authService.logout(dev2.refreshToken);

    // 7. Đăng nhập lại 2 phiên mới và thực hiện Admin thu hồi toàn bộ phiên khi có sự cố (POST /users/:id/revoke-sessions)
    await h.authService.login(
      {
        identifier: 'sessiontester@gmail.com',
        password: 'Session#Pass123',
        deviceName: 'Tablet Android',
      },
      { ipAddress: '192.168.1.20', userAgent: 'Android 15' },
    );
    const adminRevoke = await h.usersService.revokeUserSessions(
      user.id,
      'Tài khoản có dấu hiệu bất thường cần thu hồi khẩn cấp',
      1,
    );
    expect(adminRevoke.revokedSessionsCount).toBe(1);

    // 8. Kiểm tra Lịch sử đăng nhập & đăng xuất theo thời gian, IP và thiết bị
    const history = await h.usersService.getUserLoginHistory(user.id, 50);
    expect(history.length).toBeGreaterThanOrEqual(6);
    const eventNames = history.map((item) => item.eventTypeName);
    expect(eventNames).toEqual(
      expect.arrayContaining([
        'LOGIN_FAILED',
        'LOGIN_SUCCESS',
        'SESSION_EXPIRED',
        'LOGOUT',
        'SESSION_REVOKE_ALL',
      ]),
    );
    const failedEvent = history.find((item) => item.eventTypeName === 'LOGIN_FAILED');
    expect(failedEvent?.ipAddress).toBe('203.0.113.99');
    expect(failedEvent?.deviceName).toBe('Suspicious Browser');

    // 9. Tắt biến setting enableLoginAuditLog = false -> không ghi thêm bản ghi lịch sử mới
    const countBeforeDisable = (await h.sessionService.listUserLoginHistory(user.id, 100)).length;
    await h.securitySettingsService.updateSettings({ enableLoginAuditLog: false });
    await h.authService.login({
      identifier: 'sessiontester@gmail.com',
      password: 'Session#Pass123',
      deviceName: 'Unlogged Device',
    });
    const countAfterDisable = (await h.sessionService.listUserLoginHistory(user.id, 100)).length;
    expect(countAfterDisable).toBe(countBeforeDisable);
  });

  it('Mục 3.5: Xác thực OTP và MFA — Email Adapter, SMS Provider & MFA SMS_OTP, TOTP, Recovery Codes, Trusted Devices, Bắt buộc MFA theo vai trò, Step-up Authentication & Reset MFA có kiểm soát', async () => {
    const adminRole = await h.rolesService.create({
      code: 'SUPER_ADMIN',
      name: 'Super Administrator',
      status: ROLE_STATUS.ACTIVE,
      permissions: ['users.read', 'users.update', 'users.export', 'system.manage'],
    });
    const memberRole = await h.rolesService.create({
      code: 'MEMBER',
      name: 'Standard Member',
      status: ROLE_STATUS.ACTIVE,
      permissions: ['users.read'],
    });

    const adminUser = await h.usersService.create({
      username: 'chiefadmin',
      email: 'chiefadmin@core.local',
      firstName: 'Quân',
      lastName: 'Lê Minh',
      phone: '0909888777',
      password: 'Admin#Secure123',
      status: USER_STATUS.ACTIVE,
      roleIds: [adminRole.id],
      organizationUnits: [],
    });

    const normalUser = await h.usersService.create({
      username: 'normalmember',
      email: 'normalmember@core.local',
      firstName: 'Hà',
      lastName: 'Phạm Thu',
      phone: '0911222333',
      password: 'Member#Secure123',
      status: USER_STATUS.ACTIVE,
      roleIds: [memberRole.id],
      organizationUnits: [],
    });

    // 1. Bắt buộc MFA theo vai trò (3.5.6: REQUIRED_FOR_ADMINS)
    await h.securitySettingsService.updateSettings({
      mfaPolicy: 'REQUIRED_FOR_ADMINS',
      allowedMfaMethods: ['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE'],
    });

    // Người dùng thường (MEMBER) chưa bật MFA -> vẫn đăng nhập thẳng bình thường
    const memberLogin = await h.authService.login({
      identifier: 'normalmember',
      password: 'Member#Secure123',
    });
    expect(memberLogin.mfaRequired).toBe(false);
    expect(memberLogin.accessToken).toBeDefined();

    // Quản trị viên (SUPER_ADMIN) dù chưa tự bật MFA cá nhân vẫn bị bắt buộc qua bước 2 MFA (mfaPolicyEnforced = true)
    // và hệ thống tự động gửi Email OTP qua Notification Adapter (3.5.1)
    const adminLogin1 = await h.authService.login({
      identifier: 'chiefadmin',
      password: 'Admin#Secure123',
    });
    expect(adminLogin1.mfaRequired).toBe(true);
    expect(adminLogin1.mfaPolicyEnforced).toBe(true);
    expect(adminLogin1.mfaEnrollmentRequired).toBe(true);
    expect(adminLogin1.emailOtpSent).toBe(true);
    expect(adminLogin1.devOtpCode).toMatch(/^\d{6}$/);
    expect(h.emailAdapter.getDispatchedHistory().length).toBeGreaterThanOrEqual(1);
    expect(h.emailAdapter.getDispatchedHistory()[0]?.purpose).toBe('MFA_EMAIL_OTP');

    // 2. Gửi OTP qua SMS dùng SMS Provider riêng & kích hoạt MFA SMS_OTP (3.5.2)
    const smsSent = await h.authService.sendMfaSmsOtp({
      mfaChallengeToken: adminLogin1.mfaChallengeToken!,
    });
    expect(smsSent.sent).toBe(true);
    expect(smsSent.providerMessageId).toBeDefined();
    expect(smsSent.devOtpCode).toMatch(/^\d{6}$/);
    expect(h.smsProvider.getDispatchedHistory()[0]?.purpose).toBe('MFA_SMS_OTP');

    const smsEnableRes = await h.mfaService.enableSmsOtp(adminUser.id, {
      code: smsSent.devOtpCode!,
    });
    expect(smsEnableRes.mfaEnabled).toBe(true);
    expect(smsEnableRes.smsOtpEnabled).toBe(true);
    expect(smsEnableRes.recoveryCodes).toHaveLength(8);

    // 3. Cho phép tin cậy thiết bị (Trusted Devices có thời hạn và có thể thu hồi — 3.5.5)
    const smsChallengeOtp = await h.authService.sendMfaSmsOtp({
      mfaChallengeToken: adminLogin1.mfaChallengeToken!,
    });
    const verifiedWithTrust = await h.authService.verifyMfaChallenge(
      {
        mfaChallengeToken: adminLogin1.mfaChallengeToken!,
        code: smsChallengeOtp.devOtpCode!,
        method: 'SMS_OTP',
        deviceName: 'Admin MacBook Pro 16',
        trustDevice: true,
        trustDurationDays: 14,
      },
      { ipAddress: '10.10.1.50', userAgent: 'Mozilla/5.0 (Macintosh)' },
    );
    expect(verifiedWithTrust.mfaRequired).toBe(false);
    expect(verifiedWithTrust.accessToken).toBeDefined();
    expect(verifiedWithTrust.trustedDeviceToken).toBeDefined();
    expect(verifiedWithTrust.trustedDeviceExpiresAt).toBeDefined();

    // Khi đăng nhập lại kèm trustedDeviceToken hợp lệ -> tự động miễn bước MFA
    const loginFromTrustedDevice = await h.authService.login({
      identifier: 'chiefadmin',
      password: 'Admin#Secure123',
      trustedDeviceToken: verifiedWithTrust.trustedDeviceToken!,
    });
    expect(loginFromTrustedDevice.mfaRequired).toBe(false);
    expect(loginFromTrustedDevice.trustedDeviceBypassed).toBe(true);
    expect(loginFromTrustedDevice.accessToken).toBeDefined();

    // Xem danh sách thiết bị tin cậy và thu hồi thiết bị tin cậy
    const trustedDevices = await h.mfaService.listTrustedDevices(adminUser.id);
    expect(trustedDevices).toHaveLength(1);
    expect(trustedDevices[0]?.deviceName).toBe('Admin MacBook Pro 16');

    const revokedTrusted = await h.mfaService.revokeTrustedDevice(
      adminUser.id,
      trustedDevices[0]!.deviceId,
    );
    expect(revokedTrusted.revoked).toBe(true);

    // Sau khi thu hồi thiết bị tin cậy -> đăng nhập lại với token cũ sẽ bắt buộc nhập MFA lại
    const loginAfterRevokeTrust = await h.authService.login({
      identifier: 'chiefadmin',
      password: 'Admin#Secure123',
      trustedDeviceToken: verifiedWithTrust.trustedDeviceToken!,
    });
    expect(loginAfterRevokeTrust.mfaRequired).toBe(true);

    // 4. Yêu cầu xác thực lại khi thao tác nhạy cảm (Step-Up Authentication — 3.5.7)
    // Khi yêu cầu requireStepUp = true mà không có stepUpToken -> bị từ chối
    await expect(
      h.usersService.assignRoles(
        normalUser.id,
        { roleIds: [adminRole.id], requireStepUp: true },
        adminUser.id,
      ),
    ).rejects.toThrow();

    // Thực hiện xác thực lại bằng mật khẩu hiện tại để nhận stepUpToken
    const stepUpRes = await h.authService.verifyStepUp(
      adminUser.id,
      {
        password: 'Admin#Secure123',
        action: 'users.assignRoles',
      },
      verifiedWithTrust.sessionId,
    );
    expect(stepUpRes.verified).toBe(true);
    expect(stepUpRes.stepUpToken).toBeDefined();

    // Dùng stepUpToken cho sai mục đích action ('users.export' thay vì 'users.assignRoles') -> bị từ chối
    await expect(
      h.usersService.verifySensitiveActionStepUp(
        adminUser.id,
        stepUpRes.stepUpToken,
        true,
        'users.export',
      ),
    ).rejects.toThrow();

    // Dùng stepUpToken đúng action 'users.assignRoles' -> đổi quyền thành công
    const promotedUser = await h.usersService.assignRoles(
      normalUser.id,
      {
        roleIds: [adminRole.id],
        stepUpToken: stepUpRes.stepUpToken,
        requireStepUp: true,
      },
      adminUser.id,
    );
    expect(promotedUser.roles[0]?.code).toBe('super_admin');

    // 5. Reset MFA có kiểm soát từ trang quản trị (3.5.8 — Có lý do xác minh / phê duyệt & thu hồi phiên)
    const resetMfaResult = await h.usersService.adminResetMfa(
      adminUser.id,
      {
        reason: 'Người dùng mất điện thoại, đã xác minh danh tính qua video call với IT Helpdesk',
        verificationReference: 'TICKET-IAM-2026-089',
        revokeSessions: true,
      },
      adminUser.id,
    );
    expect(resetMfaResult.reset).toBe(true);
    expect(resetMfaResult.userId).toBe(adminUser.id);
    expect(resetMfaResult.verificationReference).toBe('TICKET-IAM-2026-089');
    expect(resetMfaResult.revokedSessionsCount).toBeGreaterThanOrEqual(1);

    const statusAfterAdminReset = await h.mfaService.getStatus(adminUser.id);
    expect(statusAfterAdminReset.mfaEnabled).toBe(false);
    expect(statusAfterAdminReset.totpEnabled).toBe(false);
    expect(statusAfterAdminReset.emailOtpEnabled).toBe(false);
    expect(statusAfterAdminReset.smsOtpEnabled).toBe(false);
  });

  it('Mục 3.6: Tài khoản hệ thống (Service Account) và API Client — tạo Service Account (3.6.1), tạo API Client (3.6.2), gán phạm vi truy cập scopes (3.6.3), tạo & xoay vòng Client Secret hiển thị một lần (3.6.4), thu hồi API Client ngừng toàn bộ token (3.6.5), giới hạn IP/CIDR (3.6.6) và theo dõi lịch sử sử dụng gần nhất (3.6.7)', async () => {
    // 1. Tạo Service Account dùng cho hệ thống hoặc job, không gắn người dùng cá nhân (3.6.1)
    const sa = await h.serviceAccountService.createServiceAccount(
      {
        code: 'erp_sync_job',
        name: 'ERP Sync Background Worker',
        description: 'Tài khoản hệ thống đồng bộ dữ liệu nhân sự từ ERP',
        scopes: ['users.read', 'users.export', 'organizations.read'],
      },
      1,
    );
    expect(sa.id).toBe(1);
    expect(sa.code).toBe('ERP_SYNC_JOB');
    expect(sa.isServiceAccount).toBe(true);
    expect(sa.userId).toBeNull();
    expect(sa.status).toBe(SERVICE_ACCOUNT_STATUS.ACTIVE);
    expect(sa.statusName).toBe('ACTIVE');
    expect(sa.scopes).toEqual(['users.read', 'users.export', 'organizations.read']);

    // Chặn trùng mã Service Account
    await expect(
      h.serviceAccountService.createServiceAccount({
        code: 'ERP_SYNC_JOB',
        name: 'Duplicate SA',
      }),
    ).rejects.toThrow();

    // 2. Tạo API Client gắn với Service Account (3.6.2, 3.6.3, 3.6.4, 3.6.6)
    // Nếu gán scope vượt quá phạm vi của Service Account ('users.delete' không nằm trong SA scopes) -> bị từ chối
    await expect(
      h.serviceAccountService.createApiClient({
        serviceAccountId: sa.id,
        name: 'Invalid Scope Client',
        scopes: ['users.read', 'users.delete'],
      }),
    ).rejects.toThrow();

    const createdClient = await h.serviceAccountService.createApiClient(
      {
        serviceAccountId: sa.id,
        name: 'ERP Production Connector',
        description: 'Kết nối từ máy chủ ERP nội bộ',
        scopes: ['users.read', 'organizations.read'],
        allowedIps: ['10.20.30.0/24', '203.0.113.50'],
      },
      1,
    );
    expect(createdClient.id).toBe(1);
    expect(createdClient.serviceAccountId).toBe(sa.id);
    expect(createdClient.serviceAccountCode).toBe('ERP_SYNC_JOB');
    expect(createdClient.clientId).toMatch(/^cli_[A-Za-z0-9_-]+$/);
    expect(createdClient.clientSecret).toMatch(/^cs_[A-Za-z0-9_-]+$/);
    expect(createdClient.oneTimeSecretWarning).toBe(true);
    expect(createdClient.scopes).toEqual(['users.read', 'organizations.read']);
    expect(createdClient.allowedIps).toEqual(['10.20.30.0/24', '203.0.113.50']);
    expect(createdClient.status).toBe(API_CLIENT_STATUS.ACTIVE);
    expect(createdClient.tokenVersion).toBe(1);

    // 3.6.4: Khi gọi getApiClientById hoặc listApiClients sau đó, KHÔNG BAO GIỜ trả về plain clientSecret nữa
    const fetchedClient = await h.serviceAccountService.getApiClientById(createdClient.id);
    expect((fetchedClient as Record<string, unknown>).clientSecret).toBeUndefined();
    expect(fetchedClient.secretPrefix).toBe(`${createdClient.clientSecret.slice(0, 10)}...`);

    const allClients = await h.serviceAccountService.listApiClients(sa.id);
    expect(allClients).toHaveLength(1);
    expect((allClients[0] as Record<string, unknown>).clientSecret).toBeUndefined();

    // 3.6.6 & 3.6.7: Cấp token từ IP không nằm trong danh sách cho phép -> bị từ chối & ghi nhận DENIED_IP
    await expect(
      h.serviceAccountService.issueClientToken(
        {
          clientId: createdClient.clientId,
          clientSecret: createdClient.clientSecret,
        },
        { ipAddress: '198.51.100.99' },
      ),
    ).rejects.toThrow();

    let usageTrack = await h.serviceAccountService.getApiClientUsage(createdClient.id);
    expect(usageTrack.lastUsedIp).toBe('198.51.100.99');
    expect(usageTrack.lastUsedResult).toBe('DENIED_IP');

    // Sai Client Secret từ IP hợp lệ -> bị từ chối & ghi nhận INVALID_SECRET
    await expect(
      h.serviceAccountService.issueClientToken(
        {
          clientId: createdClient.clientId,
          clientSecret: 'cs_wrong_secret_value_123456',
        },
        { ipAddress: '10.20.30.15' },
      ),
    ).rejects.toThrow();

    usageTrack = await h.serviceAccountService.getApiClientUsage(createdClient.id);
    expect(usageTrack.lastUsedIp).toBe('10.20.30.15');
    expect(usageTrack.lastUsedResult).toBe('INVALID_SECRET');

    // Yêu cầu scope vượt quá phạm vi của API Client khi xin token -> bị từ chối & ghi nhận FORBIDDEN_SCOPE
    await expect(
      h.serviceAccountService.issueClientToken(
        {
          clientId: createdClient.clientId,
          clientSecret: createdClient.clientSecret,
          scopes: ['users.export'],
        },
        { ipAddress: '10.20.30.15' },
      ),
    ).rejects.toThrow();

    usageTrack = await h.serviceAccountService.getApiClientUsage(createdClient.id);
    expect(usageTrack.lastUsedResult).toBe('FORBIDDEN_SCOPE');

    // Cấp token thành công từ IP nằm trong dải CIDR 10.20.30.0/24 (có chuẩn hóa ::ffff:10.20.30.88)
    const tokenRes1 = await h.serviceAccountService.issueClientToken(
      {
        clientId: createdClient.clientId,
        clientSecret: createdClient.clientSecret,
      },
      { ipAddress: '::ffff:10.20.30.88' },
    );
    expect(tokenRes1.accessToken).toBeDefined();
    expect(tokenRes1.tokenType).toBe('Bearer');
    expect(tokenRes1.clientId).toBe(createdClient.clientId);
    expect(tokenRes1.serviceAccountCode).toBe('ERP_SYNC_JOB');
    expect(tokenRes1.scopes).toEqual(['users.read', 'organizations.read']);

    // Xác thực token qua UserIdentityResolverService (mô phỏng AuthGuard gọi khi API Client gọi endpoint)
    const verifiedPayload1 = (await h.tokenService.verify(tokenRes1.accessToken))!;
    expect(verifiedPayload1).not.toBeNull();
    const resolvedIdentity1 = await h.identityResolver.resolveIdentity(verifiedPayload1, {
      ipAddress: '203.0.113.50',
      endpoint: '/api/v1/users',
      method: 'GET',
    });
    expect(resolvedIdentity1).not.toBeNull();
    expect(resolvedIdentity1!.subjectType).toBe('SERVICE_ACCOUNT');
    expect(resolvedIdentity1!.serviceAccountId).toBe(sa.id);
    expect(resolvedIdentity1!.apiClientId).toBe(createdClient.id);
    expect(resolvedIdentity1!.clientId).toBe(createdClient.clientId);
    expect(resolvedIdentity1!.permissions).toEqual(['users.read', 'organizations.read']);

    // Nếu mang token hợp lệ nhưng gọi API từ IP trái phép -> bị chặn ngay tại bước resolveIdentity (403 Forbidden)
    await expect(
      h.identityResolver.resolveIdentity(verifiedPayload1, {
        ipAddress: '172.16.0.99',
        endpoint: '/api/v1/users',
        method: 'GET',
      }),
    ).rejects.toThrow();

    // 3.6.3: Cập nhật phạm vi truy cập (scopes) cho API Client
    const updatedScopesClient = await h.serviceAccountService.updateApiClientScopes(
      createdClient.id,
      {
        scopes: ['users.read', 'users.export'],
      },
    );
    expect(updatedScopesClient.scopes).toEqual(['users.read', 'users.export']);

    // 3.6.4: Xoay vòng Client Secret (Rotate Secret) -> trả về secret mới 1 lần, tăng tokenVersion và vô hiệu hóa secret + token cũ
    const rotated = await h.serviceAccountService.rotateClientSecret(createdClient.id, {
      reason: 'Xoay vòng định kỳ hàng quý',
    });
    expect(rotated.clientSecret).toMatch(/^cs_[A-Za-z0-9_-]+$/);
    expect(rotated.clientSecret).not.toBe(createdClient.clientSecret);
    expect(rotated.oneTimeSecretWarning).toBe(true);
    expect(rotated.tokenVersion).toBe(2);
    expect(rotated.secretRotatedAt).toBeDefined();

    // Secret cũ không còn xin được token
    await expect(
      h.serviceAccountService.issueClientToken(
        {
          clientId: createdClient.clientId,
          clientSecret: createdClient.clientSecret,
        },
        { ipAddress: '203.0.113.50' },
      ),
    ).rejects.toThrow();

    // Token cũ (tokenVersion = 1) bị vô hiệu hóa ngay lập tức
    const identityFromOldToken = await h.identityResolver.resolveIdentity(verifiedPayload1, {
      ipAddress: '203.0.113.50',
      endpoint: '/api/v1/users',
      method: 'GET',
    });
    expect(identityFromOldToken).toBeNull();

    // Xin token mới bằng Client Secret mới -> thành công
    const tokenRes2 = await h.serviceAccountService.issueClientToken(
      {
        clientId: createdClient.clientId,
        clientSecret: rotated.clientSecret,
      },
      { ipAddress: '203.0.113.50' },
    );
    const verifiedPayload2 = (await h.tokenService.verify(tokenRes2.accessToken))!;
    expect(verifiedPayload2).not.toBeNull();
    const resolvedIdentity2 = await h.identityResolver.resolveIdentity(verifiedPayload2, {
      ipAddress: '203.0.113.50',
      endpoint: '/api/v1/users/export',
      method: 'GET',
    });
    expect(resolvedIdentity2).not.toBeNull();
    expect(resolvedIdentity2!.permissions).toEqual(['users.read', 'users.export']);

    // 3.6.5: Thu hồi API Client (Revoke) -> ngừng toàn bộ token đã cấp ngay lập tức
    const revokedRes = await h.serviceAccountService.revokeApiClient(createdClient.id, {
      reason: 'Ngừng tích hợp hệ thống ERP cũ',
    });
    expect(revokedRes.revoked).toBe(true);
    expect(revokedRes.status).toBe(API_CLIENT_STATUS.REVOKED);
    expect(revokedRes.statusName).toBe('REVOKED');
    expect(revokedRes.tokenVersion).toBe(3);

    // Token đã cấp trước khi thu hồi lập tức mất hiệu lực
    const identityAfterRevoke = await h.identityResolver.resolveIdentity(verifiedPayload2, {
      ipAddress: '203.0.113.50',
      endpoint: '/api/v1/users',
      method: 'GET',
    });
    expect(identityAfterRevoke).toBeNull();

    // Không thể xin cấp token mới từ API Client đã bị thu hồi
    await expect(
      h.serviceAccountService.issueClientToken(
        {
          clientId: createdClient.clientId,
          clientSecret: rotated.clientSecret,
        },
        { ipAddress: '203.0.113.50' },
      ),
    ).rejects.toThrow();

    // 3.6.7: Kiểm tra lịch sử sử dụng gần nhất (IP, thời gian, kết quả, endpoint)
    const finalUsage = await h.serviceAccountService.getApiClientUsage(createdClient.id);
    expect(finalUsage.clientId).toBe(createdClient.clientId);
    expect(finalUsage.lastUsedAt).toBeDefined();
    expect(finalUsage.lastUsedIp).toBe('203.0.113.50');
    expect(finalUsage.lastUsedResult).toBe('CLIENT_REVOKED');
    expect(finalUsage.logs.length).toBeGreaterThanOrEqual(6);
  });
});


