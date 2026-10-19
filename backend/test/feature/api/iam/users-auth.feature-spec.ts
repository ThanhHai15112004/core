import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import { TransactionManager } from '@packages/database/index.js';
import { PasswordHasherService, TotpService } from '@packages/security/index.js';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import {
  ORGANIZATION_UNIT_STATUS,
  ORGANIZATION_UNIT_TYPE,
} from '@modules/organizations/contracts/index.js';
import type { OrganizationUnitEntity } from '@modules/organizations/entities/organization-unit.entity.js';
import { OrganizationUnitRepository } from '@modules/organizations/repositories/organization-unit.repository.js';
import { PERMISSION_STATUS, ROLE_STATUS } from '@modules/roles/contracts/index.js';
import type { PermissionEntity } from '@modules/roles/entities/permission.entity.js';
import type { RoleEntity } from '@modules/roles/entities/role.entity.js';
import type { RolePermissionEntity } from '@modules/roles/entities/role-permission.entity.js';
import { PermissionRepository } from '@modules/roles/repositories/permission.repository.js';
import { RoleRepository } from '@modules/roles/repositories/role.repository.js';
import { RolePermissionRepository } from '@modules/roles/repositories/role-permission.repository.js';
import { USER_STATUS, normalizePhoneNumber } from '@modules/users/contracts/index.js';
import type { UserEntity } from '@modules/users/entities/user.entity.js';
import type { UserProfileEntity } from '@modules/users/entities/user-profile.entity.js';
import type { UserRoleEntity } from '@modules/users/entities/user-role.entity.js';
import type { UserOrganizationUnitEntity } from '@modules/users/entities/user-organization-unit.entity.js';
import type { UserStatusHistoryEntity } from '@modules/users/entities/user-status-history.entity.js';
import {
  UserRepository,
  type SearchUsersFilter,
} from '@modules/users/repositories/user.repository.js';
import { UserProfileRepository } from '@modules/users/repositories/user-profile.repository.js';
import { UserRoleRepository } from '@modules/users/repositories/user-role.repository.js';
import {
  type UserOrganizationInputItem,
  UserOrganizationUnitRepository,
} from '@modules/users/repositories/user-organization-unit.repository.js';
import { UserStatusHistoryRepository } from '@modules/users/repositories/user-status-history.repository.js';
import {
  DB_ENCRYPTION_ALGO_CODE,
  MFA_METHOD,
  MFA_POLICY_CODE,
  PASSWORD_HASH_ALGO_CODE,
} from '@modules/auth/contracts/index.js';
import type { AuthSessionEntity } from '@modules/auth/entities/auth-session.entity.js';
import type { AuthMfaConfigEntity } from '@modules/auth/entities/auth-mfa-config.entity.js';
import type { AuthPasswordResetEntity } from '@modules/auth/entities/auth-password-reset.entity.js';
import type { AuthSecuritySettingEntity } from '@modules/auth/entities/auth-security-setting.entity.js';
import { AuthSessionRepository } from '@modules/auth/repositories/auth-session.repository.js';
import { AuthMfaConfigRepository } from '@modules/auth/repositories/auth-mfa-config.repository.js';
import { AuthPasswordResetRepository } from '@modules/auth/repositories/auth-password-reset.repository.js';
import { AuthSecuritySettingRepository } from '@modules/auth/repositories/auth-security-setting.repository.js';

describe('Feature E2E: IAM — Auth (3.2), Security Settings, Users + UserProfiles (firstName/lastName/statusHistory), Roles, Permissions & Organizations (Integer IDs & Status STT)', () => {
  let context: TestAppContext;
  let adminAccessToken = '';
  let adminRoleId = 0;

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
  let globalSecuritySetting: AuthSecuritySettingEntity | null = null;

  beforeAll(async () => {
    context = await createTestApp({
      useGlobalPrefix: true,
    });

    const hasher = context.moduleFixture.get(PasswordHasherService, { strict: false });
    const txManager = context.moduleFixture.get(TransactionManager, { strict: false });
    Object.assign(txManager, {
      runInTransaction: async <T>(work: (em: unknown) => Promise<T>) => work({}),
    });

    const orgRepo = context.moduleFixture.get(OrganizationUnitRepository, { strict: false });
    Object.assign(orgRepo, {
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
    });
    Object.defineProperty(orgRepo, 'repository', {
      configurable: true,
      get: () => ({
        softDelete: async (id: number) => {
          orgStore.delete(Number(id));
        },
      }),
    });

    const permRepo = context.moduleFixture.get(PermissionRepository, { strict: false });
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
    Object.assign(permRepo, {
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
    });

    const roleRepo = context.moduleFixture.get(RoleRepository, { strict: false });
    Object.assign(roleRepo, {
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
    });
    Object.defineProperty(roleRepo, 'repository', {
      configurable: true,
      get: () => ({
        softDelete: async (id: number) => {
          roleStore.delete(Number(id));
        },
      }),
    });

    const rolePermRepo = context.moduleFixture.get(RolePermissionRepository, { strict: false });
    Object.assign(rolePermRepo, {
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
    });

    const userProfileRepo = context.moduleFixture.get(UserProfileRepository, { strict: false });
    Object.assign(userProfileRepo, {
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
    });

    const userRepo = context.moduleFixture.get(UserRepository, { strict: false });
    Object.assign(userRepo, {
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
            partial.lockedUntil !== undefined
              ? partial.lockedUntil
              : (existing?.lockedUntil ?? null),
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
            partial.lastLoginAt !== undefined
              ? partial.lastLoginAt
              : (existing?.lastLoginAt ?? null),
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
          const kwPhoneHash = normPhone ? hasher.sha256(normPhone) : null;
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
    });

    const userRoleRepo = context.moduleFixture.get(UserRoleRepository, { strict: false });
    Object.assign(userRoleRepo, {
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
    });

    const userOrgRepo = context.moduleFixture.get(UserOrganizationUnitRepository, {
      strict: false,
    });
    Object.assign(userOrgRepo, {
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
    });

    const userStatusHistoryRepo = context.moduleFixture.get(UserStatusHistoryRepository, {
      strict: false,
    });
    Object.assign(userStatusHistoryRepo, {
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
    });

    const sessionRepo = context.moduleFixture.get(AuthSessionRepository, { strict: false });
    Object.assign(sessionRepo, {
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
    });

    const mfaRepo = context.moduleFixture.get(AuthMfaConfigRepository, { strict: false });
    Object.assign(mfaRepo, {
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
    });

    const resetRepo = context.moduleFixture.get(AuthPasswordResetRepository, { strict: false });
    Object.assign(resetRepo, {
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
    });

    const securitySettingRepo = context.moduleFixture.get(AuthSecuritySettingRepository, {
      strict: false,
    });
    Object.assign(securitySettingRepo, {
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
            partial.allowEmailRegistration ??
            globalSecuritySetting?.allowEmailRegistration ??
            true,
          allowPhoneRegistration:
            partial.allowPhoneRegistration ??
            globalSecuritySetting?.allowPhoneRegistration ??
            true,
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
          createdAt: globalSecuritySetting?.createdAt ?? now,
          updatedAt: now,
        } as AuthSecuritySettingEntity;
        return globalSecuritySetting;
      },
    });

    // Seed super_admin role (ID = 1), permissions (ID = 1..10) & superadmin@gmail.com (ID = 1) with password !P@ssw0rd#
    const seededPerms = await permRepo.ensureByCodes([
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
    const seededRole = await roleRepo.saveEntity({
      code: 'super_admin',
      name: 'Super Administrator',
      isSystem: true,
      status: ROLE_STATUS.ACTIVE,
    });
    adminRoleId = seededRole.id;
    await rolePermRepo.replacePermissionsForRole(
      adminRoleId,
      seededPerms.map((p) => p.id),
    );

    const adminPasswordHash = await hasher.hash('!P@ssw0rd#');
    const adminUser = await userRepo.saveEntity({
      email: 'superadmin@gmail.com',
      username: 'superadmin',
      passwordHash: adminPasswordHash,
      status: USER_STATUS.ACTIVE,
    });
    await userProfileRepo.upsertByUserId(adminUser.id, {
      firstName: 'Sơn',
      lastName: 'Nguyễn Thái',
      fullName: 'Nguyễn Thái Sơn',
    });
    await userRoleRepo.replaceUserRoles(adminUser.id, [adminRoleId]);
  });

  afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  it('POST /api/v1/auth/login authenticates superadmin@gmail.com (ID = 1, !P@ssw0rd#) and GET/PUT /api/v1/auth/security-settings works', async () => {
    const loginRes = await context.injectJson<{
      mfaRequired: boolean;
      accessToken?: string;
      refreshToken?: string;
      sessionId?: number;
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
    expect(loginRes.body.data.sessionId).toBe(1);

    adminAccessToken = loginRes.body.data.accessToken!;

    // Verify GET /api/v1/auth/me returns integer id = 1, firstName, lastName, status = 1
    const meRes = await context.injectJson<{
      id: number;
      email: string;
      firstName: string;
      lastName: string;
      status: number;
      statusName: string;
      roles: string[];
      permissions: string[];
    }>({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });

    expect(meRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(meRes.body.data.id).toBe(1);
    expect(meRes.body.data.email).toBe('superadmin@gmail.com');
    expect(meRes.body.data.firstName).toBe('Sơn');
    expect(meRes.body.data.lastName).toBe('Nguyễn Thái');
    expect(meRes.body.data.status).toBe(1);
    expect(meRes.body.data.statusName).toBe('ACTIVE');
    expect(meRes.body.data.roles).toContain('super_admin');
    expect(meRes.body.data.permissions).toContain('users.create');

    // Verify GET /api/v1/roles/permissions returns dedicated permissions table rows with integer id & status
    const permsRes = await context.injectJson<
      Array<{ id: number; code: string; status: number; statusName: string }>
    >({
      method: 'GET',
      url: '/api/v1/roles/permissions',
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    expect(permsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(permsRes.body.data.length).toBeGreaterThanOrEqual(10);
    expect(permsRes.body.data[0]?.id).toBe(1);
    expect(permsRes.body.data[0]?.status).toBe(1);

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

  it('Organizations (TP.HCM 1 Branch), Roles & Users CRUD + Multi-Org Assignment + Lock/Unlock + Status History + CSV Bulk Import/Export work end-to-end with integer IDs & statuses', async () => {
    const authHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 1. Create HQ_HCM (type = 1) and 1 Branch in HCMC (BRANCH_HCM, type = 2)
    const orgHqRes = await context.injectJson<{
      id: number;
      code: string;
      type: number;
      status: number;
    }>({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: authHeaders,
      payload: {
        code: 'HQ_HCM',
        name: 'Trụ sở chính TP. Hồ Chí Minh',
        type: 1,
        status: 1,
      },
    });
    expect(orgHqRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const hqId = orgHqRes.body.data.id;
    expect(hqId).toBe(1);
    expect(orgHqRes.body.data.type).toBe(1);
    expect(orgHqRes.body.data.status).toBe(1);

    const orgBranchRes = await context.injectJson<{ id: number; code: string; type: number }>({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: authHeaders,
      payload: {
        code: 'BRANCH_HCM',
        name: 'Chi nhánh TP. Hồ Chí Minh',
        type: 2,
        parentId: hqId,
        status: 1,
      },
    });
    expect(orgBranchRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const branchId = orgBranchRes.body.data.id;
    expect(branchId).toBe(2);

    // 2. Create a custom role
    const roleRes = await context.injectJson<{
      id: number;
      code: string;
      status: number;
      permissions: string[];
    }>({
      method: 'POST',
      url: '/api/v1/roles',
      headers: authHeaders,
      payload: {
        code: 'branch_director',
        name: 'Branch Director (Giám đốc Chi nhánh TP.HCM)',
        status: 1,
        permissions: ['users.read'],
      },
    });
    expect(roleRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const managerRoleId = roleRes.body.data.id;
    expect(managerRoleId).toBe(2);
    expect(roleRes.body.data.status).toBe(1);

    // 3. Create a user with firstName, lastName, @gmail.com and integer status = 1
    const createUserRes = await context.injectJson<{
      id: number;
      email: string;
      firstName: string;
      lastName: string;
      fullName: string;
      status: number;
      statusName: string;
      roles: { id: number; code: string }[];
      organizationUnits: { organizationUnitId: number; isPrimary: boolean }[];
    }>({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders,
      payload: {
        email: 'director.hcm@gmail.com',
        username: 'director.hcm',
        firstName: 'Linh',
        lastName: 'Đỗ Khánh',
        password: '!P@ssw0rd#',
        status: 1,
        roleIds: [managerRoleId],
        organizationUnits: [
          { organizationUnitId: hqId, isPrimary: false, positionTitle: 'Thành viên Ban điều hành' },
          {
            organizationUnitId: branchId,
            isPrimary: true,
            positionTitle: 'Giám đốc Chi nhánh TP.HCM',
          },
        ],
      },
    });
    expect(createUserRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const managerUserId = createUserRes.body.data.id;
    expect(managerUserId).toBe(2);
    expect(createUserRes.body.data.firstName).toBe('Linh');
    expect(createUserRes.body.data.lastName).toBe('Đỗ Khánh');
    expect(createUserRes.body.data.fullName).toBe('Đỗ Khánh Linh');
    expect(createUserRes.body.data.status).toBe(1);
    expect(createUserRes.body.data.organizationUnits).toHaveLength(2);

    // 4. Lock (status = 3) and Unlock (status = 1) user + verify status history
    const lockRes = await context.injectJson<{ status: number; statusName: string }>({
      method: 'POST',
      url: `/api/v1/users/${managerUserId}/lock`,
      headers: authHeaders,
      payload: { reason: 'Security review' },
    });
    expect(lockRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(lockRes.body.data.status).toBe(3);
    expect(lockRes.body.data.statusName).toBe('LOCKED');

    const unlockRes = await context.injectJson<{ status: number; statusName: string }>({
      method: 'POST',
      url: `/api/v1/users/${managerUserId}/unlock`,
      headers: authHeaders,
    });
    expect(unlockRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(unlockRes.body.data.status).toBe(1);
    expect(unlockRes.body.data.statusName).toBe('ACTIVE');

    const historyRes = await context.injectJson<
      Array<{ id: number; userId: number; fromStatus: number | null; toStatus: number }>
    >({
      method: 'GET',
      url: `/api/v1/users/${managerUserId}/status-history`,
      headers: authHeaders,
    });
    expect(historyRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(historyRes.body.data.length).toBeGreaterThanOrEqual(3);

    // 5. Bulk import users via CSV
    const csvContent = [
      'username,email,firstName,lastName,fullName,phone,password,status,roles,organizations',
      'minh.nguyenhoang01,minh.nguyenhoang01@gmail.com,Minh,"Nguyễn Hoàng","Nguyễn Hoàng Minh",0901234567,Abcd@454647#,1,branch_director,BRANCH_HCM',
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

    const enableTotpRes = await context.injectJson<{
      totpEnabled: boolean;
      recoveryCodes: string[];
    }>({
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
      sessionId?: number;
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

    // Verify authenticated user can send Email OTP without mfaChallengeToken (on @Public route)
    const authSendOtpRes = await context.injectJson<{
      sent: boolean;
      maskedEmail: string;
      devOtpCode?: string;
    }>({
      method: 'POST',
      url: '/api/v1/auth/mfa/email-otp/send',
      headers: authHeaders,
      payload: {},
    });
    expect(authSendOtpRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(authSendOtpRes.body.data.sent).toBe(true);

    // Verify Email OTP toggle off via { enabled: false }
    const disableEmailOtpRes = await context.injectJson<{
      mfaEnabled: boolean;
      totpEnabled: boolean;
      emailOtpEnabled: boolean;
    }>({
      method: 'POST',
      url: '/api/v1/auth/mfa/email-otp/enable',
      headers: authHeaders,
      payload: { enabled: false },
    });
    expect(disableEmailOtpRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(disableEmailOtpRes.body.data.emailOtpEnabled).toBe(false);
    expect(disableEmailOtpRes.body.data.totpEnabled).toBe(true);

    // Verify Fastify accepts Content-Type: application/json with empty body on DELETE /auth/sessions/:id
    if (verifyOtpRes.body.data.sessionId) {
      const rawRevokeRes = await context.app.inject({
        method: 'DELETE',
        url: `/api/v1/auth/sessions/${verifyOtpRes.body.data.sessionId}`,
        headers: {
          ...authHeaders,
          'content-type': 'application/json',
        },
        payload: '',
      });
      expect(rawRevokeRes.statusCode).toBe(HTTP_STATUS_CODE.OK);
    }
  });

  it('Section 3.2 E2E: Self-registration (Email & Phone with project toggles), Login by Phone, Email verification, Phone OTP verification (with send/attempt limits), Logout-all & user_profiles separation', async () => {
    // 1. Register with Email + password & detailed user_profiles fields (3.2.1)
    const regEmailRes = await context.injectJson<{
      registered: boolean;
      verificationRequired: boolean;
      accessToken?: string;
      user: {
        id: number;
        email: string;
        firstName: string;
        lastName: string;
        fullName: string;
        profile?: { city: string | null; bio: string | null };
      };
    }>({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'self.email@gmail.com',
        password: 'Password123',
        firstName: 'Thảo',
        lastName: 'Phạm Phương',
        city: 'Đà Nẵng',
        country: 'Vietnam',
        bio: 'QA Engineer',
        deviceName: 'Chrome Desktop',
      },
    });
    expect(regEmailRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(regEmailRes.body.data.registered).toBe(true);
    expect(regEmailRes.body.data.accessToken).toBeDefined();
    expect(regEmailRes.body.data.user.firstName).toBe('Thảo');
    expect(regEmailRes.body.data.user.fullName).toBe('Phạm Phương Thảo');
    expect(regEmailRes.body.data.user.profile?.city).toBe('Đà Nẵng');

    // Verify userStore (core) and userProfileStore (1:1 profile) separation
    const savedCore = userStore.get(regEmailRes.body.data.user.id);
    const savedProfile = userProfileStore.get(regEmailRes.body.data.user.id);
    expect(savedCore).toBeDefined();
    expect('firstName' in (savedCore as unknown as Record<string, unknown>)).toBe(false);
    expect(savedProfile?.firstName).toBe('Thảo');
    expect(savedProfile?.city).toBe('Đà Nẵng');

    // 2. Toggle off allowEmailRegistration via PUT /api/v1/auth/security-settings (3.2.1)
    await context.injectJson({
      method: 'PUT',
      url: '/api/v1/auth/security-settings',
      payload: {
        allowEmailRegistration: false,
        allowPhoneRegistration: true,
        otpCooldownSeconds: 0,
        otpMaxSendCount: 2,
        otpMaxAttempts: 2,
      },
    });

    const blockedEmailReg = await context.injectJson({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'blocked.user@gmail.com',
        password: 'Password123',
      },
    });
    expect(blockedEmailReg.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);

    // 3. Register with Phone + password (3.2.2)
    const regPhoneRes = await context.injectJson<{
      registered: boolean;
      accessToken?: string;
      user: { id: number; phone: string | null; fullName: string };
    }>({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: '+84 909 888 777',
        password: 'Password123',
        firstName: 'Hùng',
        lastName: 'Lý Quốc',
        deviceName: 'Android App',
      },
    });
    expect(regPhoneRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(regPhoneRes.body.data.user.phone).toBe('0909888777');
    expect(regPhoneRes.body.data.user.fullName).toBe('Lý Quốc Hùng');

    // 4. Login with Phone (3.2.3)
    const loginByPhoneRes = await context.injectJson<{
      mfaRequired: boolean;
      accessToken?: string;
      user?: { id: number; phone: string | null };
    }>({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: '0909888777',
        password: 'Password123',
        deviceName: 'Web Browser',
      },
    });
    expect(loginByPhoneRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(loginByPhoneRes.body.data.accessToken).toBeDefined();
    expect(loginByPhoneRes.body.data.user?.id).toBe(regPhoneRes.body.data.user.id);

    // 5. Logout from all devices via POST /api/v1/auth/logout-all (3.2.5)
    const phoneUserHeaders = { authorization: `Bearer ${loginByPhoneRes.body.data.accessToken}` };
    const logoutAllRes = await context.injectJson<{ loggedOutAll: boolean; revokedCount: number }>({
      method: 'POST',
      url: '/api/v1/auth/logout-all',
      headers: phoneUserHeaders,
      payload: {},
    });
    expect(logoutAllRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(logoutAllRes.body.data.loggedOutAll).toBe(true);
    expect(logoutAllRes.body.data.revokedCount).toBe(2);

    // 6. Email verification send & confirm (3.2.6)
    const sendEmailVerRes = await context.injectJson<{
      sent: boolean;
      devVerificationCode?: string;
      devVerificationToken?: string;
    }>({
      method: 'POST',
      url: '/api/v1/auth/verify/email/send',
      payload: { email: 'self.email@gmail.com' },
    });
    expect(sendEmailVerRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(sendEmailVerRes.body.data.sent).toBe(true);

    const confirmEmailVerRes = await context.injectJson<{
      verified: boolean;
      channel: string;
      userId: number;
    }>({
      method: 'POST',
      url: '/api/v1/auth/verify/email/confirm',
      payload: {
        email: 'self.email@gmail.com',
        tokenOrCode: sendEmailVerRes.body.data.devVerificationCode,
      },
    });
    expect(confirmEmailVerRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(confirmEmailVerRes.body.data.verified).toBe(true);

    // 7. Phone OTP verification with send count limit (maxSends = 2) and failed attempts limit (maxAttempts = 2) (3.2.7)
    const sendPhoneOtp1 = await context.injectJson<{
      sent: boolean;
      sendCount: number;
      devVerificationCode?: string;
    }>({
      method: 'POST',
      url: '/api/v1/auth/verify/phone/send',
      payload: { phone: '0909888777' },
    });
    expect(sendPhoneOtp1.status).toBe(HTTP_STATUS_CODE.OK);
    expect(sendPhoneOtp1.body.data.sendCount).toBe(1);

    const sendPhoneOtp2 = await context.injectJson<{
      sent: boolean;
      sendCount: number;
      devVerificationCode?: string;
    }>({
      method: 'POST',
      url: '/api/v1/auth/verify/phone/send',
      payload: { phone: '0909888777' },
    });
    expect(sendPhoneOtp2.status).toBe(HTTP_STATUS_CODE.OK);
    expect(sendPhoneOtp2.body.data.sendCount).toBe(2);

    // 3rd send exceeds otpMaxSendCount = 2 -> 403 Forbidden
    const sendPhoneOtp3 = await context.injectJson({
      method: 'POST',
      url: '/api/v1/auth/verify/phone/send',
      payload: { phone: '0909888777' },
    });
    expect(sendPhoneOtp3.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);

    // Wrong OTP attempt 1 -> 400 Bad Request
    const wrongOtp1 = await context.injectJson({
      method: 'POST',
      url: '/api/v1/auth/verify/phone/confirm',
      payload: { phone: '0909888777', code: '000000' },
    });
    expect(wrongOtp1.status).toBe(HTTP_STATUS_CODE.BAD_REQUEST);

    // Wrong OTP attempt 2 reaches maxAttempts = 2 -> 403 Forbidden
    const wrongOtp2 = await context.injectJson({
      method: 'POST',
      url: '/api/v1/auth/verify/phone/confirm',
      payload: { phone: '0909888777', code: '999999' },
    });
    expect(wrongOtp2.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);

    // Increase otpMaxSendCount to issue a fresh OTP and confirm successfully
    await context.injectJson({
      method: 'PUT',
      url: '/api/v1/auth/security-settings',
      payload: { allowEmailRegistration: true, otpMaxSendCount: 5, otpMaxAttempts: 5 },
    });

    const freshPhoneOtp = await context.injectJson<{ devVerificationCode?: string }>({
      method: 'POST',
      url: '/api/v1/auth/verify/phone/send',
      payload: { phone: '0909888777' },
    });
    expect(freshPhoneOtp.status).toBe(HTTP_STATUS_CODE.OK);

    const confirmPhoneRes = await context.injectJson<{ verified: boolean; channel: string }>({
      method: 'POST',
      url: '/api/v1/auth/verify/phone/confirm',
      payload: {
        phone: '0909888777',
        code: freshPhoneOtp.body.data.devVerificationCode,
      },
    });
    expect(confirmPhoneRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(confirmPhoneRes.body.data.verified).toBe(true);
    expect(confirmPhoneRes.body.data.channel).toBe('PHONE_OTP');
  });

  it('Section 3.3 E2E: Suggested password, Password policy & disallowed list, Change password (with requireCurrentPasswordOnChange setting), Password reuse prevention, Forgot/Reset via 6-digit OTP, Admin Reset Password & Session Revocation', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 1. GET /api/v1/auth/password/suggest returns strong passwords respecting policy
    const suggestRes = await context.injectJson<{
      password: string;
      suggestions: string[];
      policy: { minLength: number };
    }>({
      method: 'GET',
      url: '/api/v1/auth/password/suggest?count=4&length=16',
    });
    expect(suggestRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(suggestRes.body.data.suggestions).toHaveLength(4);
    expect(suggestRes.body.data.password).toBe(suggestRes.body.data.suggestions[0]);
    expect(suggestRes.body.data.password.length).toBeGreaterThanOrEqual(16);

    // 2. Configure Section 3.3 password settings via PUT /api/v1/auth/security-settings
    const updateSecRes = await context.injectJson<{
      requireCurrentPasswordOnChange: boolean;
      disallowedPasswords: string[];
      disallowUserInfoInPassword: boolean;
      preventPasswordReuse: boolean;
      passwordHistoryLimit: number;
      revokeSessionsOnPasswordChange: boolean;
    }>({
      method: 'PUT',
      url: '/api/v1/auth/security-settings',
      payload: {
        passwordMinLength: 10,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        requireCurrentPasswordOnChange: true,
        disallowedPasswords: ['qwerty123!', 'company2026!'],
        disallowUserInfoInPassword: true,
        preventPasswordReuse: true,
        passwordHistoryLimit: 3,
        revokeSessionsOnPasswordChange: true,
      },
    });
    expect(updateSecRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updateSecRes.body.data.requireCurrentPasswordOnChange).toBe(true);
    expect(updateSecRes.body.data.preventPasswordReuse).toBe(true);
    expect(updateSecRes.body.data.disallowedPasswords).toContain('company2026!');

    // 3. Register a user and create 2 active sessions
    const regRes = await context.injectJson<{
      accessToken: string;
      user: { id: number; email: string };
    }>({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'sec33.user@gmail.com',
        password: 'First#Password101',
        firstName: 'Kiệt',
        lastName: 'Trương Tuấn',
        deviceName: 'Session 1',
      },
    });
    expect(regRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const userId = regRes.body.data.user.id;
    const userToken1 = regRes.body.data.accessToken;

    const login2Res = await context.injectJson<{ accessToken: string }>({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'sec33.user@gmail.com',
        password: 'First#Password101',
        deviceName: 'Session 2',
      },
    });
    expect(login2Res.status).toBe(HTTP_STATUS_CODE.OK);

    // 4. Reject disallowed password or password containing email prefix
    const disallowedRes = await context.injectJson({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: { authorization: `Bearer ${userToken1}` },
      payload: {
        currentPassword: 'First#Password101',
        newPassword: 'Company2026!',
      },
    });
    expect(disallowedRes.status).toBe(HTTP_STATUS_CODE.BAD_REQUEST);

    const userInfoInPwdRes = await context.injectJson({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: { authorization: `Bearer ${userToken1}` },
      payload: {
        currentPassword: 'First#Password101',
        newPassword: 'Sec33.user#2026',
      },
    });
    expect(userInfoInPwdRes.status).toBe(HTTP_STATUS_CODE.BAD_REQUEST);

    // 5. Change password (requires currentPassword) & revokes other sessions
    const changePwdRes = await context.injectJson<{
      changed: boolean;
      revokedSessionsCount: number;
    }>({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: { authorization: `Bearer ${userToken1}` },
      payload: {
        currentPassword: 'First#Password101',
        newPassword: 'Second#Password202',
      },
    });
    expect(changePwdRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(changePwdRes.body.data.changed).toBe(true);
    expect(changePwdRes.body.data.revokedSessionsCount).toBe(1);

    // 6. Prevent reusing old password ('First#Password101')
    const reuseRes = await context.injectJson({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: { authorization: `Bearer ${userToken1}` },
      payload: {
        currentPassword: 'Second#Password202',
        newPassword: 'First#Password101',
      },
    });
    expect(reuseRes.status).toBe(HTTP_STATUS_CODE.BAD_REQUEST);

    // 7. Forgot password & Reset via 6-digit OTP (revoking all sessions)
    const forgotRes = await context.injectJson<{
      accepted: boolean;
      devResetToken?: string;
      devResetOtp?: string;
    }>({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: 'sec33.user@gmail.com' },
    });
    expect(forgotRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(forgotRes.body.data.devResetOtp).toMatch(/^\d{6}$/);

    const resetViaOtpRes = await context.injectJson<{
      reset: boolean;
      revokedSessionsCount: number;
    }>({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: {
        email: 'sec33.user@gmail.com',
        otpCode: forgotRes.body.data.devResetOtp,
        newPassword: 'Third#Password303',
      },
    });
    expect(resetViaOtpRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(resetViaOtpRes.body.data.reset).toBe(true);
    expect(resetViaOtpRes.body.data.revokedSessionsCount).toBe(1);

    // 8. Admin Reset User Password via POST /api/v1/users/:id/reset-password (requires users.update)
    const adminResetRes = await context.injectJson<{
      reset: boolean;
      userId: number;
      generatedPassword?: string;
      revokedSessionsCount: number;
    }>({
      method: 'POST',
      url: `/api/v1/users/${userId}/reset-password`,
      headers: adminHeaders,
      payload: {
        useSuggestedPassword: true,
        revokeSessions: true,
      },
    });
    expect(adminResetRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(adminResetRes.body.data.reset).toBe(true);
    expect(adminResetRes.body.data.userId).toBe(userId);
    expect(adminResetRes.body.data.generatedPassword).toBeDefined();

    // 9. Automatic password hash algorithm upgrade on login (3.3.6: PBKDF2_SHA512 -> PBKDF2_SHA256)
    expect(userStore.get(userId)?.passwordHash.startsWith('pbkdf2_sha512$')).toBe(true);
    await context.injectJson({
      method: 'PUT',
      url: '/api/v1/auth/security-settings',
      payload: { passwordHashAlgorithm: 'PBKDF2_SHA256' },
    });

    const loginAfterAdminReset = await context.injectJson<{ accessToken: string }>({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'sec33.user@gmail.com',
        password: adminResetRes.body.data.generatedPassword,
      },
    });
    expect(loginAfterAdminReset.status).toBe(HTTP_STATUS_CODE.OK);
    expect(loginAfterAdminReset.body.data.accessToken).toBeDefined();
    expect(userStore.get(userId)?.passwordHash.startsWith('pbkdf2_sha256$')).toBe(true);
  });

  it('Section 3.6 E2E: Service Accounts & API Clients (3.6.1 -> 3.6.7) — create service account, create API client with one-time secret, issue token, enforce scopes on /api/v1/users, rotate secret, enforce IP whitelist, track usage logs, and revoke client tokens immediately', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 1. Create Service Account (3.6.1 — system/job account independent of personal users)
    const createSaRes = await context.injectJson<{
      id: number;
      code: string;
      name: string;
      isServiceAccount: boolean;
      userId: null;
      status: number;
      statusName: string;
      scopes: string[];
    }>({
      method: 'POST',
      url: '/api/v1/auth/service-accounts',
      headers: adminHeaders,
      payload: {
        code: 'crm_webhook_sync',
        name: 'CRM Webhook Sync Job',
        description: 'Service account đồng bộ dữ liệu CRM định kỳ',
        scopes: ['users.read', 'users.export', 'organizations.read'],
      },
    });
    expect(createSaRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createSaRes.body.data.id).toBe(1);
    expect(createSaRes.body.data.code).toBe('CRM_WEBHOOK_SYNC');
    expect(createSaRes.body.data.isServiceAccount).toBe(true);
    expect(createSaRes.body.data.userId).toBeNull();
    expect(createSaRes.body.data.statusName).toBe('ACTIVE');
    expect(createSaRes.body.data.scopes).toEqual([
      'users.read',
      'users.export',
      'organizations.read',
    ]);

    const saId = createSaRes.body.data.id;

    // 2. Create API Client with Client ID, one-time Client Secret, Scopes & IP Whitelist (3.6.2, 3.6.3, 3.6.4, 3.6.6)
    const createClientRes = await context.injectJson<{
      id: number;
      serviceAccountId: number;
      serviceAccountCode: string;
      clientId: string;
      clientSecret: string;
      secretPrefix: string;
      oneTimeSecretWarning: boolean;
      scopes: string[];
      allowedIps: string[];
      status: number;
      statusName: string;
      tokenVersion: number;
    }>({
      method: 'POST',
      url: '/api/v1/auth/api-clients',
      headers: adminHeaders,
      payload: {
        serviceAccountId: saId,
        name: 'CRM Production Server Client',
        description: 'API Client cho máy chủ CRM Production',
        scopes: ['users.read'],
        allowedIps: ['127.0.0.1', '10.50.0.0/16'],
      },
    });
    expect(createClientRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createClientRes.body.data.id).toBe(1);
    expect(createClientRes.body.data.serviceAccountId).toBe(saId);
    expect(createClientRes.body.data.clientId).toMatch(/^cli_[A-Za-z0-9_-]+$/);
    expect(createClientRes.body.data.clientSecret).toMatch(/^cs_[A-Za-z0-9_-]+$/);
    expect(createClientRes.body.data.oneTimeSecretWarning).toBe(true);
    expect(createClientRes.body.data.scopes).toEqual(['users.read']);
    expect(createClientRes.body.data.allowedIps).toEqual(['127.0.0.1', '10.50.0.0/16']);

    const apiClientNumericId = createClientRes.body.data.id;
    const clientId = createClientRes.body.data.clientId;
    const initialSecret = createClientRes.body.data.clientSecret;

    // 3.6.4: Subsequent GET /api/v1/auth/api-clients/:id and GET /api/v1/auth/api-clients NEVER return plain clientSecret
    const getClientRes = await context.injectJson<Record<string, unknown>>({
      method: 'GET',
      url: `/api/v1/auth/api-clients/${apiClientNumericId}`,
      headers: adminHeaders,
    });
    expect(getClientRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(getClientRes.body.data.clientSecret).toBeUndefined();
    expect(getClientRes.body.data.secretPrefix).toBe(`${initialSecret.slice(0, 10)}...`);

    const listClientsRes = await context.injectJson<Array<Record<string, unknown>>>({
      method: 'GET',
      url: `/api/v1/auth/api-clients?serviceAccountId=${saId}`,
      headers: adminHeaders,
    });
    expect(listClientsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(listClientsRes.body.data).toHaveLength(1);
    expect(listClientsRes.body.data[0]?.clientSecret).toBeUndefined();

    // 4. IP Whitelist check on token issuance (3.6.6): request from disallowed IP 198.51.100.77 is rejected (403)
    const tokenDeniedIpRes = await context.injectJson({
      method: 'POST',
      url: '/api/v1/auth/api-clients/token',
      remoteAddress: '198.51.100.77',
      payload: {
        clientId,
        clientSecret: initialSecret,
      },
    });
    expect(tokenDeniedIpRes.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);

    // 5. Issue token from allowed IP in CIDR 10.50.0.0/16 (10.50.12.34)
    const tokenSuccessRes = await context.injectJson<{
      accessToken: string;
      tokenType: string;
      expiresIn: number;
      clientId: string;
      serviceAccountId: number;
      serviceAccountCode: string;
      scopes: string[];
    }>({
      method: 'POST',
      url: '/api/v1/auth/api-clients/token',
      remoteAddress: '10.50.12.34',
      payload: {
        clientId,
        clientSecret: initialSecret,
      },
    });
    expect(tokenSuccessRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(tokenSuccessRes.body.data.accessToken).toBeDefined();
    expect(tokenSuccessRes.body.data.tokenType).toBe('Bearer');
    expect(tokenSuccessRes.body.data.scopes).toEqual(['users.read']);

    const clientAccessToken1 = tokenSuccessRes.body.data.accessToken;

    // 6. Scope Enforcement (3.6.3):
    // Client has 'users.read' -> GET /api/v1/users succeeds (200 OK)
    const clientReadUsersRes = await context.injectJson({
      method: 'GET',
      url: '/api/v1/users',
      remoteAddress: '10.50.12.34',
      headers: { authorization: `Bearer ${clientAccessToken1}` },
    });
    expect(clientReadUsersRes.status).toBe(HTTP_STATUS_CODE.OK);

    // Client does NOT have 'users.export' -> GET /api/v1/users/export is forbidden (403)
    const clientExportForbiddenRes = await context.injectJson({
      method: 'GET',
      url: '/api/v1/users/export',
      remoteAddress: '10.50.12.34',
      headers: { authorization: `Bearer ${clientAccessToken1}` },
    });
    expect(clientExportForbiddenRes.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);

    // Calling GET /api/v1/users with valid token but from disallowed IP 203.0.113.99 -> rejected by AuthGuard (403)
    const clientApiCallDeniedIpRes = await context.injectJson({
      method: 'GET',
      url: '/api/v1/users',
      remoteAddress: '203.0.113.99',
      headers: { authorization: `Bearer ${clientAccessToken1}` },
    });
    expect(clientApiCallDeniedIpRes.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);

    // 7. Grant additional scope 'users.export' to API Client (3.6.3) & Rotate Client Secret (3.6.4)
    const updateScopesRes = await context.injectJson<{ scopes: string[] }>({
      method: 'PUT',
      url: `/api/v1/auth/api-clients/${apiClientNumericId}/scopes`,
      headers: adminHeaders,
      payload: {
        scopes: ['users.read', 'users.export'],
      },
    });
    expect(updateScopesRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updateScopesRes.body.data.scopes).toEqual(['users.read', 'users.export']);

    const rotateSecretRes = await context.injectJson<{
      id: number;
      clientId: string;
      clientSecret: string;
      secretPrefix: string;
      secretRotatedAt: string;
      tokenVersion: number;
      oneTimeSecretWarning: boolean;
    }>({
      method: 'POST',
      url: `/api/v1/auth/api-clients/${apiClientNumericId}/rotate-secret`,
      headers: adminHeaders,
      payload: {
        reason: 'Xoay vòng định kỳ theo chính sách bảo mật',
      },
    });
    expect(rotateSecretRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(rotateSecretRes.body.data.clientSecret).toMatch(/^cs_[A-Za-z0-9_-]+$/);
    expect(rotateSecretRes.body.data.clientSecret).not.toBe(initialSecret);
    expect(rotateSecretRes.body.data.oneTimeSecretWarning).toBe(true);
    expect(rotateSecretRes.body.data.tokenVersion).toBe(2);

    const rotatedSecret = rotateSecretRes.body.data.clientSecret;

    // Old token is immediately invalidated after secret rotation (401 Unauthorized)
    const oldTokenCallRes = await context.injectJson({
      method: 'GET',
      url: '/api/v1/users',
      remoteAddress: '10.50.12.34',
      headers: { authorization: `Bearer ${clientAccessToken1}` },
    });
    expect(oldTokenCallRes.status).toBe(HTTP_STATUS_CODE.UNAUTHORIZED);

    // Issue new token with rotated secret -> now has 'users.export' scope
    const tokenAfterRotateRes = await context.injectJson<{
      accessToken: string;
      scopes: string[];
    }>({
      method: 'POST',
      url: '/api/v1/auth/api-clients/token',
      remoteAddress: '10.50.12.34',
      payload: {
        clientId,
        clientSecret: rotatedSecret,
      },
    });
    expect(tokenAfterRotateRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(tokenAfterRotateRes.body.data.scopes).toEqual(['users.read', 'users.export']);

    const clientAccessToken2 = tokenAfterRotateRes.body.data.accessToken;

    const clientExportAllowedRes = await context.injectJson({
      method: 'GET',
      url: '/api/v1/users/export',
      remoteAddress: '10.50.12.34',
      headers: { authorization: `Bearer ${clientAccessToken2}` },
    });
    expect(clientExportAllowedRes.status).toBe(HTTP_STATUS_CODE.OK);

    // 8. Revoke API Client (3.6.5) -> stops all issued tokens immediately
    const revokeClientRes = await context.injectJson<{
      revoked: boolean;
      statusName: string;
      tokenVersion: number;
    }>({
      method: 'POST',
      url: `/api/v1/auth/api-clients/${apiClientNumericId}/revoke`,
      headers: adminHeaders,
      payload: {
        reason: 'Ngừng kết nối máy chủ CRM cũ',
      },
    });
    expect(revokeClientRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(revokeClientRes.body.data.revoked).toBe(true);
    expect(revokeClientRes.body.data.statusName).toBe('REVOKED');
    expect(revokeClientRes.body.data.tokenVersion).toBe(3);

    // Active token is immediately rejected after revocation (401 Unauthorized)
    const callAfterRevokeRes = await context.injectJson({
      method: 'GET',
      url: '/api/v1/users',
      remoteAddress: '10.50.12.34',
      headers: { authorization: `Bearer ${clientAccessToken2}` },
    });
    expect(callAfterRevokeRes.status).toBe(HTTP_STATUS_CODE.UNAUTHORIZED);

    // 9. Inspect recent usage tracking (3.6.7 — records IP, timestamp, result, endpoint & history)
    const usageRes = await context.injectJson<{
      id: number;
      clientId: string;
      lastUsedAt: string;
      lastUsedIp: string;
      lastUsedResult: string;
      lastUsedEndpoint: string;
      logs: Array<{
        timestamp: string;
        ipAddress: string | null;
        result: string;
        endpoint?: string | null;
      }>;
    }>({
      method: 'GET',
      url: `/api/v1/auth/api-clients/${apiClientNumericId}/usage`,
      headers: adminHeaders,
    });
    expect(usageRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(usageRes.body.data.clientId).toBe(clientId);
    expect(usageRes.body.data.lastUsedAt).toBeDefined();
    expect(usageRes.body.data.lastUsedIp).toBe('10.50.12.34');
    expect(usageRes.body.data.lastUsedResult).toBe('CLIENT_REVOKED');
    expect(usageRes.body.data.logs.length).toBeGreaterThanOrEqual(5);
  });
});

