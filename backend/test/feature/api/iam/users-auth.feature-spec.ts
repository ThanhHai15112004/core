import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import { TransactionManager } from '@packages/database/index.js';
import {
  PasswordHasherService,
  PlatformSecurityService,
  TotpService,
} from '@packages/security/index.js';
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
import type { AuthVerificationCodeEntity } from '@modules/auth/entities/auth-verification-code.entity.js';
import type { AuthServiceAccountEntity } from '@modules/auth/entities/auth-service-account.entity.js';
import type { AuthApiClientEntity } from '@modules/auth/entities/auth-api-client.entity.js';
import type { AuthLoginHistoryEntity } from '@modules/auth/entities/auth-login-history.entity.js';
import { AuthSessionRepository } from '@modules/auth/repositories/auth-session.repository.js';
import { AuthMfaConfigRepository } from '@modules/auth/repositories/auth-mfa-config.repository.js';
import { AuthPasswordResetRepository } from '@modules/auth/repositories/auth-password-reset.repository.js';
import { AuthSecuritySettingRepository } from '@modules/auth/repositories/auth-security-setting.repository.js';
import { AuthVerificationCodeRepository } from '@modules/auth/repositories/auth-verification-code.repository.js';
import { AuthServiceAccountRepository } from '@modules/auth/repositories/auth-service-account.repository.js';
import { AuthApiClientRepository } from '@modules/auth/repositories/auth-api-client.repository.js';
import { AuthLoginHistoryRepository } from '@modules/auth/repositories/auth-login-history.repository.js';
import { CODE_ITEM_STATUS } from '@packages/kernel/index.js';
import type { CodeTypeEntity } from '@modules/codes/entities/code-type.entity.js';
import type { CodeValueEntity } from '@modules/codes/entities/code-value.entity.js';
import { CodeTypeRepository } from '@modules/codes/repositories/code-type.repository.js';
import { CodeValueRepository } from '@modules/codes/repositories/code-value.repository.js';

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
      findFiltered: async (filter?: { parentId?: number | null }) => {
        const all = [...orgStore.values()];
        if (filter?.parentId !== undefined) {
          return all.filter((o) => Number(o.parentId) === Number(filter.parentId));
        }
        return all;
      },
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
      saveEntity: async (partial: Partial<PermissionEntity>) => {
        const now = new Date();
        const existing = partial.id
          ? permStore.get(Number(partial.id))
          : [...permStore.values()].find((p) => p.code === partial.code);
        const entity: PermissionEntity = {
          id: partial.id ?? existing?.id ?? ++permSeq,
          code: (partial.code ?? existing!.code).trim().toLowerCase(),
          name: partial.name ?? existing?.name ?? partial.code ?? '',
          module: partial.module ?? existing?.module ?? 'core',
          description:
            partial.description !== undefined
              ? partial.description
              : (existing?.description ?? null),
          status: partial.status ?? existing?.status ?? PERMISSION_STATUS.ACTIVE,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        } as PermissionEntity;
        permStore.set(entity.id, entity);
        return entity;
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
          preferredLocale: partial.preferredLocale ?? existing?.preferredLocale ?? 'vi',
          preferredTimezone:
            partial.preferredTimezone ?? existing?.preferredTimezone ?? 'Asia/Ho_Chi_Minh',
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
          failedLoginAttempts: partial.failedLoginAttempts ?? existing?.failedLoginAttempts ?? 0,
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
      findByRoleIds: async (roleIds: readonly number[]) => {
        const set = new Set(roleIds.map(Number));
        return userRoleStore.filter((ur) => set.has(ur.roleId));
      },
      findUserIdsByRoleIds: async (roleIds: readonly number[]) => {
        const set = new Set(roleIds.map(Number));
        return [
          ...new Set(userRoleStore.filter((ur) => set.has(ur.roleId)).map((ur) => ur.userId)),
        ];
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
        statusHistoryStore.filter((h) => h.userId === Number(userId)).sort((a, b) => b.id - a.id),
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
            partial.mfaPolicy ?? globalSecuritySetting?.mfaPolicy ?? MFA_POLICY_CODE.OPTIONAL,
          allowedMfaMethodsJson:
            partial.allowedMfaMethodsJson ??
            globalSecuritySetting?.allowedMfaMethodsJson ??
            '["TOTP","EMAIL_OTP","RECOVERY_CODE"]',
          maxFailedLoginAttempts:
            partial.maxFailedLoginAttempts ?? globalSecuritySetting?.maxFailedLoginAttempts ?? 5,
          lockoutDurationMinutes:
            partial.lockoutDurationMinutes ?? globalSecuritySetting?.lockoutDurationMinutes ?? 15,
          passwordMinLength:
            partial.passwordMinLength ?? globalSecuritySetting?.passwordMinLength ?? 8,
          requireUppercase:
            partial.requireUppercase ?? globalSecuritySetting?.requireUppercase ?? true,
          requireNumbers: partial.requireNumbers ?? globalSecuritySetting?.requireNumbers ?? true,
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
            partial.preventPasswordReuse ?? globalSecuritySetting?.preventPasswordReuse ?? true,
          passwordHistoryLimit:
            partial.passwordHistoryLimit ?? globalSecuritySetting?.passwordHistoryLimit ?? 5,
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
          otpMaxSendCount: partial.otpMaxSendCount ?? globalSecuritySetting?.otpMaxSendCount ?? 5,
          otpMaxAttempts: partial.otpMaxAttempts ?? globalSecuritySetting?.otpMaxAttempts ?? 5,
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
    });

    let verificationSeq = 0;
    const verificationStore = new Map<number, AuthVerificationCodeEntity>();
    const verificationRepo = context.moduleFixture.get(AuthVerificationCodeRepository, {
      strict: false,
    });
    Object.assign(verificationRepo, {
      findLatestUnverified: async (userId: number, channel: number, purpose: number) =>
        [...verificationStore.values()]
          .filter(
            (r) =>
              Number(r.userId) === Number(userId) &&
              r.channel === channel &&
              r.purpose === purpose &&
              !r.verifiedAt,
          )
          .sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null,
      findByCodeHash: async (codeHash: string, channel: number) =>
        [...verificationStore.values()]
          .filter(
            (r) =>
              r.channel === channel && !r.verifiedAt && r.codeHash.split(':').includes(codeHash),
          )
          .sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null,
      saveEntity: async (partial: Partial<AuthVerificationCodeEntity>) => {
        const now = new Date();
        const existing = partial.id ? verificationStore.get(Number(partial.id)) : undefined;
        const entity = {
          id: partial.id ?? existing?.id ?? ++verificationSeq,
          userId: Number(partial.userId ?? existing?.userId ?? 0),
          channel: partial.channel ?? existing?.channel ?? 1,
          purpose: partial.purpose ?? existing?.purpose ?? 1,
          target: partial.target ?? existing?.target ?? '',
          codeHash: partial.codeHash ?? existing?.codeHash ?? '',
          attemptCount: partial.attemptCount ?? existing?.attemptCount ?? 0,
          maxAttempts: partial.maxAttempts ?? existing?.maxAttempts ?? 5,
          sendCount: partial.sendCount ?? existing?.sendCount ?? 1,
          maxSends: partial.maxSends ?? existing?.maxSends ?? 5,
          lastSentAt: partial.lastSentAt ?? existing?.lastSentAt ?? now,
          expiresAt: partial.expiresAt ?? existing?.expiresAt ?? now,
          verifiedAt:
            partial.verifiedAt !== undefined ? partial.verifiedAt : (existing?.verifiedAt ?? null),
          requestedIp:
            partial.requestedIp !== undefined
              ? partial.requestedIp
              : (existing?.requestedIp ?? null),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        } as AuthVerificationCodeEntity;
        verificationStore.set(Number(entity.id), entity);
        return entity;
      },
    });

    let saSeq = 0;
    const saStore = new Map<number, AuthServiceAccountEntity>();
    const serviceAccountRepo = context.moduleFixture.get(AuthServiceAccountRepository, {
      strict: false,
    });
    Object.assign(serviceAccountRepo, {
      findById: async (id: number) => saStore.get(Number(id)) ?? null,
      findByCode: async (code: string) =>
        [...saStore.values()].find((sa) => sa.code === code.trim().toUpperCase()) ?? null,
      findAllOrdered: async () => [...saStore.values()].sort((a, b) => Number(a.id) - Number(b.id)),
      saveEntity: async (partial: Partial<AuthServiceAccountEntity>) => {
        const now = new Date();
        const existing = partial.id ? saStore.get(Number(partial.id)) : undefined;
        const entity = {
          id: partial.id ?? existing?.id ?? ++saSeq,
          code: partial.code ?? existing?.code ?? '',
          name: partial.name ?? existing?.name ?? '',
          description:
            partial.description !== undefined
              ? partial.description
              : (existing?.description ?? null),
          status: partial.status ?? existing?.status ?? SERVICE_ACCOUNT_STATUS.ACTIVE,
          scopesJson: partial.scopesJson ?? existing?.scopesJson ?? '[]',
          createdBy:
            partial.createdBy !== undefined ? partial.createdBy : (existing?.createdBy ?? null),
          lastUsedAt:
            partial.lastUsedAt !== undefined ? partial.lastUsedAt : (existing?.lastUsedAt ?? null),
          lastUsedIp:
            partial.lastUsedIp !== undefined ? partial.lastUsedIp : (existing?.lastUsedIp ?? null),
          lastUsedResult:
            partial.lastUsedResult !== undefined
              ? partial.lastUsedResult
              : (existing?.lastUsedResult ?? null),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        } as AuthServiceAccountEntity;
        saStore.set(Number(entity.id), entity);
        return entity;
      },
    });

    let apiClientSeq = 0;
    const apiClientStore = new Map<number, AuthApiClientEntity>();
    const apiClientRepo = context.moduleFixture.get(AuthApiClientRepository, { strict: false });
    Object.assign(apiClientRepo, {
      findById: async (id: number) => apiClientStore.get(Number(id)) ?? null,
      findByClientId: async (clientId: string) =>
        [...apiClientStore.values()].find((c) => c.clientId === clientId.trim()) ?? null,
      findByServiceAccountId: async (serviceAccountId: number) =>
        [...apiClientStore.values()]
          .filter((c) => Number(c.serviceAccountId) === Number(serviceAccountId))
          .sort((a, b) => Number(a.id) - Number(b.id)),
      findAllOrdered: async () =>
        [...apiClientStore.values()].sort((a, b) => Number(a.id) - Number(b.id)),
      saveEntity: async (partial: Partial<AuthApiClientEntity>) => {
        const now = new Date();
        const existing = partial.id ? apiClientStore.get(Number(partial.id)) : undefined;
        const entity = {
          id: partial.id ?? existing?.id ?? ++apiClientSeq,
          serviceAccountId: Number(partial.serviceAccountId ?? existing?.serviceAccountId ?? 0),
          name: partial.name ?? existing?.name ?? '',
          description:
            partial.description !== undefined
              ? partial.description
              : (existing?.description ?? null),
          clientId: partial.clientId ?? existing?.clientId ?? '',
          clientSecretHash: partial.clientSecretHash ?? existing?.clientSecretHash ?? '',
          secretPrefix: partial.secretPrefix ?? existing?.secretPrefix ?? '',
          scopesJson: partial.scopesJson ?? existing?.scopesJson ?? '[]',
          allowedIpsJson: partial.allowedIpsJson ?? existing?.allowedIpsJson ?? '[]',
          status: partial.status ?? existing?.status ?? API_CLIENT_STATUS.ACTIVE,
          tokenVersion: partial.tokenVersion ?? existing?.tokenVersion ?? 1,
          secretRotatedAt:
            partial.secretRotatedAt !== undefined
              ? partial.secretRotatedAt
              : (existing?.secretRotatedAt ?? null),
          revokedAt:
            partial.revokedAt !== undefined ? partial.revokedAt : (existing?.revokedAt ?? null),
          revokedReason:
            partial.revokedReason !== undefined
              ? partial.revokedReason
              : (existing?.revokedReason ?? null),
          lastUsedAt:
            partial.lastUsedAt !== undefined ? partial.lastUsedAt : (existing?.lastUsedAt ?? null),
          lastUsedIp:
            partial.lastUsedIp !== undefined ? partial.lastUsedIp : (existing?.lastUsedIp ?? null),
          lastUsedResult:
            partial.lastUsedResult !== undefined
              ? partial.lastUsedResult
              : (existing?.lastUsedResult ?? null),
          lastUsedEndpoint:
            partial.lastUsedEndpoint !== undefined
              ? partial.lastUsedEndpoint
              : (existing?.lastUsedEndpoint ?? null),
          usageLogsJson: partial.usageLogsJson ?? existing?.usageLogsJson ?? '[]',
          createdBy:
            partial.createdBy !== undefined ? partial.createdBy : (existing?.createdBy ?? null),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        } as AuthApiClientEntity;
        apiClientStore.set(Number(entity.id), entity);
        return entity;
      },
    });

    let loginHistorySeq = 0;
    const loginHistoryStore: AuthLoginHistoryEntity[] = [];
    const loginHistoryRepo = context.moduleFixture.get(AuthLoginHistoryRepository, {
      strict: false,
    });
    Object.assign(loginHistoryRepo, {
      recordEvent: async (input: Partial<AuthLoginHistoryEntity>) => {
        const now = new Date();
        const entry = {
          id: ++loginHistorySeq,
          userId: input.userId ?? null,
          sessionId: input.sessionId ?? null,
          identifier: input.identifier ?? null,
          eventType: input.eventType!,
          status: input.status!,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          deviceName: input.deviceName ?? null,
          reason: input.reason ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        } as AuthLoginHistoryEntity;
        loginHistoryStore.unshift(entry);
        return entry;
      },
      findByUserId: async (userId: number, limit = 50) =>
        loginHistoryStore.filter((h) => Number(h.userId) === Number(userId)).slice(0, limit),
    });

    let codeTypeSeq = 0;
    let codeValueSeq = 0;
    const codeTypeStore = new Map<string, CodeTypeEntity>();
    const codeValueStore = new Map<number, CodeValueEntity>();

    const codeTypeRepo = context.moduleFixture.get(CodeTypeRepository, { strict: false });
    Object.assign(codeTypeRepo, {
      findByCode: async (code: string) => codeTypeStore.get(code.trim().toLowerCase()) ?? null,
      findFiltered: async (params?: { module?: string; search?: string }) => {
        let list = [...codeTypeStore.values()];
        if (params?.module) {
          list = list.filter((t) => t.module === params.module!.trim().toLowerCase());
        }
        if (params?.search) {
          const kw = params.search.trim().toLowerCase();
          list = list.filter(
            (t) => t.code.toLowerCase().includes(kw) || t.name.toLowerCase().includes(kw),
          );
        }
        return list;
      },
      saveEntity: async (partial: Partial<CodeTypeEntity>) => {
        const now = new Date();
        const norm = partial.code!.trim().toLowerCase();
        const existing = codeTypeStore.get(norm);
        const entity: CodeTypeEntity = {
          id: existing?.id ?? ++codeTypeSeq,
          code: norm,
          module: partial.module ?? existing?.module ?? 'core',
          name: partial.name ?? existing?.name ?? norm,
          description:
            partial.description !== undefined
              ? partial.description
              : (existing?.description ?? null),
          isSystem: partial.isSystem ?? existing?.isSystem ?? true,
          allowCustomValues: partial.allowCustomValues ?? existing?.allowCustomValues ?? true,
          status: partial.status ?? existing?.status ?? CODE_ITEM_STATUS.ACTIVE,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        } as CodeTypeEntity;
        codeTypeStore.set(norm, entity);
        return entity;
      },
    });

    const codeValueRepo = context.moduleFixture.get(CodeValueRepository, { strict: false });
    Object.assign(codeValueRepo, {
      findByTypeCode: async (typeCode: string, includeInactive = false) => {
        const norm = typeCode.trim().toLowerCase();
        return [...codeValueStore.values()]
          .filter(
            (v) =>
              v.typeCode === norm &&
              !v.deletedAt &&
              (includeInactive || v.status === CODE_ITEM_STATUS.ACTIVE),
          )
          .sort((a, b) => a.sortOrder - b.sortOrder || a.numericCode - b.numericCode);
      },
      findAllOrdered: async (includeInactive = true) =>
        [...codeValueStore.values()].filter(
          (v) => !v.deletedAt && (includeInactive || v.status === CODE_ITEM_STATUS.ACTIVE),
        ),
      findByTypeAndNumericCode: async (typeCode: string, numericCode: number) => {
        const norm = typeCode.trim().toLowerCase();
        return (
          [...codeValueStore.values()].find(
            (v) =>
              v.typeCode === norm && Number(v.numericCode) === Number(numericCode) && !v.deletedAt,
          ) ?? null
        );
      },
      saveEntity: async (partial: Partial<CodeValueEntity>) => {
        const now = new Date();
        const existing = partial.id ? codeValueStore.get(Number(partial.id)) : undefined;
        const entity: CodeValueEntity = {
          id: existing?.id ?? ++codeValueSeq,
          typeCode: partial.typeCode ?? existing!.typeCode,
          numericCode: Number(partial.numericCode ?? existing!.numericCode),
          code: partial.code ?? existing!.code,
          behaviorCode:
            partial.behaviorCode !== undefined
              ? partial.behaviorCode
              : (existing?.behaviorCode ?? null),
          name: partial.name ?? existing!.name,
          description:
            partial.description !== undefined
              ? partial.description
              : (existing?.description ?? null),
          labelsJson:
            partial.labelsJson !== undefined ? partial.labelsJson : (existing?.labelsJson ?? null),
          aliasesJson:
            partial.aliasesJson !== undefined
              ? partial.aliasesJson
              : (existing?.aliasesJson ?? null),
          color: partial.color !== undefined ? partial.color : (existing?.color ?? null),
          icon: partial.icon !== undefined ? partial.icon : (existing?.icon ?? null),
          sortOrder: partial.sortOrder ?? existing?.sortOrder ?? 0,
          isDefault: partial.isDefault ?? existing?.isDefault ?? false,
          isSystem: partial.isSystem ?? existing?.isSystem ?? false,
          metadataJson:
            partial.metadataJson !== undefined
              ? partial.metadataJson
              : (existing?.metadataJson ?? null),
          status: partial.status ?? existing?.status ?? CODE_ITEM_STATUS.ACTIVE,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        } as CodeValueEntity;
        codeValueStore.set(entity.id, entity);
        return entity;
      },
    });
    Object.defineProperty(codeValueRepo, 'repository', {
      configurable: true,
      get: () => ({
        softDelete: async (id: number) => {
          codeValueStore.delete(Number(id));
        },
      }),
    });

    // Seed super_admin role (ID = 1), permissions (ID = 1..12) & superadmin@gmail.com (ID = 1) with password !P@ssw0rd#
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
      'codes.read',
      'codes.manage',
      'settings.read',
      'settings.manage',
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
      url: '/api/v1/imports/users',
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
      url: '/api/v1/exports/users',
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
      payload: { passwordHashAlgorithm: 'PBKDF2_SHA256', passwordMinLength: 8 },
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

    // Client does NOT have 'users.export' -> GET /api/v1/exports/users is forbidden (403)
    const clientExportForbiddenRes = await context.injectJson({
      method: 'GET',
      url: '/api/v1/exports/users',
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
      url: '/api/v1/exports/users',
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

  it('supports Section 4.1 Role Management E2E: create, update name/desc, set permissions, clone role, list assigned users, lock system role & prevent deleting assigned role', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 1. Tạo mới vai trò tùy chỉnh (Student)
    const createStudentRoleRes = await context.injectJson<{
      id: number;
      code: string;
      name: string;
      description: string | null;
      isSystem: boolean;
      permissions: string[];
      userCount: number;
    }>({
      method: 'POST',
      url: '/api/v1/roles',
      headers: adminHeaders,
      payload: {
        code: 'student_role',
        name: 'Student Role',
        description: 'Vai trò học viên',
        permissions: ['users.read'],
      },
    });
    expect(createStudentRoleRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const studentRoleId = createStudentRoleRes.body.data.id;
    expect(createStudentRoleRes.body.data.code).toBe('student_role');
    expect(createStudentRoleRes.body.data.isSystem).toBe(false);
    expect(createStudentRoleRes.body.data.userCount).toBe(0);

    // 2. Cập nhật tên và mô tả vai trò (PATCH /api/v1/roles/:id)
    const updateRoleRes = await context.injectJson<{
      id: number;
      code: string;
      name: string;
      description: string | null;
    }>({
      method: 'PATCH',
      url: `/api/v1/roles/${studentRoleId}`,
      headers: adminHeaders,
      payload: {
        name: 'Student Role Updated',
        description: 'Mô tả học viên đã cập nhật',
      },
    });
    expect(updateRoleRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updateRoleRes.body.data.code).toBe('student_role');
    expect(updateRoleRes.body.data.name).toBe('Student Role Updated');
    expect(updateRoleRes.body.data.description).toBe('Mô tả học viên đã cập nhật');

    // 3. Gán quyền cho vai trò (PUT /api/v1/roles/:id/permissions)
    const setPermsRes = await context.injectJson<{
      id: number;
      permissions: string[];
    }>({
      method: 'PUT',
      url: `/api/v1/roles/${studentRoleId}/permissions`,
      headers: adminHeaders,
      payload: {
        permissions: ['users.read', 'organizations.read'],
      },
    });
    expect(setPermsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(setPermsRes.body.data.permissions).toEqual(['users.read', 'organizations.read']);

    // 4. Sao chép vai trò (POST /api/v1/roles/:id/clone)
    const cloneRoleRes = await context.injectJson<{
      id: number;
      code: string;
      name: string;
      description: string | null;
      isSystem: boolean;
      permissions: string[];
      userCount: number;
    }>({
      method: 'POST',
      url: `/api/v1/roles/${studentRoleId}/clone`,
      headers: adminHeaders,
      payload: {
        code: 'student_vip_role',
        name: 'Student VIP Role',
      },
    });
    expect(cloneRoleRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const clonedRoleId = cloneRoleRes.body.data.id;
    expect(clonedRoleId).not.toBe(studentRoleId);
    expect(cloneRoleRes.body.data.code).toBe('student_vip_role');
    expect(cloneRoleRes.body.data.isSystem).toBe(false);
    expect(cloneRoleRes.body.data.permissions).toEqual(['users.read', 'organizations.read']);

    // 5. Gán nhiều vai trò cho người dùng và kiểm tra danh sách người đang sử dụng vai trò (GET /api/v1/roles/:id/users)
    const createUserRes = await context.injectJson<{ id: number; roles: Array<{ code: string }> }>({
      method: 'POST',
      url: '/api/v1/users',
      headers: adminHeaders,
      payload: {
        email: 'student.clone.test@gmail.com',
        username: 'student_clone_01',
        firstName: 'Lan',
        lastName: 'Nguyễn Thị',
        password: 'Password@123',
        roleIds: [studentRoleId, clonedRoleId],
      },
    });
    expect(createUserRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const createdUserId = createUserRes.body.data.id;
    expect(createUserRes.body.data.roles.map((r) => r.code).sort()).toEqual([
      'student_role',
      'student_vip_role',
    ]);

    const roleUsersRes = await context.injectJson<
      Array<{ id: number; username: string; email: string; fullName: string }>
    >({
      method: 'GET',
      url: `/api/v1/roles/${clonedRoleId}/users`,
      headers: adminHeaders,
    });
    expect(roleUsersRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(roleUsersRes.body.data).toHaveLength(1);
    expect(roleUsersRes.body.data[0]?.id).toBe(createdUserId);
    expect(roleUsersRes.body.data[0]?.email).toBe('student.clone.test@gmail.com');

    // 6. Chặn xóa vai trò khi đang có người dùng sử dụng (409 Conflict)
    const deleteInUseRes = await context.injectJson({
      method: 'DELETE',
      url: `/api/v1/roles/${clonedRoleId}`,
      headers: adminHeaders,
    });
    expect(deleteInUseRes.status).toBe(HTTP_STATUS_CODE.CONFLICT);

    // Gỡ vai trò clonedRole khỏi người dùng -> xóa thành công
    const reassignRes = await context.injectJson({
      method: 'PUT',
      url: `/api/v1/users/${createdUserId}/roles`,
      headers: adminHeaders,
      payload: {
        roleIds: [studentRoleId],
      },
    });
    expect(reassignRes.status).toBe(HTTP_STATUS_CODE.OK);

    const deleteFreeRoleRes = await context.injectJson<{ deleted: boolean; id: number }>({
      method: 'DELETE',
      url: `/api/v1/roles/${clonedRoleId}`,
      headers: adminHeaders,
    });
    expect(deleteFreeRoleRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(deleteFreeRoleRes.body.data.deleted).toBe(true);

    // 7. Khóa vai trò hệ thống (adminRoleId có isSystem = true): chặn xóa (403 Forbidden)
    const deleteSystemRoleRes = await context.injectJson({
      method: 'DELETE',
      url: `/api/v1/roles/${adminRoleId}`,
      headers: adminHeaders,
    });
    expect(deleteSystemRoleRes.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);
  });

  it('supports Section 4.2 Permission Management E2E: module permission sync (idempotent), grouped permissions, orphan warnings, role-permission matrix & server-side API permission enforcement', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 1. Đồng bộ quyền khi thêm module mới 'lms_courses' (POST /api/v1/roles/permissions/sync)
    const syncRes1 = await context.injectJson<{
      totalDeclared: number;
      createdCount: number;
      updatedCount: number;
      unchangedCount: number;
      orphanedCount: number;
      syncedModules: string[];
    }>({
      method: 'POST',
      url: '/api/v1/roles/permissions/sync',
      headers: adminHeaders,
      payload: {
        modules: [
          {
            module: 'lms_courses',
            displayName: 'LMS Courses',
            permissions: [
              {
                code: 'lms_courses.read',
                name: 'Xem khóa học LMS',
                featureGroup: 'lms_courses.catalog',
              },
              {
                code: 'lms_courses.grading.manage',
                name: 'Chấm điểm học viên',
                featureGroup: 'lms_courses.grading',
              },
            ],
          },
        ],
      },
    });
    expect(syncRes1.status).toBe(HTTP_STATUS_CODE.OK);
    expect(syncRes1.body.data.syncedModules).toContain('lms_courses');
    expect(syncRes1.body.data.totalDeclared).toBeGreaterThanOrEqual(19);

    // Gọi sync lần 2 với cùng module -> Idempotent (không tạo trùng quyền: createdCount = 0)
    const syncRes2 = await context.injectJson<{
      totalDeclared: number;
      createdCount: number;
      unchangedCount: number;
    }>({
      method: 'POST',
      url: '/api/v1/roles/permissions/sync',
      headers: adminHeaders,
      payload: {},
    });
    expect(syncRes2.status).toBe(HTTP_STATUS_CODE.OK);
    expect(syncRes2.body.data.createdCount).toBe(0);
    expect(syncRes2.body.data.unchangedCount).toBe(syncRes1.body.data.totalDeclared);

    // 2. Nhóm quyền theo chức năng (GET /api/v1/roles/permissions/grouped)
    const groupedRes = await context.injectJson<
      Array<{
        module: string;
        moduleDisplayName: string;
        featureGroup: string;
        totalPermissions: number;
        permissions: Array<{ code: string; featureGroup: string; isOrphaned: boolean }>;
      }>
    >({
      method: 'GET',
      url: '/api/v1/roles/permissions/grouped',
      headers: adminHeaders,
    });
    expect(groupedRes.status).toBe(HTTP_STATUS_CODE.OK);
    const lmsGradingGroup = groupedRes.body.data.find(
      (g) => g.featureGroup === 'lms_courses.grading',
    );
    expect(lmsGradingGroup).toBeDefined();
    expect(lmsGradingGroup?.module).toBe('lms_courses');
    expect(lmsGradingGroup?.moduleDisplayName).toBe('LMS Courses');
    expect(lmsGradingGroup?.permissions.map((p) => p.code)).toEqual(['lms_courses.grading.manage']);

    // 3. Tạo vai trò chỉ có quyền đọc ('roles.read', 'users.read') kèm 1 quyền rác ('deprecated_module.write')
    const viewerRoleRes = await context.injectJson<{ id: number; code: string }>({
      method: 'POST',
      url: '/api/v1/roles',
      headers: adminHeaders,
      payload: {
        code: 'permission_viewer',
        name: 'Permission Viewer',
        permissions: ['roles.read', 'users.read', 'deprecated_module.write'],
      },
    });
    expect(viewerRoleRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    const viewerRoleId = viewerRoleRes.body.data.id;

    // 4. Cảnh báo quyền không còn module sử dụng (GET /api/v1/roles/permissions/orphans)
    const orphansRes = await context.injectJson<
      Array<{
        code: string;
        module: string;
        assignedRoles: Array<{ id: number; code: string }>;
        warningMessage: string;
      }>
    >({
      method: 'GET',
      url: '/api/v1/roles/permissions/orphans',
      headers: adminHeaders,
    });
    expect(orphansRes.status).toBe(HTTP_STATUS_CODE.OK);
    const deprecatedOrphan = orphansRes.body.data.find((o) => o.code === 'deprecated_module.write');
    expect(deprecatedOrphan).toBeDefined();
    expect(deprecatedOrphan?.assignedRoles.map((r) => r.code)).toContain('permission_viewer');

    // 5. Bảng tổng hợp ma trận Vai trò × Quyền (GET /api/v1/roles/permissions/matrix)
    const matrixRes = await context.injectJson<{
      roles: Array<{ id: number; code: string; totalGrantedPermissions: number }>;
      modules: string[];
      rows: Array<{
        code: string;
        isOrphaned: boolean;
        grantedRoleCodes: string[];
        roleGrants: Record<string, boolean>;
      }>;
      summary: {
        totalRoles: number;
        totalPermissions: number;
        totalOrphanedPermissions: number;
      };
    }>({
      method: 'GET',
      url: '/api/v1/roles/permissions/matrix',
      headers: adminHeaders,
    });
    expect(matrixRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(matrixRes.body.data.summary.totalRoles).toBeGreaterThanOrEqual(2);
    expect(matrixRes.body.data.summary.totalOrphanedPermissions).toBeGreaterThanOrEqual(1);
    const orphanMatrixRow = matrixRes.body.data.rows.find(
      (r) => r.code === 'deprecated_module.write',
    );
    expect(orphanMatrixRow?.isOrphaned).toBe(true);
    expect(orphanMatrixRow?.roleGrants['permission_viewer']).toBe(true);

    // 6. Kiểm tra quyền tại API (không tin quyền do frontend gửi lên) & dữ liệu permission cho Frontend (/auth/me)
    const createViewerUserRes = await context.injectJson<{ id: number }>({
      method: 'POST',
      url: '/api/v1/users',
      headers: adminHeaders,
      payload: {
        email: 'viewer42@gmail.com',
        username: 'viewer42',
        firstName: 'Vinh',
        lastName: 'Lê',
        password: 'Password@123',
        roleIds: [viewerRoleId],
      },
    });
    expect(createViewerUserRes.status).toBe(HTTP_STATUS_CODE.CREATED);

    const viewerLoginRes = await context.injectJson<{ accessToken: string }>({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identifier: 'viewer42@gmail.com',
        password: 'Password@123',
      },
    });
    expect(viewerLoginRes.status).toBe(HTTP_STATUS_CODE.OK);
    const viewerToken = viewerLoginRes.body.data.accessToken;

    // Frontend lấy danh sách quyền thực tế của user từ GET /api/v1/auth/me để ẩn/khóa nút
    const meRes = await context.injectJson<{
      id: number;
      permissions: string[];
      roles: Array<{ code: string }>;
    }>({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(meRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(meRes.body.data.permissions).toEqual(
      expect.arrayContaining(['roles.read', 'users.read']),
    );
    expect(meRes.body.data.permissions).not.toContain('roles.manage');

    // Dù Frontend giả mạo header quyền 'roles.manage', API vẫn chặn 403 Forbidden vì kiểm tra từ DB/Session tại Backend
    const forgedSyncAttempt = await context.injectJson({
      method: 'POST',
      url: '/api/v1/roles/permissions/sync',
      headers: {
        authorization: `Bearer ${viewerToken}`,
        'x-permissions': 'roles.manage,super_admin',
        'x-user-permissions': '["roles.manage"]',
      },
      payload: {},
    });
    expect(forgedSyncAttempt.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);
  });

  it('supports Section 4.5 Platform Security & Login/Logout Audit E2E (4.5.1 -> 4.5.8): Security Headers, CORS Allowlist, 3D Rate Limit (429), Input Sanitization, Login/Logout Audit (auth_login_history + audit_logs), Security Events & SIEM Anomaly Alerts', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };
    const platformSecurity = context.moduleFixture.get(PlatformSecurityService, {
      strict: false,
    });

    // 1. Security Headers (4.5.1) & Rate Limit Headers (4.5.3) on HTTP response
    const meWithHeaders = await context.injectJson({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: adminHeaders,
    });
    expect(meWithHeaders.status).toBe(HTTP_STATUS_CODE.OK);
    expect(meWithHeaders.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(meWithHeaders.headers['x-frame-options']).toBe('DENY');
    expect(meWithHeaders.headers['x-content-type-options']).toBe('nosniff');
    expect(meWithHeaders.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(meWithHeaders.headers['permissions-policy']).toContain('camera=()');
    expect(meWithHeaders.headers['x-ratelimit-limit']).toBeDefined();
    expect(meWithHeaders.headers['x-ratelimit-remaining']).toBeDefined();

    // 2. CORS Allowlist (4.5.2): Whitelisted domain gets Access-Control-Allow-Origin, unknown domain is blocked on preflight OPTIONS (403)
    platformSecurity.setAllowedOrigins(['https://console.enterprise.vn']);

    const allowedCorsRes = await context.injectJson({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        ...adminHeaders,
        origin: 'https://console.enterprise.vn',
      },
    });
    expect(allowedCorsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(allowedCorsRes.headers['access-control-allow-origin']).toBe(
      'https://console.enterprise.vn',
    );

    const blockedCorsPreflight = await context.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/me',
      headers: {
        origin: 'https://malicious-domain.org',
        'access-control-request-method': 'GET',
      },
    });
    expect(blockedCorsPreflight.statusCode).toBe(HTTP_STATUS_CODE.FORBIDDEN);
    expect(blockedCorsPreflight.headers['access-control-allow-origin']).toBeUndefined();

    // 3. Input Validation & Sanitization (4.5.4): Strip <script>, javascript:, and inline event handlers
    const sanitizedUserRes = await context.injectJson<{
      id: number;
      firstName: string;
      lastName: string;
      fullName: string;
      profile?: { bio: string | null };
    }>({
      method: 'POST',
      url: '/api/v1/users',
      headers: adminHeaders,
      payload: {
        email: 'sec45.e2e@gmail.com',
        username: 'sec45_e2e',
        firstName: 'Minh<script>alert("xss")</script>',
        lastName: 'Hoàng',
        password: 'Safe#Password123',
        bio: 'Hồ sơ <a href="javascript:evil()" onmouseover="steal()">an toàn</a>',
        roleIds: [adminRoleId],
      },
    });
    expect(sanitizedUserRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(sanitizedUserRes.body.data.firstName).toBe('Minh');
    expect(sanitizedUserRes.body.data.fullName).not.toContain('<script>');
    expect(sanitizedUserRes.body.data.profile?.bio).not.toContain('javascript:');
    expect(sanitizedUserRes.body.data.profile?.bio).not.toContain('onmouseover=');

    // 4. Audit Login / Failed Login / Logout in BOTH auth_login_history & audit_logs (4.5.7)
    for (let i = 0; i < 3; i++) {
      const failRes = await context.injectJson({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.180',
        payload: {
          identifier: 'sec45.e2e@gmail.com',
          password: 'WrongPassword!999',
        },
      });
      expect(failRes.status).toBe(HTTP_STATUS_CODE.UNAUTHORIZED);
    }

    const okLoginRes = await context.injectJson<{
      accessToken: string;
      sessionId: number;
    }>({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '10.20.30.50',
      payload: {
        identifier: 'sec45.e2e@gmail.com',
        password: 'Safe#Password123',
        deviceName: 'Sec45 E2E Workstation',
      },
    });
    expect(okLoginRes.status).toBe(HTTP_STATUS_CODE.OK);
    const sec45Token = okLoginRes.body.data.accessToken;

    // Trigger large data export event
    platformSecurity.setLargeExportThreshold(1);
    const exportRes = await context.injectJson<{ totalExported: number }>({
      method: 'GET',
      url: '/api/v1/exports/users?format=csv',
      headers: { authorization: `Bearer ${sec45Token}` },
    });
    expect(exportRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(exportRes.body.data.totalExported).toBeGreaterThanOrEqual(1);

    // Logout current session
    const logoutRes = await context.injectJson<{ loggedOut: boolean }>({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${sec45Token}` },
    });
    expect(logoutRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(logoutRes.body.data.loggedOut).toBe(true);

    // Verify user login history via GET /api/v1/users/:id/login-history
    const userHistoryRes = await context.injectJson<
      Array<{ eventTypeName: string; statusName: string }>
    >({
      method: 'GET',
      url: `/api/v1/users/${sanitizedUserRes.body.data.id}/login-history`,
      headers: adminHeaders,
    });
    expect(userHistoryRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(userHistoryRes.body.data.map((h) => h.eventTypeName)).toEqual(
      expect.arrayContaining(['LOGIN_FAILED', 'LOGIN_SUCCESS', 'LOGOUT']),
    );

    // Verify Audit Logs via GET /api/v1/roles/audit-logs?module=auth
    const authAuditRes = await context.injectJson<Array<{ action: string; module: string }>>({
      method: 'GET',
      url: '/api/v1/roles/audit-logs?module=auth&limit=50',
      headers: adminHeaders,
    });
    expect(authAuditRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(authAuditRes.body.data.map((a) => a.action)).toEqual(
      expect.arrayContaining(['LOGIN_FAILED', 'LOGIN_SUCCESS', 'LOGOUT']),
    );

    // 5. Query Security Events & SIEM Anomaly Alerts via GET /api/v1/roles/security-events & /security-alerts (4.5.7 & 4.5.8)
    const secEventsRes = await context.injectJson<Array<{ eventType: string }>>({
      method: 'GET',
      url: '/api/v1/roles/security-events?limit=50',
      headers: adminHeaders,
    });
    expect(secEventsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(secEventsRes.body.data.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['LOGIN_FAILED', 'DATA_EXPORT', 'PERMISSION_CHANGED']),
    );

    const secAlertsRes = await context.injectJson<Array<{ anomalyType: string; severity: string }>>(
      {
        method: 'GET',
        url: '/api/v1/roles/security-alerts?limit=50',
        headers: adminHeaders,
      },
    );
    expect(secAlertsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(secAlertsRes.body.data.map((a) => a.anomalyType)).toEqual(
      expect.arrayContaining(['BRUTE_FORCE_LOGIN', 'LARGE_DATA_EXPORT']),
    );

    // 6. Rate Limit enforcement (4.5.3): Exceed IP rate limit on a specific route -> 429 Too Many Requests
    platformSecurity.setRateLimitRule('GET /api/v1/auth/password/suggest', {
      ipLimit: 2,
      userLimit: 10,
      apiLimit: 50,
      windowSeconds: 60,
    });
    const rlOk1 = await context.injectJson({
      method: 'GET',
      url: '/api/v1/auth/password/suggest',
      remoteAddress: '198.51.100.250',
    });
    expect(rlOk1.status).toBe(HTTP_STATUS_CODE.OK);
    const rlOk2 = await context.injectJson({
      method: 'GET',
      url: '/api/v1/auth/password/suggest',
      remoteAddress: '198.51.100.250',
    });
    expect(rlOk2.status).toBe(HTTP_STATUS_CODE.OK);
    const rlExceeded = await context.injectJson({
      method: 'GET',
      url: '/api/v1/auth/password/suggest',
      remoteAddress: '198.51.100.250',
    });
    expect(rlExceeded.status).toBe(HTTP_STATUS_CODE.TOO_MANY_REQUESTS);
    expect(rlExceeded.headers['retry-after']).toBeDefined();
  });

  it('supports Dynamic Lookup Table & Hybrid Code System API (/api/v1/codes: sync, bootstrap, list, dynamic unit_type = CAMPUS, 2-tier i18n, and 403 system anchor protection)', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 1. POST /api/v1/codes/sync — Synchronize all module.manifest.json codeTypes into code_types & code_values
    const syncRes = await context.injectJson<{
      syncedModules: string[];
      totalCodeTypes: number;
      totalCodeValues: number;
    }>({
      method: 'POST',
      url: '/api/v1/codes/sync',
      headers: adminHeaders,
    });
    expect(syncRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(syncRes.body.data.totalCodeTypes).toBeGreaterThanOrEqual(8);
    expect(syncRes.body.data.syncedModules).toEqual(
      expect.arrayContaining(['organizations', 'users', 'roles', 'auth']),
    );

    // 2. GET /api/v1/codes/bootstrap?locale=en — 1-request dictionary with English labels
    const bootstrapRes = await context.injectJson<{
      locale: string;
      totalTypes: number;
      dictionary: Record<
        string,
        Array<{ numericCode: number; code: string; displayLabel: string }>
      >;
    }>({
      method: 'GET',
      url: '/api/v1/codes/bootstrap?locale=en',
    });
    expect(bootstrapRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(bootstrapRes.body.data.locale).toBe('en');
    const orgUnitTypesEn = bootstrapRes.body.data.dictionary['organizations.unit_type'];
    expect(orgUnitTypesEn).toBeDefined();
    expect(orgUnitTypesEn!.find((v) => v.numericCode === 1)?.displayLabel).toBe('Headquarters');

    // 3. GET /api/v1/codes?module=users&includeValues=true — List code_types for module users
    const userTypesRes = await context.injectJson<
      Array<{ code: string; module: string; totalValues: number }>
    >({
      method: 'GET',
      url: '/api/v1/codes?module=users&includeValues=true',
      headers: adminHeaders,
    });
    expect(userTypesRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(userTypesRes.body.data.map((t) => t.code)).toEqual(
      expect.arrayContaining(['users.status', 'users.gender', 'users.position_title']),
    );

    // 4. POST /api/v1/codes/organizations.unit_type/values — Add dynamic unit type 5 = CAMPUS
    const createCampusRes = await context.injectJson<{
      numericCode: number;
      code: string;
      displayLabel: string;
      isSystem: boolean;
    }>({
      method: 'POST',
      url: '/api/v1/codes/organizations.unit_type/values',
      headers: adminHeaders,
      payload: {
        numericCode: 5,
        code: 'CAMPUS',
        behaviorCode: 'BRANCH',
        name: 'Cơ sở đào tạo',
        labels: { vi: 'Cơ sở đào tạo', en: 'Campus' },
        aliases: ['CƠ SỞ', 'CO SO'],
        color: 'cyan',
      },
    });
    expect(createCampusRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createCampusRes.body.data.numericCode).toBe(5);
    expect(createCampusRes.body.data.code).toBe('CAMPUS');
    expect(createCampusRes.body.data.isSystem).toBe(false);

    // 5. POST /api/v1/organizations — Create Organization Unit using the new dynamic type = 5 ('CAMPUS')
    const createOrgCampusRes = await context.injectJson<{
      id: number;
      code: string;
      type: number;
      typeName: string;
    }>({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: adminHeaders,
      payload: {
        code: 'CAMPUS_Q9',
        name: 'Cơ sở Đào tạo Quận 9',
        type: 5,
      },
    });
    expect(createOrgCampusRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createOrgCampusRes.body.data.type).toBe(5);
    expect(createOrgCampusRes.body.data.typeName).toBe('CAMPUS');

    // 6. PATCH /api/v1/codes/organizations.unit_type/values/5 — Customize multilingual label at runtime
    const updateCampusRes = await context.injectJson<{
      numericCode: number;
      displayLabel: string;
      labels: Record<string, string>;
    }>({
      method: 'PATCH',
      url: '/api/v1/codes/organizations.unit_type/values/5',
      headers: adminHeaders,
      payload: {
        labels: { vi: 'Phân hiệu Đào tạo Quốc tế', en: 'International Campus' },
      },
    });
    expect(updateCampusRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updateCampusRes.body.data.labels.en).toBe('International Campus');

    // 7. DELETE /api/v1/codes/organizations.unit_type/values/1 — Block deleting system anchor (isSystem = true) with 403 Forbidden
    const deleteSystemRes = await context.injectJson({
      method: 'DELETE',
      url: '/api/v1/codes/organizations.unit_type/values/1',
      headers: adminHeaders,
    });
    expect(deleteSystemRes.status).toBe(HTTP_STATUS_CODE.FORBIDDEN);

    // 8. GET /api/v1/codes/organizations.unit_type/values/5/usage — Verify CAMPUS is in use by CAMPUS_Q9 (5.4.8)
    const usageInUseRes = await context.injectJson<{
      inUse: boolean;
      totalUsageCount: number;
    }>({
      method: 'GET',
      url: '/api/v1/codes/organizations.unit_type/values/5/usage',
      headers: adminHeaders,
    });
    expect(usageInUseRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(usageInUseRes.body.data.inUse).toBe(true);
    expect(usageInUseRes.body.data.totalUsageCount).toBeGreaterThanOrEqual(1);

    // 9. Block changing code or deleting custom code value while in use (5.4.3 & 5.4.8)
    const renameInUseRes = await context.injectJson({
      method: 'PATCH',
      url: '/api/v1/codes/organizations.unit_type/values/5',
      headers: adminHeaders,
      payload: { code: 'CAMPUS_CHANGED' },
    });
    expect(renameInUseRes.status).toBe(HTTP_STATUS_CODE.CONFLICT);

    const deleteInUseRes = await context.injectJson({
      method: 'DELETE',
      url: '/api/v1/codes/organizations.unit_type/values/5',
      headers: adminHeaders,
    });
    expect(deleteInUseRes.status).toBe(HTTP_STATUS_CODE.CONFLICT);

    // 10. Delete CAMPUS_Q9 organization unit, then allow deleting custom code value 5
    await context.injectJson({
      method: 'DELETE',
      url: `/api/v1/organizations/${createOrgCampusRes.body.data.id}`,
      headers: adminHeaders,
    });

    const deleteCustomRes = await context.injectJson<{ deleted: boolean; numericCode: number }>({
      method: 'DELETE',
      url: '/api/v1/codes/organizations.unit_type/values/5',
      headers: adminHeaders,
    });
    expect(deleteCustomRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(deleteCustomRes.body.data.deleted).toBe(true);

    // 11. Section 5.4 Master Data API: Create CodeType, Import CSV with duplicate check, Reorder, Lock & Export
    const createTypeRes = await context.injectJson<{
      code: string;
      name: string;
      isSystem: boolean;
    }>({
      method: 'POST',
      url: '/api/v1/codes',
      headers: adminHeaders,
      payload: {
        code: 'hr.profile_type',
        module: 'hr',
        name: 'Loại hồ sơ nhân sự',
      },
    });
    expect(createTypeRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createTypeRes.body.data.code).toBe('hr.profile_type');
    expect(createTypeRes.body.data.isSystem).toBe(false);

    const importCodesRes = await context.injectJson<{
      totalRows: number;
      importedCount: number;
      failedCount: number;
    }>({
      method: 'POST',
      url: '/api/v1/codes/hr.profile_type/values/import',
      headers: adminHeaders,
      payload: {
        items: [
          {
            code: 'OFFICIAL',
            name: 'Hồ sơ chính thức',
            labels: { vi: 'Hồ sơ chính thức', en: 'Official Profile' },
            sortOrder: 2,
          },
          {
            code: 'PROBATION',
            name: 'Hồ sơ thử việc',
            labels: { vi: 'Hồ sơ thử việc', en: 'Probation Profile' },
            sortOrder: 1,
          },
          {
            code: 'OFFICIAL',
            name: 'Hồ sơ trùng mã',
          },
        ],
        skipDuplicates: false,
      },
    });
    expect(importCodesRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(importCodesRes.body.data.importedCount).toBe(2);
    expect(importCodesRes.body.data.failedCount).toBe(1);

    const reorderRes = await context.injectJson<Array<{ code: string; sortOrder: number }>>({
      method: 'PATCH',
      url: '/api/v1/codes/hr.profile_type/values/reorder',
      headers: adminHeaders,
      payload: {
        items: [
          { numericCode: 1, sortOrder: 1 },
          { numericCode: 2, sortOrder: 2 },
        ],
      },
    });
    expect(reorderRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(reorderRes.body.data.map((i) => i.code)).toEqual(['OFFICIAL', 'PROBATION']);

    // Lock PROBATION (numericCode = 2) -> excluded from active dropdown list
    await context.injectJson({
      method: 'PATCH',
      url: '/api/v1/codes/hr.profile_type/values/2',
      headers: adminHeaders,
      payload: { status: 2 },
    });
    const activeProfileTypesRes = await context.injectJson<Array<{ code: string }>>({
      method: 'GET',
      url: '/api/v1/codes/hr.profile_type/values',
      headers: adminHeaders,
    });
    expect(activeProfileTypesRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(activeProfileTypesRes.body.data.map((i) => i.code)).toEqual(['OFFICIAL']);

    // Export Master Data (5.4.7)
    const exportRes = await context.injectJson<{
      fileName: string;
      totalExported: number;
      csvContent: string;
      xlsxBase64: string;
    }>({
      method: 'GET',
      url: '/api/v1/codes/export?typeCode=hr.profile_type&includeInactive=true&format=xlsx',
      headers: adminHeaders,
    });
    expect(exportRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(exportRes.body.data.totalExported).toBe(2);
    expect(exportRes.body.data.csvContent).toContain('hr.profile_type');
  });

  it('supports Section 5.1 System Settings API (/api/v1/settings: sync, groups, CRUD, type validation, environment & unit resolution, sensitive masking, history, cache invalidation & password policy bridge)', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 1. POST /api/v1/settings/sync — Idempotent sync from module.manifest.json (5.1.1 & 5.1.2)
    const syncRes = await context.injectJson<{
      syncedModules: string[];
      totalGroups: number;
      totalSettings: number;
      totalEnvironmentOverrides: number;
    }>({
      method: 'POST',
      url: '/api/v1/settings/sync',
      headers: adminHeaders,
    });
    expect(syncRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(syncRes.body.data.totalGroups).toBeGreaterThanOrEqual(5);
    expect(syncRes.body.data.totalSettings).toBeGreaterThanOrEqual(14);

    // 2. GET /api/v1/settings/groups — List system setting groups (email, file, security, ui, system)
    const groupsRes = await context.injectJson<
      Array<{ code: string; module: string; name: string; isSystem: boolean }>
    >({
      method: 'GET',
      url: '/api/v1/settings/groups',
      headers: adminHeaders,
    });
    expect(groupsRes.status).toBe(HTTP_STATUS_CODE.OK);
    const groupCodes = groupsRes.body.data.map((g) => g.code);
    expect(groupCodes).toEqual(
      expect.arrayContaining(['email', 'file', 'security', 'ui', 'system']),
    );

    // 3. GET /api/v1/settings?module=auth&namespace=auth.password — Filter by module and namespace (5.1.2)
    const authSettingsRes = await context.injectJson<
      Array<{ key: string; module: string; namespace: string; valueTypeName: string }>
    >({
      method: 'GET',
      url: '/api/v1/settings?module=auth&namespace=auth.password',
      headers: adminHeaders,
    });
    expect(authSettingsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(authSettingsRes.body.data.some((s) => s.key === 'security.password.min_length')).toBe(
      true,
    );

    // 4. PUT /api/v1/settings/:key — Validate NUMBER constraints (min=6, max=64) before saving (5.1.3)
    const invalidMinLenRes = await context.injectJson({
      method: 'PUT',
      url: '/api/v1/settings/security.password.min_length',
      headers: adminHeaders,
      payload: {
        value: 3, // < min (6) -> 400 Bad Request
        reason: 'Thử giá trị không hợp lệ',
      },
    });
    expect(invalidMinLenRes.status).toBe(HTTP_STATUS_CODE.BAD_REQUEST);

    // 5. PUT /api/v1/settings/:key — Environment & Organization Unit overrides (5.1.4 & 5.1.5)
    const setGlobalHost = await context.injectJson<{
      key: string;
      value: string;
      resolvedSource: string;
    }>({
      method: 'PUT',
      url: '/api/v1/settings/email.smtp.host',
      headers: adminHeaders,
      payload: {
        value: 'smtp.global.corp',
        environment: 'ALL',
      },
    });
    expect(setGlobalHost.status).toBe(HTTP_STATUS_CODE.OK);
    expect(setGlobalHost.body.data.value).toBe('smtp.global.corp');

    const setProdHost = await context.injectJson<{
      key: string;
      value: string;
      resolvedSource: string;
    }>({
      method: 'PUT',
      url: '/api/v1/settings/email.smtp.host',
      headers: adminHeaders,
      payload: {
        value: 'smtp.prod.corp',
        environment: 'production',
      },
    });
    expect(setProdHost.status).toBe(HTTP_STATUS_CODE.OK);

    const setUnitProdHost = await context.injectJson<{
      key: string;
      value: string;
      resolvedSource: string;
    }>({
      method: 'PUT',
      url: '/api/v1/settings/email.smtp.host',
      headers: adminHeaders,
      payload: {
        value: 'smtp.unit99.prod.corp',
        environment: 'production',
        organizationUnitId: 99,
      },
    });
    expect(setUnitProdHost.status).toBe(HTTP_STATUS_CODE.OK);

    // Resolve hierarchy via GET /api/v1/settings/resolve
    const resolveStagingGlobal = await context.injectJson<
      Array<{
        key: string;
        value: string;
        resolvedSource: string;
        fromCache: boolean;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/resolve?key=email.smtp.host&environment=staging',
      headers: adminHeaders,
    });
    expect(resolveStagingGlobal.status).toBe(HTTP_STATUS_CODE.OK);
    expect(resolveStagingGlobal.body.data[0]?.value).toBe('smtp.global.corp');
    expect(resolveStagingGlobal.body.data[0]?.resolvedSource).toBe('GLOBAL');

    const resolveProdGlobal = await context.injectJson<
      Array<{
        key: string;
        value: string;
        resolvedSource: string;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/resolve?key=email.smtp.host&environment=production',
      headers: adminHeaders,
    });
    expect(resolveProdGlobal.status).toBe(HTTP_STATUS_CODE.OK);
    expect(resolveProdGlobal.body.data[0]?.value).toBe('smtp.prod.corp');
    expect(resolveProdGlobal.body.data[0]?.resolvedSource).toBe('GLOBAL_ENV');

    const resolveProdUnit = await context.injectJson<
      Array<{
        key: string;
        value: string;
        resolvedSource: string;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/resolve?key=email.smtp.host&environment=production&organizationUnitId=99',
      headers: adminHeaders,
    });
    expect(resolveProdUnit.status).toBe(HTTP_STATUS_CODE.OK);
    expect(resolveProdUnit.body.data[0]?.value).toBe('smtp.unit99.prod.corp');
    expect(resolveProdUnit.body.data[0]?.resolvedSource).toBe('UNIT_ENV');

    // 6. Sensitive Setting Encryption & Masking (5.1.6): Never expose raw secret in API response or history
    const setSmtpPass = await context.injectJson<{
      key: string;
      isSensitive: boolean;
      isEncrypted: boolean;
      value: string;
    }>({
      method: 'PUT',
      url: '/api/v1/settings/email.smtp.password',
      headers: adminHeaders,
      payload: {
        value: 'RawSmtpSecretPassword#999!',
        reason: 'Xoay vòng mật khẩu SMTP định kỳ',
      },
    });
    expect(setSmtpPass.status).toBe(HTTP_STATUS_CODE.OK);
    expect(setSmtpPass.body.data.isSensitive).toBe(true);
    expect(setSmtpPass.body.data.isEncrypted).toBe(true);
    expect(setSmtpPass.body.data.value).toBe('••••••••');

    // 7. Cache hit & immediate invalidation on update + Live Bridge to Password Policy (5.1.8)
    const resolveMinLen1 = await context.injectJson<
      Array<{
        value: number;
        fromCache: boolean;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/resolve?key=security.password.min_length',
      headers: adminHeaders,
    });
    expect(resolveMinLen1.status).toBe(HTTP_STATUS_CODE.OK);
    expect(resolveMinLen1.body.data[0]?.value).toBe(8);

    const resolveMinLen2 = await context.injectJson<
      Array<{
        value: number;
        fromCache: boolean;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/resolve?key=security.password.min_length',
      headers: adminHeaders,
    });
    expect(resolveMinLen2.status).toBe(HTTP_STATUS_CODE.OK);
    expect(resolveMinLen2.body.data[0]?.fromCache).toBe(true);

    // Update security.password.min_length to 11 via Settings API
    const updateMinLenRes = await context.injectJson<{
      key: string;
      value: number;
    }>({
      method: 'PUT',
      url: '/api/v1/settings/security.password.min_length',
      headers: adminHeaders,
      payload: {
        value: 11,
        reason: 'Nâng chuẩn độ dài mật khẩu tối thiểu lên 11 ký tự',
      },
    });
    expect(updateMinLenRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updateMinLenRes.body.data.value).toBe(11);

    // Verify SecuritySettingsService (/api/v1/auth/security-settings) immediately reflects passwordMinLength = 11
    const authSecRes = await context.injectJson<{
      passwordMinLength: number;
    }>({
      method: 'GET',
      url: '/api/v1/auth/security-settings',
      headers: adminHeaders,
    });
    expect(authSecRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(authSecRes.body.data.passwordMinLength).toBe(11);

    // Reverse bridge: Update passwordMinLength = 10 via PUT /api/v1/auth/security-settings -> /api/v1/settings/resolve reflects 10 immediately
    const updateViaAuthApiRes = await context.injectJson<{
      passwordMinLength: number;
    }>({
      method: 'PUT',
      url: '/api/v1/auth/security-settings',
      headers: adminHeaders,
      payload: {
        passwordMinLength: 10,
      },
    });
    expect(updateViaAuthApiRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updateViaAuthApiRes.body.data.passwordMinLength).toBe(10);

    const resolveAfterAuthApi = await context.injectJson<
      Array<{
        value: number;
        fromCache: boolean;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/resolve?key=security.password.min_length',
      headers: adminHeaders,
    });
    expect(resolveAfterAuthApi.status).toBe(HTTP_STATUS_CODE.OK);
    expect(resolveAfterAuthApi.body.data[0]?.value).toBe(10);
    expect(resolveAfterAuthApi.body.data[0]?.fromCache).toBe(false);

    // Reset security.password.min_length back to 8 so subsequent tests are unaffected
    await context.injectJson({
      method: 'PUT',
      url: '/api/v1/settings/security.password.min_length',
      headers: adminHeaders,
      payload: {
        value: 8,
        reason: 'Khôi phục cấu hình mặc định 8 ký tự',
      },
    });

    // 8. GET /api/v1/settings/:key/history — Setting Change History (5.1.7)
    const historyRes = await context.injectJson<
      Array<{
        settingKey: string;
        oldValue: unknown;
        newValue: unknown;
        actorUserId: number | null;
        reason: string | null;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/security.password.min_length/history',
      headers: adminHeaders,
    });
    expect(historyRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(historyRes.body.data.length).toBeGreaterThanOrEqual(2);
    expect(historyRes.body.data.some((h) => h.newValue === 11)).toBe(true);
  });

  it('5.2 & 5.3 Feature E2E: Feature Flags HTTP APIs (/api/v1/settings/feature-flags/*) & Multilingual / Timezone User Preferences (/api/v1/auth/preferences)', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // =========================================================================
    // PHẦN 1: FEATURE FLAGS HTTP E2E (Mục 5.2.1 -> 5.2.8)
    // =========================================================================
    const listFlagsRes = await context.injectJson<
      Array<{
        key: string;
        module: string;
        isEnabled: boolean;
        isModuleInstalled: boolean;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/feature-flags',
      headers: adminHeaders,
    });
    expect(listFlagsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(listFlagsRes.body.data.length).toBeGreaterThanOrEqual(3);

    // 5.2.1: Tạo mới Feature Flag với key và mô tả rõ
    const createFlagRes = await context.injectJson<{
      id: number;
      key: string;
      module: string;
      isEnabled: boolean;
      rolloutPercentage: number;
    }>({
      method: 'POST',
      url: '/api/v1/settings/feature-flags',
      headers: adminHeaders,
      payload: {
        key: 'users.e2e_pilot_export',
        module: 'users',
        name: 'Xuất báo cáo nhân sự nâng cao theo múi giờ',
        description:
          'Cho phép xuất báo cáo nhân sự theo múi giờ cá nhân trong giai đoạn thử nghiệm',
        isEnabled: true,
        rolloutPercentage: 100,
        targetUserIds: ['1'],
        targetRoles: ['SUPER_ADMIN'],
        targetOrganizationUnitIds: ['10'],
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-12-31T23:59:59.000Z',
        reason: 'Tạo flag thử nghiệm E2E',
      },
    });
    expect(createFlagRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createFlagRes.body.data.key).toBe('users.e2e_pilot_export');

    // 5.2.2: Chặn tạo flag cho module chưa cài đặt ('uninstalled_mod.feature_x')
    const invalidModuleFlagRes = await context.injectJson({
      method: 'POST',
      url: '/api/v1/settings/feature-flags',
      headers: adminHeaders,
      payload: {
        key: 'uninstalled_mod.feature_x',
        module: 'uninstalled_mod',
        name: 'Tính năng module chưa cài',
        description: 'Kiểm tra chặn tạo flag khi module chưa có trong enabledModules',
        isEnabled: true,
      },
    });
    expect(invalidModuleFlagRes.status).toBe(HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY);

    // 5.2.3 -> 5.2.7: Đánh giá Feature Flag qua GET /api/v1/settings/feature-flags/evaluate
    const evalMatchUserRes = await context.injectJson<
      Array<{
        key: string;
        enabled: boolean;
        reason: string;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/feature-flags/evaluate?key=users.e2e_pilot_export&userId=1&at=2026-10-20T10:00:00.000Z',
      headers: adminHeaders,
    });
    expect(evalMatchUserRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(evalMatchUserRes.body.data[0]?.enabled).toBe(true);
    expect(evalMatchUserRes.body.data[0]?.reason).toBe('TARGET_USER_MATCH');

    // Người dùng không khớp target (userId=999, role=GUEST, org=99) -> TARGET_MISMATCH (enabled: false)
    const evalMismatchRes = await context.injectJson<
      Array<{
        key: string;
        enabled: boolean;
        reason: string;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/feature-flags/evaluate?key=users.e2e_pilot_export&userId=999&roles=GUEST&organizationUnitId=99&at=2026-10-20T10:00:00.000Z',
      headers: adminHeaders,
    });
    expect(evalMismatchRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(evalMismatchRes.body.data[0]?.enabled).toBe(false);
    expect(evalMismatchRes.body.data[0]?.reason).toBe('TARGET_MISMATCH');

    // Khi ngoài khung thời gian thử nghiệm (sau endsAt) -> tự động đóng tính năng (EXPIRED)
    const evalExpiredRes = await context.injectJson<
      Array<{
        key: string;
        enabled: boolean;
        reason: string;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/feature-flags/evaluate?key=users.e2e_pilot_export&userId=1&at=2027-01-02T00:00:00.000Z',
      headers: adminHeaders,
    });
    expect(evalExpiredRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(evalExpiredRes.body.data[0]?.enabled).toBe(false);
    expect(evalExpiredRes.body.data[0]?.reason).toBe('EXPIRED');

    // Toggle tắt flag qua PATCH /api/v1/settings/feature-flags/:key/toggle
    const toggleFlagRes = await context.injectJson<{
      key: string;
      isEnabled: boolean;
    }>({
      method: 'PATCH',
      url: '/api/v1/settings/feature-flags/users.e2e_pilot_export/toggle',
      headers: adminHeaders,
      payload: {
        isEnabled: false,
        reason: 'Đóng thử nghiệm tính năng xuất báo cáo E2E',
      },
    });
    expect(toggleFlagRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(toggleFlagRes.body.data.isEnabled).toBe(false);

    // 5.2.8: Kiểm tra lịch sử thay đổi Feature Flag qua GET /api/v1/settings/feature-flags/:key/history
    const flagHistoryRes = await context.injectJson<
      Array<{
        flagKey: string;
        action: string;
        actorUserId: number | null;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/feature-flags/users.e2e_pilot_export/history',
      headers: adminHeaders,
    });
    expect(flagHistoryRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(flagHistoryRes.body.data.length).toBeGreaterThanOrEqual(2);
    expect(flagHistoryRes.body.data.map((h) => h.action)).toEqual(
      expect.arrayContaining(['CREATE', 'TOGGLE']),
    );

    // =========================================================================
    // PHẦN 2: ĐA NGÔN NGỮ VÀ MÚI GIỜ HTTP E2E (Mục 5.3.1 -> 5.3.6)
    // =========================================================================
    // 5.3.1 & 5.3.2: Lấy tùy chọn ngôn ngữ & múi giờ mặc định của người dùng (vi, Asia/Ho_Chi_Minh)
    const getPrefsRes = await context.injectJson<{
      userId: number;
      preferredLocale: 'vi' | 'en';
      preferredTimezone: string;
    }>({
      method: 'GET',
      url: '/api/v1/auth/preferences',
      headers: adminHeaders,
    });
    expect(getPrefsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(getPrefsRes.body.data.preferredLocale).toBe('vi');
    expect(getPrefsRes.body.data.preferredTimezone).toBe('Asia/Ho_Chi_Minh');

    // 5.3.2 & 5.3.5: Người dùng đổi ngôn ngữ sang 'en' và múi giờ sang 'America/New_York'
    const updatePrefsRes = await context.injectJson<{
      userId: number;
      preferredLocale: 'vi' | 'en';
      preferredTimezone: string;
    }>({
      method: 'PATCH',
      url: '/api/v1/auth/preferences',
      headers: adminHeaders,
      payload: {
        preferredLocale: 'en',
        preferredTimezone: 'America/New_York',
      },
    });
    expect(updatePrefsRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updatePrefsRes.body.data.preferredLocale).toBe('en');
    expect(updatePrefsRes.body.data.preferredTimezone).toBe('America/New_York');

    // 5.3.3: Chuẩn hóa thông báo lỗi đa ngôn ngữ — Khi user có preferredLocale = 'en' gọi API lỗi mà không gửi Accept-Language,
    // AuthGuard tự động áp dụng preferredLocale = 'en' từ hồ sơ và trả về thông báo lỗi tiếng Anh!
    const notFoundInUserPrefEn = await context.injectJson({
      method: 'GET',
      url: '/api/v1/users/999999',
      headers: adminHeaders,
    });
    expect(notFoundInUserPrefEn.status).toBe(HTTP_STATUS_CODE.NOT_FOUND);
    expect(
      (notFoundInUserPrefEn.body as unknown as { error: { message: string } }).error.message,
    ).toBe('Requested user not found');

    // Nếu client gửi kèm header Accept-Language: vi tường minh, ưu tiên trả về tiếng Việt
    const notFoundExplicitVi = await context.injectJson({
      method: 'GET',
      url: '/api/v1/users/999999',
      headers: {
        ...adminHeaders,
        'accept-language': 'vi',
      },
    });
    expect(notFoundExplicitVi.status).toBe(HTTP_STATUS_CODE.NOT_FOUND);
    expect(
      (notFoundExplicitVi.body as unknown as { error: { message: string } }).error.message,
    ).toBe('Không tìm thấy người dùng yêu cầu');

    // Khôi phục lại preference mặc định 'vi' & 'Asia/Ho_Chi_Minh'
    await context.injectJson({
      method: 'PATCH',
      url: '/api/v1/auth/preferences',
      headers: adminHeaders,
      payload: {
        preferredLocale: 'vi',
        preferredTimezone: 'Asia/Ho_Chi_Minh',
      },
    });

    // =========================================================================
    // PHẦN 3: SINH MÃ NGHIỆP VỤ ĐỘNG ĐA MODULE HTTP E2E (Mục 5.5.1 -> 5.5.8)
    // =========================================================================
    // 5.5.7: Xem trước mẫu mã (POST /api/v1/settings/sequences/preview) trước khi áp dụng
    const previewSeqRes = await context.injectJson<{
      sampleCode: string;
      nextSampleCodes: string[];
      periodKey: string;
    }>({
      method: 'POST',
      url: '/api/v1/settings/sequences/preview',
      headers: adminHeaders,
      payload: {
        prefix: 'ORD',
        separator: '-',
        dateFormat: 'YYYY',
        paddingLength: 6,
        startValue: 1,
        step: 1,
        resetPolicy: 'YEARLY',
        at: '2026-10-20T08:00:00.000Z',
      },
    });
    expect(previewSeqRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(previewSeqRes.body.data.sampleCode).toBe('ORD-2026-000001');
    expect(previewSeqRes.body.data.nextSampleCodes).toEqual([
      'ORD-2026-000001',
      'ORD-2026-000002',
      'ORD-2026-000003',
    ]);

    // 5.5.1 -> 5.5.3: Tạo mới quy tắc sinh mã (POST /api/v1/settings/sequences)
    const createSeqRes = await context.injectJson<{
      key: string;
      module: string;
      prefix: string;
      samplePreview: string;
    }>({
      method: 'POST',
      url: '/api/v1/settings/sequences',
      headers: adminHeaders,
      payload: {
        key: 'orders.e2e_sales_order',
        module: 'orders',
        name: 'Mã đơn hàng E2E',
        description: 'Quy tắc sinh mã đơn hàng phục vụ kiểm thử E2E',
        prefix: 'ORD',
        suffix: '',
        separator: '-',
        dateFormat: 'YYYY',
        paddingLength: 6,
        startValue: 1,
        step: 1,
        resetPolicy: 'YEARLY',
        scopeByUnit: false,
        reason: 'Khởi tạo mẫu sinh mã đơn hàng E2E',
      },
    });
    expect(createSeqRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createSeqRes.body.data.key).toBe('orders.e2e_sales_order');
    expect(createSeqRes.body.data.prefix).toBe('ORD');

    // 5.5.4: Sinh số thứ tự an toàn khi nhiều request cùng lúc qua HTTP (POST /api/v1/settings/sequences/:key/next)
    const parallelHttpReqs = Array.from({ length: 10 }, () =>
      context.injectJson<{
        code: string;
        sequenceNumber: number;
      }>({
        method: 'POST',
        url: '/api/v1/settings/sequences/orders.e2e_sales_order/next',
        headers: adminHeaders,
        payload: {
          at: '2026-10-20T09:00:00.000Z',
        },
      }),
    );
    const parallelHttpResponses = await Promise.all(parallelHttpReqs);
    const httpCodes = parallelHttpResponses.map((r) => r.body.data.code);
    expect(new Set(httpCodes).size).toBe(10);
    expect(httpCodes).toContain('ORD-2026-000001');
    expect(httpCodes).toContain('ORD-2026-000010');

    // 5.5.6: Sinh mã riêng theo đơn vị (organizations.contract_code có scopeByUnit = true)
    const unitHcmRes = await context.injectJson<{
      code: string;
      unitScopeKey: string;
    }>({
      method: 'POST',
      url: '/api/v1/settings/sequences/organizations.contract_code/next',
      headers: adminHeaders,
      payload: {
        organizationUnitId: 10,
        unitCode: 'HCM',
        at: '2026-10-20T09:00:00.000Z',
      },
    });
    const unitHnRes = await context.injectJson<{
      code: string;
      unitScopeKey: string;
    }>({
      method: 'POST',
      url: '/api/v1/settings/sequences/organizations.contract_code/next',
      headers: adminHeaders,
      payload: {
        organizationUnitId: 20,
        unitCode: 'HN',
        at: '2026-10-20T09:00:00.000Z',
      },
    });
    expect(unitHcmRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(unitHcmRes.body.data.code).toBe('CTR-HCM-2026-000001');
    expect(unitHnRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(unitHnRes.body.data.code).toBe('CTR-HN-2026-000001');

    // 5.5.8: Cập nhật cấu hình mã & Tra cứu lịch sử thay đổi (không làm ảnh hưởng mã đã cấp)
    const updateSeqRes = await context.injectJson<{
      key: string;
      prefix: string;
      suffix: string;
    }>({
      method: 'PUT',
      url: '/api/v1/settings/sequences/orders.e2e_sales_order',
      headers: adminHeaders,
      payload: {
        prefix: 'ORDX',
        suffix: 'VN',
        dateFormat: 'YYYYMM',
        reason: 'Cập nhật tiền tố ORDX và hậu tố VN',
      },
    });
    expect(updateSeqRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updateSeqRes.body.data.prefix).toBe('ORDX');
    expect(updateSeqRes.body.data.suffix).toBe('VN');

    const nextAfterUpdateRes = await context.injectJson<{
      code: string;
      sequenceNumber: number;
    }>({
      method: 'POST',
      url: '/api/v1/settings/sequences/orders.e2e_sales_order/next',
      headers: adminHeaders,
      payload: {
        at: '2026-10-20T10:00:00.000Z',
      },
    });
    expect(nextAfterUpdateRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(nextAfterUpdateRes.body.data.code).toBe('ORDX-202610-000011-VN');
    expect(nextAfterUpdateRes.body.data.sequenceNumber).toBe(11);

    const seqHistoryRes = await context.injectJson<
      Array<{
        sequenceKey: string;
        action: string;
        reason: string | null;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/sequences/orders.e2e_sales_order/history',
      headers: adminHeaders,
    });
    expect(seqHistoryRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(seqHistoryRes.body.data.length).toBeGreaterThanOrEqual(2);
    expect(seqHistoryRes.body.data.map((h) => h.action)).toEqual(
      expect.arrayContaining(['CREATE', 'UPDATE']),
    );
  });

  it('supports Section 5.6 Dynamic Menu & Navigation Management E2E: manifest sync, authorized menu tree by user permissions, create/update/reorder/delete menu, enable/disable toggle (status 1/0), and automatic cache invalidation', async () => {
    const adminHeaders = { authorization: `Bearer ${adminAccessToken}` };

    // 5.6.3: Đồng bộ Idempotent cấu trúc menu mặc định từ module.manifest.json (POST /api/v1/settings/menus/sync)
    const syncMenusRes = await context.injectJson<{
      syncedModules: string[];
      totalMenus: number;
    }>({
      method: 'POST',
      url: '/api/v1/settings/menus/sync',
      headers: adminHeaders,
      payload: {},
    });
    expect(syncMenusRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(syncMenusRes.body.data.syncedModules).toEqual(
      expect.arrayContaining(['codes', 'organizations', 'roles', 'settings', 'users']),
    );
    expect(syncMenusRes.body.data.totalMenus).toBeGreaterThanOrEqual(12);

    // 5.6.1: Liệt kê danh sách menu quản trị (GET /api/v1/settings/menus)
    const listMenusRes = await context.injectJson<
      Array<{
        id: number;
        code: string;
        name: string;
        status: number;
        statusName: string;
        level: number;
        position: string;
      }>
    >({
      method: 'GET',
      url: '/api/v1/settings/menus?position=SIDEBAR',
      headers: adminHeaders,
    });
    expect(listMenusRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(listMenusRes.body.data.map((m) => m.code)).toEqual(
      expect.arrayContaining(['HOME', 'IAM', 'IAM_USERS', 'SETTINGS', 'SETTINGS_MENUS']),
    );

    // 5.6.1: Tạo mới mục menu động dưới nhóm SETTINGS (POST /api/v1/settings/menus)
    const createMenuRes = await context.injectJson<{
      id: number;
      code: string;
      name: string;
      status: number;
      statusName: string;
      parentCode: string | null;
      level: number;
      link: string | null;
      key: string | null;
    }>({
      method: 'POST',
      url: '/api/v1/settings/menus',
      headers: adminHeaders,
      payload: {
        code: 'SETTINGS_CUSTOM_PORTAL',
        module: 'settings',
        name: 'Cấu hình Cổng thông tin E2E',
        status: 1,
        type: 2,
        parentCode: 'SETTINGS',
        link: '/settings/portal',
        linkApi: '/api/v1/settings/portal',
        key: 'settings.read',
        numOrder: 60,
        icon: 'Globe',
        position: 'SIDEBAR',
        reason: 'Thêm mục menu Cổng thông tin phục vụ kiểm thử E2E',
      },
    });
    expect(createMenuRes.status).toBe(HTTP_STATUS_CODE.CREATED);
    expect(createMenuRes.body.data.code).toBe('SETTINGS_CUSTOM_PORTAL');
    expect(createMenuRes.body.data.parentCode).toBe('SETTINGS');
    expect(createMenuRes.body.data.level).toBe(2);
    expect(createMenuRes.body.data.status).toBe(1);

    // 5.6.2 & 5.6.4: Lấy cây menu điều hướng đã lọc theo quyền hạn người dùng hiện tại (GET /api/v1/settings/menus/tree)
    const treeRes1 = await context.injectJson<{
      position: string;
      totalNodes: number;
      cacheVersion: number;
      fromCache: boolean;
      items: Array<{
        code: string;
        name: string;
        children: Array<{ code: string; name: string; link: string | null }>;
      }>;
    }>({
      method: 'GET',
      url: '/api/v1/settings/menus/tree?position=SIDEBAR',
      headers: adminHeaders,
    });
    expect(treeRes1.status).toBe(HTTP_STATUS_CODE.OK);
    const settingsBranch1 = treeRes1.body.data.items.find((i) => i.code === 'SETTINGS');
    expect(settingsBranch1).toBeDefined();
    expect(settingsBranch1?.children.map((c) => c.code)).toContain('SETTINGS_CUSTOM_PORTAL');

    // Gọi lần 2 -> trả về từ Cache điều hướng (fromCache = true)
    const treeRes2 = await context.injectJson<{
      fromCache: boolean;
      cacheVersion: number;
    }>({
      method: 'GET',
      url: '/api/v1/settings/menus/tree?position=SIDEBAR',
      headers: adminHeaders,
    });
    expect(treeRes2.status).toBe(HTTP_STATUS_CODE.OK);
    expect(treeRes2.body.data.fromCache).toBe(true);
    expect(treeRes2.body.data.cacheVersion).toBe(treeRes1.body.data.cacheVersion);

    // 5.6.1 & 5.6.4: Tắt hiển thị mục menu (PATCH /api/v1/settings/menus/:code/toggle với status = 0)
    // -> Tự động xóa cache và ẩn mục menu khỏi cây điều hướng
    const toggleOffRes = await context.injectJson<{
      code: string;
      status: number;
      statusName: string;
    }>({
      method: 'PATCH',
      url: '/api/v1/settings/menus/SETTINGS_CUSTOM_PORTAL/toggle',
      headers: adminHeaders,
      payload: {
        status: 0,
        reason: 'Tạm tắt hiển thị menu Cổng thông tin trên giao diện',
      },
    });
    expect(toggleOffRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(toggleOffRes.body.data.status).toBe(0);
    expect(toggleOffRes.body.data.statusName).toBe('INACTIVE');

    const treeAfterToggleOff = await context.injectJson<{
      fromCache: boolean;
      items: Array<{
        code: string;
        children: Array<{ code: string }>;
      }>;
    }>({
      method: 'GET',
      url: '/api/v1/settings/menus/tree?position=SIDEBAR',
      headers: adminHeaders,
    });
    expect(treeAfterToggleOff.status).toBe(HTTP_STATUS_CODE.OK);
    expect(treeAfterToggleOff.body.data.fromCache).toBe(false);
    const settingsBranchAfterOff = treeAfterToggleOff.body.data.items.find(
      (i) => i.code === 'SETTINGS',
    );
    expect(settingsBranchAfterOff?.children.map((c) => c.code)).not.toContain(
      'SETTINGS_CUSTOM_PORTAL',
    );

    // Bật lại mục menu (status = 1) và cập nhật tên + thứ tự hiển thị
    const toggleOnRes = await context.injectJson<{
      code: string;
      status: number;
      statusName: string;
    }>({
      method: 'PATCH',
      url: '/api/v1/settings/menus/SETTINGS_CUSTOM_PORTAL/toggle',
      headers: adminHeaders,
      payload: {
        status: 1,
      },
    });
    expect(toggleOnRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(toggleOnRes.body.data.status).toBe(1);

    const updateMenuRes = await context.injectJson<{
      code: string;
      name: string;
      numOrder: number;
    }>({
      method: 'PUT',
      url: '/api/v1/settings/menus/SETTINGS_CUSTOM_PORTAL',
      headers: adminHeaders,
      payload: {
        name: 'Cổng thông tin Doanh nghiệp',
        numOrder: 5,
      },
    });
    expect(updateMenuRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(updateMenuRes.body.data.name).toBe('Cổng thông tin Doanh nghiệp');
    expect(updateMenuRes.body.data.numOrder).toBe(5);

    // Sắp xếp lại thứ tự hiển thị (POST /api/v1/settings/menus/reorder)
    const reorderRes = await context.injectJson<Array<{ code: string; numOrder: number }>>({
      method: 'POST',
      url: '/api/v1/settings/menus/reorder',
      headers: adminHeaders,
      payload: {
        items: [{ code: 'SETTINGS_CUSTOM_PORTAL', numOrder: 1 }],
      },
    });
    expect(reorderRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(reorderRes.body.data[0]?.numOrder).toBe(1);

    // Xóa cache điều hướng chủ động (POST /api/v1/settings/menus/cache/invalidate)
    const invalidateRes = await context.injectJson<{
      invalidated: boolean;
      cacheVersion: number;
    }>({
      method: 'POST',
      url: '/api/v1/settings/menus/cache/invalidate',
      headers: adminHeaders,
      payload: {},
    });
    expect(invalidateRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(invalidateRes.body.data.invalidated).toBe(true);

    // Xóa mục menu vừa tạo (DELETE /api/v1/settings/menus/:code)
    const deleteMenuRes = await context.injectJson<{
      deleted: boolean;
      code: string;
    }>({
      method: 'DELETE',
      url: '/api/v1/settings/menus/SETTINGS_CUSTOM_PORTAL',
      headers: adminHeaders,
    });
    expect(deleteMenuRes.status).toBe(HTTP_STATUS_CODE.OK);
    expect(deleteMenuRes.body.data.deleted).toBe(true);
  });
});
