import { describe, it, expect, beforeEach } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import {
  AUDIT_ACTOR_TYPE,
  AuditLogService,
  DATA_SCOPE,
  DataScopeService,
  FieldEncryptionService,
  inferDefaultDataScopeForRoleCode,
  PasswordHasherService,
  PlatformSecurityService,
  redactSensitiveResponseData,
  sanitizeAuditSnapshot,
  sanitizeInputPayload,
  TokenService,
  TotpService,
} from '@packages/security/index.js';
import rolesVi from '@modules/roles/locales/vi/roles.json' with { type: 'json' };
import rolesEn from '@modules/roles/locales/en/roles.json' with { type: 'json' };
import usersVi from '@modules/users/locales/vi/users.json' with { type: 'json' };
import usersEn from '@modules/users/locales/en/users.json' with { type: 'json' };
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
import { PermissionRepository } from '@modules/roles/repositories/permission.repository.js';
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
import type { AuthVerificationCodeEntity } from '@modules/auth/entities/auth-verification-code.entity.js';
import type { AuthServiceAccountEntity } from '@modules/auth/entities/auth-service-account.entity.js';
import type { AuthApiClientEntity } from '@modules/auth/entities/auth-api-client.entity.js';
import type { AuthLoginHistoryEntity } from '@modules/auth/entities/auth-login-history.entity.js';
import type { AuthSessionRepository } from '@modules/auth/repositories/auth-session.repository.js';
import type { AuthMfaConfigRepository } from '@modules/auth/repositories/auth-mfa-config.repository.js';
import type { AuthPasswordResetRepository } from '@modules/auth/repositories/auth-password-reset.repository.js';
import type { AuthSecuritySettingRepository } from '@modules/auth/repositories/auth-security-setting.repository.js';
import type { AuthVerificationCodeRepository } from '@modules/auth/repositories/auth-verification-code.repository.js';
import type { AuthServiceAccountRepository } from '@modules/auth/repositories/auth-service-account.repository.js';
import type { AuthApiClientRepository } from '@modules/auth/repositories/auth-api-client.repository.js';
import type { AuthLoginHistoryRepository } from '@modules/auth/repositories/auth-login-history.repository.js';
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
import {
  CODE_ITEM_STATUS,
  computeFeatureFlagRolloutBucket,
  defaultCodeRegistry,
  FeatureFlagRegistryService,
  SETTING_VALUE_TYPE,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import type { CodeTypeEntity } from '@modules/codes/entities/code-type.entity.js';
import type { CodeValueEntity } from '@modules/codes/entities/code-value.entity.js';
import type { CodeTypeRepository } from '@modules/codes/repositories/code-type.repository.js';
import type { CodeValueRepository } from '@modules/codes/repositories/code-value.repository.js';
import { CodesService } from '@modules/codes/services/codes.service.js';
import { FeatureFlagsService } from '@modules/settings/services/feature-flags.service.js';
import { SettingsService } from '@modules/settings/services/settings.service.js';
import { MasterPermissionSeeder } from '../../../src/database/seeders/master-permission.seeder.js';

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
          partial.description !== undefined ? partial.description : (existing?.description ?? null),
        status: partial.status ?? existing?.status ?? PERMISSION_STATUS.ACTIVE,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      } as PermissionEntity;
      permStore.set(entity.id, entity);
      return entity;
    },
    upsertCatalogItems: PermissionRepository.prototype.upsertCatalogItems,
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
      const existing = partial.id ? roleStore.get(Number(partial.id)) : undefined;
      const code = partial.code ?? existing?.code ?? '';
      const entity: RoleEntity = {
        id: partial.id ?? existing?.id ?? ++roleSeq,
        code,
        name: partial.name ?? existing?.name ?? code,
        description:
          partial.description !== undefined ? partial.description : (existing?.description ?? null),
        isSystem: partial.isSystem ?? existing?.isSystem ?? false,
        dataScope:
          partial.dataScope ?? existing?.dataScope ?? inferDefaultDataScopeForRoleCode(code),
        status: partial.status ?? existing?.status ?? ROLE_STATUS.ACTIVE,
        createdAt: partial.createdAt ?? existing?.createdAt ?? now,
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
          partial.dateOfBirth !== undefined ? partial.dateOfBirth : (existing?.dateOfBirth ?? null),
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
    findSubordinateUserIds: async (managerUserId: number, maxDepth = 10) => {
      const rootId = Number(managerUserId);
      if (!Number.isFinite(rootId) || rootId <= 0) return [];
      const visited = new Set<number>([rootId]);
      const subordinates: number[] = [];
      let frontier: number[] = [rootId];
      for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
        const frontierSet = new Set(frontier);
        const directReports = [...userStore.values()]
          .filter(
            (u) =>
              !u.deletedAt &&
              !u.archivedAt &&
              u.managerId !== null &&
              frontierSet.has(Number(u.managerId)),
          )
          .map((u) => Number(u.id));
        const nextFrontier: number[] = [];
        for (const uid of directReports) {
          if (!visited.has(uid)) {
            visited.add(uid);
            subordinates.push(uid);
            nextFrontier.push(uid);
          }
        }
        frontier = nextFrontier;
      }
      return subordinates;
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
        failedLoginAttempts: partial.failedLoginAttempts ?? existing?.failedLoginAttempts ?? 0,
        mfaEnabled: partial.mfaEnabled ?? existing?.mfaEnabled ?? false,
        primaryOrganizationUnitId:
          partial.primaryOrganizationUnitId !== undefined
            ? partial.primaryOrganizationUnitId
            : (existing?.primaryOrganizationUnitId ?? null),
        managerId:
          partial.managerId !== undefined ? partial.managerId : (existing?.managerId ?? null),
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
      if (filter.scopeFilter && !filter.scopeFilter.isUnrestricted) {
        const sf = filter.scopeFilter;
        const allowedUsers = new Set(sf.allowedUserIds.map(Number));
        const allowedOrgs = new Set(sf.allowedOrganizationUnitIds.map(Number));
        if (sf.effectiveScopeName === 'ORG_UNIT') {
          list = list.filter((u) => {
            if (allowedUsers.has(u.id)) return true;
            if (
              u.primaryOrganizationUnitId &&
              allowedOrgs.has(Number(u.primaryOrganizationUnitId))
            ) {
              return true;
            }
            return userOrgStore.some(
              (uo) => uo.userId === u.id && allowedOrgs.has(Number(uo.organizationUnitId)),
            );
          });
        } else {
          list = list.filter((u) => allowedUsers.has(u.id));
        }
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
    findByRoleIds: async (roleIds: readonly number[]) => {
      const set = new Set(roleIds.map(Number));
      return userRoleStore.filter((ur) => set.has(ur.roleId));
    },
    findUserIdsByRoleIds: async (roleIds: readonly number[]) => {
      const set = new Set(roleIds.map(Number));
      return [...new Set(userRoleStore.filter((ur) => set.has(ur.roleId)).map((ur) => ur.userId))];
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
      statusHistoryStore.filter((h) => h.userId === Number(userId)).sort((a, b) => b.id - a.id),
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
      [...resetStore.values()].sort((a, b) => b.id - a.id).find((r) => r.otpCodeHash === otpHash) ??
      null,
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
          partial.otpCodeHash !== undefined ? partial.otpCodeHash : (existing?.otpCodeHash ?? null),
        attemptCount: partial.attemptCount ?? existing?.attemptCount ?? 0,
        maxAttempts: partial.maxAttempts ?? existing?.maxAttempts ?? 5,
        expiresAt: partial.expiresAt ?? existing!.expiresAt,
        usedAt: partial.usedAt !== undefined ? partial.usedAt : (existing?.usedAt ?? null),
        requestedIp:
          partial.requestedIp !== undefined ? partial.requestedIp : (existing?.requestedIp ?? null),
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
  } as unknown as AuthSecuritySettingRepository;

  let verificationSeq = 0;
  const verificationStore = new Map<number, AuthVerificationCodeEntity>();
  const verificationRepo = {
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
          (r) => r.channel === channel && !r.verifiedAt && r.codeHash.split(':').includes(codeHash),
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
          partial.requestedIp !== undefined ? partial.requestedIp : (existing?.requestedIp ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      } as AuthVerificationCodeEntity;
      verificationStore.set(Number(entity.id), entity);
      return entity;
    },
  } as unknown as AuthVerificationCodeRepository;

  let saSeq = 0;
  const saStore = new Map<number, AuthServiceAccountEntity>();
  const serviceAccountRepo = {
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
          partial.description !== undefined ? partial.description : (existing?.description ?? null),
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
  } as unknown as AuthServiceAccountRepository;

  let apiClientSeq = 0;
  const apiClientStore = new Map<number, AuthApiClientEntity>();
  const apiClientRepo = {
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
          partial.description !== undefined ? partial.description : (existing?.description ?? null),
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
  } as unknown as AuthApiClientRepository;

  let loginHistorySeq = 0;
  const loginHistoryStore: AuthLoginHistoryEntity[] = [];
  const loginHistoryRepo = {
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
  } as unknown as AuthLoginHistoryRepository;

  const requestContextService = new RequestContextService();
  const auditLogService = new AuditLogService();
  const platformSecurityService = new PlatformSecurityService(config, auditLogService);
  const dataScopeService = new DataScopeService();
  const organizationsService = new OrganizationsService(
    orgRepo,
    new OrganizationsMapper(),
    dataScopeService,
    auditLogService,
  );
  const rolesService = new RolesService(
    roleRepo,
    rolePermRepo,
    new RolesMapper(),
    permRepo,
    null,
    dataScopeService,
    auditLogService,
    platformSecurityService,
  );
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
    dataScopeService,
    auditLogService,
    platformSecurityService,
  );
  const importService = new UserImportService(
    usersService,
    userRepo,
    rolesService,
    organizationsService,
  );
  const exportService = new UserExportService(
    usersService,
    userRepo,
    auditLogService,
    platformSecurityService,
  );
  const emailAdapter = new DefaultEmailNotificationAdapter();
  const smsProvider = new DefaultSmsOtpProvider();
  const securitySettingsService = new SecuritySettingsService(securitySettingRepo);
  const sessionService = new SessionService(
    sessionRepo,
    tokenService,
    passwordHasher,
    config,
    undefined,
    securitySettingsService,
    loginHistoryRepo,
    auditLogService,
    platformSecurityService,
  );
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
    verificationRepo,
    securitySettingsService,
    config,
    emailAdapter,
    smsProvider,
  );
  const serviceAccountService = new ServiceAccountService(
    passwordHasher,
    tokenService,
    serviceAccountRepo,
    apiClientRepo,
    auditLogService,
  );
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
    roleRepo,
    fieldEncryption,
    emailAdapter,
    smsProvider,
    securitySettingsService,
    totpService,
    tokenService,
    requestContextService,
    auditLogService,
    platformSecurityService,
    dataScopeService,
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
    await expect(h.authService.refresh({ refreshToken: login1.refreshToken! })).rejects.toThrow();

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
    await expect(h.verificationService.sendPhoneOtp({ phone: '0912345678' })).rejects.toThrow();

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
    await expect(h.authService.refresh({ refreshToken: dev1.refreshToken! })).rejects.toThrow();
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
    await expect(h.authService.refresh({ refreshToken: dev3.refreshToken! })).rejects.toThrow();
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
        scopes: [],
      }),
    ).rejects.toThrow();

    // 2. Tạo API Client gắn với Service Account (3.6.2, 3.6.3, 3.6.4, 3.6.6)
    // Nếu gán scope vượt quá phạm vi của Service Account ('users.delete' không nằm trong SA scopes) -> bị từ chối
    await expect(
      h.serviceAccountService.createApiClient({
        serviceAccountId: sa.id,
        name: 'Invalid Scope Client',
        scopes: ['users.read', 'users.delete'],
        allowedIps: [],
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
    expect((fetchedClient as unknown as Record<string, unknown>).clientSecret).toBeUndefined();
    expect(fetchedClient.secretPrefix).toBe(`${createdClient.clientSecret.slice(0, 10)}...`);

    const allClients = await h.serviceAccountService.listApiClients(sa.id);
    expect(allClients).toHaveLength(1);
    expect((allClients[0] as unknown as Record<string, unknown>).clientSecret).toBeUndefined();

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
      revokeExistingTokens: true,
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

  it('validates Section 4.1 Role Management: create, update name/desc without changing code, set permissions, assign multiple roles, clone role, lock system role, view assigned users & block deleting in-use role', async () => {
    // 1. Tạo mới vai trò tùy chỉnh (ví dụ: manager, staff, student)
    const managerRole = await h.rolesService.create({
      code: 'manager',
      name: 'Manager',
      description: 'Quản lý bộ phận',
      permissions: ['users.read', 'users.update', 'organizations.read'],
    });
    const studentRole = await h.rolesService.create({
      code: 'student',
      name: 'Student',
      description: 'Học viên hệ thống',
      permissions: ['courses.read'],
    });

    expect(managerRole.code).toBe('manager');
    expect(managerRole.isSystem).toBe(false);
    expect(managerRole.userCount).toBe(0);
    expect(managerRole.permissions).toEqual(['users.read', 'users.update', 'organizations.read']);

    // 2. Cập nhật tên và mô tả vai trò (mã code hệ thống giữ nguyên bất biến)
    const updatedManager = await h.rolesService.update(managerRole.id, {
      name: 'Department Manager Updated',
      description: 'Mô tả vai trò quản lý đã cập nhật',
    });
    expect(updatedManager.code).toBe('manager');
    expect(updatedManager.name).toBe('Department Manager Updated');
    expect(updatedManager.description).toBe('Mô tả vai trò quản lý đã cập nhật');

    // 3. Gán quyền cho vai trò (setPermissions)
    const afterSetPerms = await h.rolesService.setPermissions(managerRole.id, {
      permissions: ['users.read', 'users.update', 'users.export', 'roles.read'],
    });
    expect(afterSetPerms.permissions).toEqual([
      'users.read',
      'users.update',
      'users.export',
      'roles.read',
    ]);

    // 4. Sao chép vai trò (Clone Role): tạo role mới từ role hiện có
    const clonedRole = await h.rolesService.clone(managerRole.id, {
      code: 'assistant_manager',
      name: 'Assistant Manager',
    });
    expect(clonedRole.id).not.toBe(managerRole.id);
    expect(clonedRole.code).toBe('assistant_manager');
    expect(clonedRole.name).toBe('Assistant Manager');
    expect(clonedRole.isSystem).toBe(false);
    expect(clonedRole.permissions).toEqual(afterSetPerms.permissions);
    expect(clonedRole.description).toContain('Cloned from manager');

    // 5. Gán nhiều vai trò cho người dùng
    const user1 = await h.usersService.create({
      email: 'multi.role.user@gmail.com',
      username: 'multirole01',
      firstName: 'Hùng',
      lastName: 'Trần Văn',
      password: 'Password@123',
      status: USER_STATUS.ACTIVE,
      roleIds: [managerRole.id],
      organizationUnits: [],
    });
    const assignedMulti = await h.usersService.assignRoles(user1.id, {
      roleIds: [managerRole.id, studentRole.id, clonedRole.id],
    });
    expect(assignedMulti.roles.map((r) => r.code).sort()).toEqual([
      'assistant_manager',
      'manager',
      'student',
    ]);

    // 6. Xem danh sách người đang sử dụng vai trò & kiểm tra userCount trước khi thay đổi hoặc xóa
    const fetchedCloned = await h.rolesService.getById(clonedRole.id);
    expect(fetchedCloned.userCount).toBe(1);

    const assignedUsers = await h.rolesService.listAssignedUsers(clonedRole.id);
    expect(assignedUsers).toHaveLength(1);
    expect(assignedUsers[0]?.id).toBe(user1.id);
    expect(assignedUsers[0]?.email).toBe('multi.role.user@gmail.com');
    expect(assignedUsers[0]?.fullName).toBe('Trần Văn Hùng');

    // 7. Chặn xóa vai trò đang có người sử dụng (userCount > 0)
    await expect(h.rolesService.remove(clonedRole.id)).rejects.toThrow();

    // Sau khi gỡ người dùng khỏi vai trò clonedRole -> xóa mềm thành công
    await h.usersService.assignRoles(user1.id, {
      roleIds: [managerRole.id, studentRole.id],
    });
    const assignedAfterUnlink = await h.rolesService.listAssignedUsers(clonedRole.id);
    expect(assignedAfterUnlink).toHaveLength(0);

    const removedRes = await h.rolesService.remove(clonedRole.id);
    expect(removedRes).toEqual({ deleted: true, id: clonedRole.id });

    // 8. Khóa vai trò hệ thống (isSystem = true): không cho xóa và không cho vô hiệu hóa
    const savedSysRole = await h.roleRepo.saveEntity({
      code: 'super_admin',
      name: 'Super Admin',
      isSystem: true,
      status: ROLE_STATUS.ACTIVE,
    });
    const sysRole = await h.rolesService.getById(savedSysRole.id);
    expect(sysRole.isSystem).toBe(true);
    await expect(h.rolesService.remove(sysRole.id)).rejects.toThrow();
    await expect(
      h.rolesService.update(sysRole.id, { status: ROLE_STATUS.INACTIVE }),
    ).rejects.toThrow();
  });

  it('validates Section 4.2 Permission Management: module permission registration, idempotent sync, functional grouping, orphan warnings & role-permission summary matrix', async () => {
    // 1. Đăng ký danh sách quyền theo module mới (ví dụ module 'courses')
    h.rolesService.registerModulePermissions({
      module: 'courses',
      displayName: 'Courses & Curriculum',
      permissions: [
        {
          code: 'courses.read',
          name: 'Xem khóa học',
          featureGroup: 'courses.catalog',
          description: 'Quyền xem danh sách khóa học',
        },
        {
          code: 'courses.publish',
          name: 'Xuất bản khóa học',
          featureGroup: 'courses.publishing',
          description: 'Quyền xuất bản khóa học',
        },
      ],
    });

    // 2. Đồng bộ quyền lần 1 (Idempotent Sync) -> tạo mới các quyền của toàn bộ module đã đăng ký
    const sync1 = await h.rolesService.syncModulePermissions();
    expect(sync1.totalDeclared).toBeGreaterThanOrEqual(19);
    expect(sync1.createdCount).toBe(sync1.totalDeclared);
    expect(sync1.unchangedCount).toBe(0);
    expect(sync1.orphanedCount).toBe(0);
    expect(sync1.syncedModules).toEqual(
      expect.arrayContaining(['users', 'roles', 'organizations', 'auth', 'system-ops', 'courses']),
    );

    // 3. Đồng bộ lại lần 2 -> không tạo trùng quyền (createdCount = 0, unchangedCount = totalDeclared)
    const sync2 = await h.rolesService.syncModulePermissions();
    expect(sync2.createdCount).toBe(0);
    expect(sync2.unchangedCount).toBe(sync1.totalDeclared);

    // 4. Tạo 2 vai trò gắn quyền chuẩn và 1 quyền cũ không còn thuộc module nào ('legacy_billing.export')
    const instructorRole = await h.rolesService.create({
      code: 'instructor',
      name: 'Instructor',
      permissions: ['courses.read', 'courses.publish', 'users.read'],
    });
    const legacyAuditorRole = await h.rolesService.create({
      code: 'legacy_auditor',
      name: 'Legacy Auditor',
      permissions: ['users.read', 'legacy_billing.export'],
    });

    // 5. Nhóm quyền theo chức năng (listPermissionsGrouped)
    const grouped = await h.rolesService.listPermissionsGrouped();
    expect(grouped.length).toBeGreaterThanOrEqual(6);
    const coursePublishGroup = grouped.find((g) => g.featureGroup === 'courses.publishing');
    expect(coursePublishGroup).toBeDefined();
    expect(coursePublishGroup?.module).toBe('courses');
    expect(coursePublishGroup?.moduleDisplayName).toBe('Courses & Curriculum');
    expect(coursePublishGroup?.permissions.map((p) => p.code)).toEqual(['courses.publish']);

    // 6. Cảnh báo quyền không còn module sử dụng (listOrphanedPermissions)
    const orphans = await h.rolesService.listOrphanedPermissions();
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.code).toBe('legacy_billing.export');
    expect(orphans[0]?.assignedRoles.map((r) => r.code)).toEqual([legacyAuditorRole.code]);
    expect(orphans[0]?.warningMessage).toContain('legacy_billing.export');

    // 7. Bảng ma trận tổng hợp Vai trò × Quyền toàn hệ thống (getPermissionMatrix)
    const matrix = await h.rolesService.getPermissionMatrix();
    expect(matrix.summary.totalRoles).toBe(2);
    expect(matrix.summary.totalOrphanedPermissions).toBe(1);
    expect(matrix.roles.map((r) => r.code)).toEqual([instructorRole.code, legacyAuditorRole.code]);

    const publishRow = matrix.rows.find((row) => row.code === 'courses.publish');
    expect(publishRow).toBeDefined();
    expect(publishRow?.isOrphaned).toBe(false);
    expect(publishRow?.roleGrants).toEqual({
      instructor: true,
      legacy_auditor: false,
    });

    const orphanRow = matrix.rows.find((row) => row.code === 'legacy_billing.export');
    expect(orphanRow).toBeDefined();
    expect(orphanRow?.isOrphaned).toBe(true);
    expect(orphanRow?.roleGrants).toEqual({
      instructor: false,
      legacy_auditor: true,
    });
  });

  it('validates Section 4.3 Data Scope (Phạm vi dữ liệu) & Backend i18n (vi/en): SELF, ORG_UNIT, SUBORDINATES, ALL, list & export scoping, anti-IDOR detail check (403), and custom module scope rules', async () => {
    // 0. Kiểm tra Backend i18n (vi & en) cho Core + các module IAM
    const i18n = new CoreI18nService();
    i18n.registerNamespace('roles', { vi: rolesVi, en: rolesEn });
    i18n.registerNamespace('users', { vi: usersVi, en: usersEn });

    expect(i18n.t('security.dataScopeForbidden', undefined, 'vi')).toContain('phạm vi dữ liệu');
    expect(i18n.t('security.dataScopeForbidden', undefined, 'en')).toContain('Data Scope');
    expect(i18n.t('roles.dataScopeAllNotAllowedForRole', undefined, 'vi')).toContain(
      'toàn hệ thống (ALL)',
    );
    expect(i18n.t('roles.dataScopeAllNotAllowedForRole', undefined, 'en')).toContain('System-wide');
    expect(i18n.t('users.circularManagerHierarchy', undefined, 'vi')).toContain('vòng lặp');
    expect(i18n.t('users.circularManagerHierarchy', undefined, 'en')).toContain('Circular');

    // 1. Tạo cây đơn vị: HQ -> Branch HN -> Dept Sales HN; và Branch HCM độc lập
    const hq = await h.organizationsService.create({
      code: 'HQ',
      name: 'Trụ sở chính',
      type: ORGANIZATION_UNIT_TYPE.HEADQUARTERS,
    });
    const branchHn = await h.organizationsService.create({
      code: 'BR_HN',
      name: 'Chi nhánh Hà Nội',
      type: ORGANIZATION_UNIT_TYPE.BRANCH,
      parentId: hq.id,
    });
    const deptSalesHn = await h.organizationsService.create({
      code: 'DEPT_SALES_HN',
      name: 'Phòng Kinh doanh HN',
      type: ORGANIZATION_UNIT_TYPE.DEPARTMENT,
      parentId: branchHn.id,
    });
    const branchHcm = await h.organizationsService.create({
      code: 'BR_HCM',
      name: 'Chi nhánh TP.HCM',
      type: ORGANIZATION_UNIT_TYPE.BRANCH,
      parentId: hq.id,
    });

    // Kiểm tra resolveDescendantUnitIds trên cây đơn vị
    const hnTreeIds = await h.organizationsService.resolveDescendantUnitIds([branchHn.id]);
    expect(hnTreeIds).toEqual(expect.arrayContaining([branchHn.id, deptSalesHn.id]));
    expect(hnTreeIds).not.toContain(branchHcm.id);

    // 2. Tạo 4 vai trò đại diện 4 phạm vi dữ liệu: ALL (1), ORG_UNIT (2), SUBORDINATES (3), SELF (4)
    expect(inferDefaultDataScopeForRoleCode('super_admin')).toBe(DATA_SCOPE.ALL);
    expect(inferDefaultDataScopeForRoleCode('branch_director')).toBe(DATA_SCOPE.ORG_UNIT);
    expect(inferDefaultDataScopeForRoleCode('team_leader')).toBe(DATA_SCOPE.SUBORDINATES);
    expect(inferDefaultDataScopeForRoleCode('regular_member')).toBe(DATA_SCOPE.SELF);

    // Chặn vai trò thường không có quyền toàn hệ thống tự xin DATA_SCOPE.ALL
    await expect(
      h.rolesService.create({
        code: 'normal_staff_trying_all',
        name: 'Normal Staff Trying ALL',
        dataScope: DATA_SCOPE.ALL,
        permissions: ['users.read'],
      }),
    ).rejects.toThrow();

    const roleAdminAll = await h.rolesService.create({
      code: 'super_admin',
      name: 'Super Admin',
      dataScope: DATA_SCOPE.ALL,
      permissions: ['system.full_access', 'users.read'],
    });
    const roleBranchMgr = await h.rolesService.create({
      code: 'branch_director',
      name: 'Giám đốc Chi nhánh',
      dataScope: DATA_SCOPE.ORG_UNIT,
      permissions: ['users.read'],
    });
    const roleTeamLead = await h.rolesService.create({
      code: 'team_leader',
      name: 'Trưởng nhóm',
      dataScope: DATA_SCOPE.SUBORDINATES,
      permissions: ['users.read'],
    });
    const roleSelfMember = await h.rolesService.create({
      code: 'member',
      name: 'Nhân viên',
      dataScope: DATA_SCOPE.SELF,
      permissions: ['users.read'],
    });

    // 3. Tạo người dùng theo cây đơn vị và cây quản lý (managerId):
    // adminAll (HQ) -> branchMgrHn (BR_HN) -> teamLeadHn (DEPT_SALES_HN) -> staffHn1 (DEPT_SALES_HN)
    // outsiderHcm (BR_HCM)
    const adminAll = await h.usersService.create({
      email: 'admin.all@example.com',
      firstName: 'Admin',
      lastName: 'All',
      password: 'Password@123',
      status: USER_STATUS.ACTIVE,
      roleIds: [roleAdminAll.id],
      organizationUnits: [{ organizationUnitId: hq.id, isPrimary: true }],
    });
    const branchMgrHn = await h.usersService.create({
      email: 'mgr.hn@example.com',
      firstName: 'Manager',
      lastName: 'Hanoi',
      password: 'Password@123',
      status: USER_STATUS.ACTIVE,
      managerId: adminAll.id,
      roleIds: [roleBranchMgr.id],
      organizationUnits: [{ organizationUnitId: branchHn.id, isPrimary: true }],
    });
    const teamLeadHn = await h.usersService.create({
      email: 'lead.hn@example.com',
      firstName: 'Lead',
      lastName: 'Hanoi',
      password: 'Password@123',
      status: USER_STATUS.ACTIVE,
      managerId: branchMgrHn.id,
      roleIds: [roleTeamLead.id],
      organizationUnits: [{ organizationUnitId: deptSalesHn.id, isPrimary: true }],
    });
    const staffHn1 = await h.usersService.create({
      email: 'staff1.hn@example.com',
      firstName: 'Staff 1',
      lastName: 'Hanoi',
      password: 'Password@123',
      status: USER_STATUS.ACTIVE,
      managerId: teamLeadHn.id,
      roleIds: [roleSelfMember.id],
      organizationUnits: [{ organizationUnitId: deptSalesHn.id, isPrimary: true }],
    });
    const outsiderHcm = await h.usersService.create({
      email: 'outsider.hcm@example.com',
      firstName: 'Outsider',
      lastName: 'HCM',
      password: 'Password@123',
      status: USER_STATUS.ACTIVE,
      managerId: adminAll.id,
      roleIds: [roleSelfMember.id],
      organizationUnits: [{ organizationUnitId: branchHcm.id, isPrimary: true }],
    });

    // Chặn tự gán chính mình làm quản lý hoặc tạo vòng lặp cây quản lý (Circular manager hierarchy)
    await expect(
      h.usersService.update(teamLeadHn.id, { managerId: teamLeadHn.id }),
    ).rejects.toThrow();
    await expect(
      h.usersService.update(branchMgrHn.id, { managerId: staffHn1.id }),
    ).rejects.toThrow();

    // 4. Tạo Principal (UserIdentity) cho từng người dùng để kiểm tra Data Scope thực thi ở Backend
    const makePrincipal = (
      u: Awaited<ReturnType<typeof h.usersService.getById>>,
      effectiveDataScope: 1 | 2 | 3 | 4,
    ) => ({
      id: u.id,
      sessionId: 1,
      email: u.email,
      roles: u.roles.map((r) => r.code),
      permissions: ['users.read'],
      organizationUnitIds: u.organizationUnits.map((o) => o.organizationUnitId),
      primaryOrganizationUnitId: u.primaryOrganizationUnitId,
      dataScope: effectiveDataScope,
      dataScopes: [effectiveDataScope],
    });

    const principalSelf = makePrincipal(staffHn1, DATA_SCOPE.SELF);
    const principalSubordinates = makePrincipal(teamLeadHn, DATA_SCOPE.SUBORDINATES);
    const principalOrgUnit = makePrincipal(branchMgrHn, DATA_SCOPE.ORG_UNIT);
    const principalAll = makePrincipal(adminAll, DATA_SCOPE.ALL);

    const baseQuery = {
      page: 1,
      limit: 20,
      sortBy: 'id' as const,
      sortOrder: 'ASC' as const,
    };

    // 5. Áp dụng phạm vi vào danh sách (listPaginated) và báo cáo (exportUsersCsv)
    // 5a. SELF (4): staffHn1 chỉ thấy chính mình
    const listSelf = await h.usersService.listPaginated(baseQuery, principalSelf);
    expect(listSelf.data.map((u) => u.id)).toEqual([staffHn1.id]);
    const csvSelf = await h.exportService.exportUsersCsv(baseQuery, principalSelf);
    expect(csvSelf.totalExported).toBe(1);
    expect(csvSelf.csvContent).toContain('staff1.hn@example.com');
    expect(csvSelf.csvContent).not.toContain('lead.hn@example.com');
    expect(csvSelf.csvContent).not.toContain('outsider.hcm@example.com');

    // 5b. SUBORDINATES (3): teamLeadHn thấy chính mình + cấp dưới trực tiếp/gián tiếp (staffHn1)
    const listSub = await h.usersService.listPaginated(baseQuery, principalSubordinates);
    expect(listSub.data.map((u) => u.id).sort()).toEqual([teamLeadHn.id, staffHn1.id].sort());
    expect(listSub.data.map((u) => u.id)).not.toContain(branchMgrHn.id);
    expect(listSub.data.map((u) => u.id)).not.toContain(outsiderHcm.id);

    // 5c. ORG_UNIT (2): branchMgrHn thuộc BR_HN -> thấy nhân sự thuộc BR_HN và đơn vị con DEPT_SALES_HN, không thấy BR_HCM
    const listOrg = await h.usersService.listPaginated(baseQuery, principalOrgUnit);
    expect(listOrg.data.map((u) => u.id).sort()).toEqual(
      [branchMgrHn.id, teamLeadHn.id, staffHn1.id].sort(),
    );
    expect(listOrg.data.map((u) => u.id)).not.toContain(outsiderHcm.id);
    const csvOrg = await h.exportService.exportUsersCsv(baseQuery, principalOrgUnit);
    expect(csvOrg.totalExported).toBe(3);
    expect(csvOrg.csvContent).toContain('mgr.hn@example.com');
    expect(csvOrg.csvContent).toContain('staff1.hn@example.com');
    expect(csvOrg.csvContent).not.toContain('outsider.hcm@example.com');

    // 5d. ALL (1): adminAll thấy toàn bộ 5 người dùng trên hệ thống
    const listAll = await h.usersService.listPaginated(baseQuery, principalAll);
    expect(listAll.data).toHaveLength(5);

    // 6. Kiểm tra phạm vi trước khi xem chi tiết (Anti-IDOR — ngăn truy cập bằng cách đổi ID)
    // staffHn1 (SELF) xem chính mình -> OK, nhưng đổi sang ID của teamLeadHn hoặc outsiderHcm -> bị chặn 403
    const selfDetail = await h.usersService.getById(staffHn1.id, false, principalSelf);
    expect(selfDetail.id).toBe(staffHn1.id);
    await expect(h.usersService.getById(teamLeadHn.id, false, principalSelf)).rejects.toThrow();
    await expect(h.usersService.getStatusHistory(outsiderHcm.id, principalSelf)).rejects.toThrow();

    // branchMgrHn (ORG_UNIT) xem nhân sự trong phòng con DEPT_SALES_HN -> OK, nhưng xem outsiderHcm -> 403
    const subUnitDetail = await h.usersService.getById(staffHn1.id, false, principalOrgUnit);
    expect(subUnitDetail.id).toBe(staffHn1.id);
    await expect(h.usersService.getById(outsiderHcm.id, false, principalOrgUnit)).rejects.toThrow();

    // 7. Cho phép module nghiệp vụ bổ sung rule phạm vi riêng (registerResourceRule) mà không sửa trực tiếp Core
    h.dataScopeService.registerResourceRule({
      code: 'courses.co_instructor',
      name: 'Co-Instructor Course Access',
      module: 'courses',
      resource: 'courses',
      description:
        'Cho phép giảng viên đồng phụ trách (coInstructorIds) xem khóa học ngoài phạm vi mặc định',
      evaluate: ({ actor, target }) => {
        if (!target) {
          return {
            filterOverride: {
              customAttributes: { includeCoInstructorCourses: true },
            },
          };
        }
        const coInstructors = (target.attributes?.['coInstructorIds'] as number[]) ?? [];
        if (coInstructors.includes(actor.id)) {
          return { allow: true };
        }
        return undefined;
      },
    });

    const registeredRules = h.dataScopeService.listRegisteredRules('courses');
    expect(
      registeredRules.some(
        (r) =>
          r.module === 'courses' && r.resource === 'courses' && r.code === 'courses.co_instructor',
      ),
    ).toBe(true);

    const courseFilter = await h.dataScopeService.resolveScopeFilter(principalSelf, 'courses');
    expect(courseFilter.customAttributes?.includeCoInstructorCourses).toBe(true);
    expect(courseFilter.appliedRuleCodes).toContain('courses.co_instructor');

    // Bản ghi khóa học thuộc người khác (ownerId = 999), nhưng staffHn1 nằm trong coInstructorIds -> được phép truy cập!
    await expect(
      h.dataScopeService.assertCanAccessRecord(principalSelf, 'courses', {
        id: 501,
        ownerId: 999,
        primaryOrganizationUnitId: branchHcm.id,
        attributes: { coInstructorIds: [staffHn1.id] },
      }),
    ).resolves.toBeDefined();

    // Nếu không nằm trong coInstructorIds -> bị chặn 403 Forbidden
    await expect(
      h.dataScopeService.assertCanAccessRecord(principalSelf, 'courses', {
        id: 502,
        ownerId: 999,
        primaryOrganizationUnitId: branchHcm.id,
        attributes: { coInstructorIds: [teamLeadHn.id] },
      }),
    ).rejects.toThrow();
  });

  it('validates Section 4.4 Audit Log: actor (User ID & Service Account), timestamp & IP, module & feature, before/after snapshot with sensitive redaction, reason, Request ID & Correlation ID, filtered query API, and append-only immutability (403 Forbidden)', async () => {
    // 0. Kiểm tra cơ chế tự động che (redact) dữ liệu nhạy cảm trong beforeData / afterData (Mục 4.4.4)
    const sanitized = sanitizeAuditSnapshot({
      id: 99,
      username: 'auditor01',
      password: 'PlainPassword@123',
      passwordHash: 'scrypt$secret',
      clientSecret: 'cs_super_secret',
      nested: {
        totpSecret: 'BASE32SECRET',
        normalField: 'visible-value',
      },
    });
    expect(sanitized).toEqual({
      id: 99,
      username: 'auditor01',
      password: '[REDACTED]',
      passwordHash: '[REDACTED]',
      clientSecret: '[REDACTED]',
      nested: {
        totpSecret: '[REDACTED]',
        normalField: 'visible-value',
      },
    });

    // 1. Giả lập RequestContext (AsyncLocalStorage) có đầy đủ Request ID, Correlation ID, IP, User-Agent và Actor User (Mục 4.4.1, 4.4.2, 4.4.6)
    await h.requestContextService.run(
      {
        correlationId: 'corr-audit-44-001',
        requestId: 'req-audit-44-001',
        userId: '1',
        ipAddress: '10.20.30.40',
        userAgent: 'Jest-Audit-Agent/1.0',
        actor: {
          id: 1,
          username: 'superadmin',
          email: 'superadmin@gmail.com',
          roles: ['super_admin'],
          permissions: ['*'],
        },
      },
      async () => {
        // 1a. Thao tác tạo mới & cập nhật Role (module: 'roles', feature: 'role-management')
        const role = await h.rolesService.create({
          code: 'auditor_lead',
          name: 'Auditor Lead',
          description: 'Trưởng nhóm kiểm toán',
          dataScope: DATA_SCOPE.ORG_UNIT,
          permissions: ['users.read', 'roles.read'],
        });
        await h.rolesService.update(role.id, {
          name: 'Senior Auditor Lead',
          dataScope: DATA_SCOPE.SUBORDINATES,
        });

        // 1b. Thao tác tạo User, khóa User kèm lý do và mở khóa User (module: 'users', feature: 'user-status' — Mục 4.4.4 & 4.4.5)
        const targetUser = await h.usersService.create(
          {
            email: 'target.audit@example.com',
            username: 'target_audit',
            firstName: 'An',
            lastName: 'Nguyễn Văn',
            password: 'Password@123',
            status: USER_STATUS.ACTIVE,
            roleIds: [role.id],
            organizationUnits: [],
          },
          1,
        );

        await h.usersService.lockUser(
          targetUser.id,
          {
            reason: 'Phát hiện đăng nhập bất thường từ IP lạ',
          },
          1,
        );

        await h.usersService.unlockUser(targetUser.id, 1);
      },
    );

    // 2. Thao tác bởi Service Account / API Client (Mục 4.4.1: actorType = SERVICE_ACCOUNT = 2)
    const sa = await h.serviceAccountService.createServiceAccount(
      {
        code: 'SA_AUDIT_SYNC',
        name: 'Audit Sync Worker',
        scopes: ['users.read'],
      },
      1,
    );
    const apiClient = await h.serviceAccountService.createApiClient(
      {
        serviceAccountId: sa.id,
        name: 'Audit Sync Client',
        scopes: ['users.read'],
        allowedIps: ['172.16.99.10'],
      },
      1,
    );

    await h.requestContextService.run(
      {
        correlationId: 'corr-sa-44-002',
        requestId: 'req-sa-44-002',
        ipAddress: '172.16.99.10',
        userAgent: 'SyncWorker/2.0',
      },
      async () => {
        await h.serviceAccountService.issueClientToken(
          {
            clientId: apiClient.clientId,
            clientSecret: apiClient.clientSecret,
          },
          { ipAddress: '172.16.99.10' },
        );
      },
    );

    // 3. Tra cứu Audit Log qua API RolesService.listAuditLogs với các bộ lọc (Mục 4.4.7)
    // 3a. Lọc theo module = 'roles' và action = 'ROLE_UPDATED'
    const roleUpdateLogs = await h.rolesService.listAuditLogs({
      module: 'roles',
      action: 'ROLE_UPDATED',
      page: 1,
      limit: 20,
    });
    expect(roleUpdateLogs.data).toHaveLength(1);
    const roleLog = roleUpdateLogs.data[0]!;
    expect(roleLog.actorType).toBe(AUDIT_ACTOR_TYPE.USER);
    expect(roleLog.actorTypeName).toBe('USER');
    expect(roleLog.actorUserId).toBe(1);
    expect(roleLog.actorIdentifier).toBe('superadmin@gmail.com');
    expect(roleLog.ipAddress).toBe('10.20.30.40');
    expect(roleLog.requestId).toBe('req-audit-44-001');
    expect(roleLog.correlationId).toBe('corr-audit-44-001');
    expect(roleLog.beforeData).toMatchObject({
      code: 'auditor_lead',
      name: 'Auditor Lead',
      dataScope: DATA_SCOPE.ORG_UNIT,
    });
    expect(roleLog.afterData).toMatchObject({
      code: 'auditor_lead',
      name: 'Senior Auditor Lead',
      dataScope: DATA_SCOPE.SUBORDINATES,
    });

    // 3b. Lọc theo module = 'users' và action = 'user.lock' để kiểm tra lý do thay đổi (reason) và before/after status (Mục 4.4.4 & 4.4.5)
    const lockLogs = await h.rolesService.listAuditLogs({
      module: 'users',
      action: 'user.lock',
      actorUserId: 1,
      correlationId: 'corr-audit-44-001',
      page: 1,
      limit: 20,
    });
    expect(lockLogs.data).toHaveLength(1);
    expect(lockLogs.data[0]!.reason).toBe('Phát hiện đăng nhập bất thường từ IP lạ');
    expect(lockLogs.data[0]!.beforeData).toEqual({ status: USER_STATUS.ACTIVE });
    expect(lockLogs.data[0]!.afterData).toMatchObject({
      status: USER_STATUS.LOCKED,
      lockReason: 'Phát hiện đăng nhập bất thường từ IP lạ',
    });

    // 3c. Lọc theo actorType = SERVICE_ACCOUNT (2) và actorServiceAccountId (Mục 4.4.1 & 4.4.7)
    const saLogs = await h.rolesService.listAuditLogs({
      actorType: AUDIT_ACTOR_TYPE.SERVICE_ACCOUNT,
      actorServiceAccountId: sa.id,
      page: 1,
      limit: 20,
    });
    expect(saLogs.data).toHaveLength(1);
    expect(saLogs.data[0]!.actorTypeName).toBe('SERVICE_ACCOUNT');
    expect(saLogs.data[0]!.actorServiceAccountId).toBe(sa.id);
    expect(saLogs.data[0]!.actorApiClientId).toBe(apiClient.id);
    expect(saLogs.data[0]!.actorIdentifier).toBe(`SA_AUDIT_SYNC:${apiClient.clientId}`);
    expect(saLogs.data[0]!.ipAddress).toBe('172.16.99.10');
    expect(saLogs.data[0]!.requestId).toBe('req-sa-44-002');
    expect(saLogs.data[0]!.correlationId).toBe('corr-sa-44-002');

    // 3d. Xem chi tiết 1 bản ghi Audit Log theo ID
    const detail = await h.rolesService.getAuditLogById(roleLog.id);
    expect(detail.id).toBe(roleLog.id);
    expect(detail.action).toBe('ROLE_UPDATED');

    // 4. Kiểm chứng tính bất biến (Immutability — Mục 4.4.8): Không cho phép sửa hoặc xóa Audit Log bằng API thường (403 Forbidden)
    await expect(h.rolesService.updateAuditLog(roleLog.id)).rejects.toThrow(
      'security.auditLogImmutable',
    );
    await expect(h.rolesService.deleteAuditLog(roleLog.id)).rejects.toThrow(
      'security.auditLogImmutable',
    );
    await expect(h.auditLogService.update(roleLog.id, { reason: 'tamper' })).rejects.toThrow(
      'security.auditLogImmutable',
    );
    await expect(h.auditLogService.remove(roleLog.id)).rejects.toThrow(
      'security.auditLogImmutable',
    );

    // 5. Kiểm tra đa ngôn ngữ (vi/en) cho thông báo lỗi bất biến Audit Log
    const i18n = new CoreI18nService();
    i18n.registerNamespace('roles', { vi: rolesVi, en: rolesEn });
    expect(i18n.t('security.auditLogImmutable', undefined, 'vi')).toContain(
      'Nhật ký thao tác (Audit Log)',
    );
    expect(i18n.t('security.auditLogImmutable', undefined, 'en')).toContain(
      'Audit Logs are immutable',
    );
    expect(i18n.t('roles.auditLogNotFound', undefined, 'vi')).toContain(
      'Không tìm thấy bản ghi Nhật ký thao tác',
    );
    expect(i18n.t('roles.auditLogNotFound', undefined, 'en')).toContain(
      'Requested Audit Log record not found',
    );
  });

  it('supports Section 4.5 Platform Security & Login/Logout Audit (4.5.1 -> 4.5.8): Security Headers, CORS Allowlist, 3D Rate Limiting (IP/User/API), Input Sanitization, Sensitive Redaction, Login/Logout Audit (auth_login_history + audit_logs), Security Events (failed login, permission change, MFA disable, large export), and SIEM Anomaly Alerts', async () => {
    const h = createIamInMemoryHarness();

    // 1. Security Headers (4.5.1): HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
    const secHeaders = h.platformSecurityService.getSecurityHeaders();
    expect(secHeaders['strict-transport-security']).toContain('max-age=31536000');
    expect(secHeaders['x-frame-options']).toBe('DENY');
    expect(secHeaders['x-content-type-options']).toBe('nosniff');
    expect(secHeaders['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(secHeaders['permissions-policy']).toContain('camera=()');

    // 2. CORS Allowlist (4.5.2): Allow whitelisted origins, reject unknown domains and never allow wildcard
    h.platformSecurityService.setAllowedOrigins([
      'https://admin.enterprise.vn',
      '*.trusted.enterprise.vn',
    ]);
    expect(h.platformSecurityService.evaluateCorsOrigin('https://admin.enterprise.vn')).toEqual({
      allowed: true,
      allowedOrigin: 'https://admin.enterprise.vn',
    });
    expect(
      h.platformSecurityService.evaluateCorsOrigin('https://portal.trusted.enterprise.vn'),
    ).toEqual({
      allowed: true,
      allowedOrigin: 'https://portal.trusted.enterprise.vn',
    });
    expect(h.platformSecurityService.evaluateCorsOrigin('https://evil-attacker.com')).toEqual({
      allowed: false,
      allowedOrigin: null,
    });

    // 3. Rate Limit 3 chiều: IP, User và API Route (4.5.3)
    h.platformSecurityService.setRateLimitRule('POST /api/v1/auth/login', {
      ipLimit: 3,
      userLimit: 5,
      apiLimit: 10,
      windowSeconds: 60,
    });
    const rl1 = h.platformSecurityService.consumeRateLimit({
      ip: '203.0.113.55',
      userId: null,
      routeKey: 'POST /api/v1/auth/login',
    });
    expect(rl1.allowed).toBe(true);
    expect(rl1.remaining).toBe(2);
    h.platformSecurityService.consumeRateLimit({
      ip: '203.0.113.55',
      userId: null,
      routeKey: 'POST /api/v1/auth/login',
    });
    h.platformSecurityService.consumeRateLimit({
      ip: '203.0.113.55',
      userId: null,
      routeKey: 'POST /api/v1/auth/login',
    });
    const rlBlocked = h.platformSecurityService.consumeRateLimit({
      ip: '203.0.113.55',
      userId: null,
      routeKey: 'POST /api/v1/auth/login',
    });
    expect(rlBlocked.allowed).toBe(false);
    expect(rlBlocked.exceededDimension).toBe('IP');
    expect(rlBlocked.retryAfterSeconds).toBeGreaterThan(0);

    // 4. Input Sanitization & Response Sensitive Redaction (4.5.4 & 4.5.6)
    const dirtyPayload = {
      fullName: 'Nguyễn <script>alert("xss")</script>Văn A\0',
      bio: ' normal <a href="javascript:evil()" onclick="steal()">link</a> ',
      password: 'Raw<script>Password!123',
    };
    const cleaned = sanitizeInputPayload(dirtyPayload);
    expect(cleaned.fullName).toBe('Nguyễn Văn A');
    expect(cleaned.bio).not.toContain('javascript:');
    expect(cleaned.bio).not.toContain('onclick=');
    // Password field preserves characters except null-byte
    expect(cleaned.password).toBe('Raw<script>Password!123');

    const redactedResponse = redactSensitiveResponseData({
      id: 1,
      username: 'alice',
      passwordHash: 'scrypt$secret',
      totpSecret: 'BASE32SECRET',
      nested: {
        refreshTokenHash: 'sha256$hash',
        safeField: 'visible',
      },
    });
    expect(redactedResponse.passwordHash).toBe('[REDACTED]');
    expect(redactedResponse.totpSecret).toBe('[REDACTED]');
    expect(redactedResponse.nested.refreshTokenHash).toBe('[REDACTED]');
    expect(redactedResponse.nested.safeField).toBe('visible');

    // 5. Đăng ký SIEM Alert Sink để kiểm tra cảnh báo thao tác bất thường (4.5.8)
    const dispatchedAlerts: Array<{ anomalyType: string; severity: string; title: string }> = [];
    h.platformSecurityService.registerSiemAlertSink({
      name: 'TestMemorySiemSink',
      sendAlert: (alert) => {
        dispatchedAlerts.push({
          anomalyType: alert.anomalyType,
          severity: alert.severity,
          title: alert.title,
        });
      },
    });

    // 6. Kiểm tra Audit Login / Logout / Failed Login / MFA Disable / Permission Change / Large Export (4.5.7 & 4.5.8)
    const role = await h.rolesService.create({
      code: 'sec45_member',
      name: 'Security 4.5 Member',
      permissions: ['users.read', 'users.export'],
    });

    const user = await h.usersService.create(
      {
        email: 'sec45.user@gmail.com',
        username: 'sec45_user',
        firstName: 'Bảo',
        lastName: 'Trần',
        password: 'Valid#Password123',
        status: USER_STATUS.ACTIVE,
        roleIds: [role.id],
        organizationUnits: [],
      },
      1,
    );

    // 6a. Login sai 3 lần liên tiếp -> ghi vào cả auth_login_history, audit_logs và phát cảnh báo SIEM BRUTE_FORCE_LOGIN
    for (let i = 0; i < 3; i++) {
      await expect(
        h.authService.login(
          { identifier: 'sec45.user@gmail.com', password: 'WrongPassword!' },
          { ipAddress: '198.51.100.88', userAgent: 'AttackerBot/1.0' },
        ),
      ).rejects.toThrow();
    }

    expect(dispatchedAlerts.some((a) => a.anomalyType === 'BRUTE_FORCE_LOGIN')).toBe(true);

    // 6b. Login thành công -> ghi LOGIN_SUCCESS vào cả auth_login_history và audit_logs
    const loginRes = await h.authService.login(
      {
        identifier: 'sec45.user@gmail.com',
        password: 'Valid#Password123',
        deviceName: 'MacBook Pro Sec45',
      },
      { ipAddress: '10.10.20.30', userAgent: 'Mozilla/5.0 Macintosh' },
    );
    expect(loginRes.mfaRequired).toBe(false);
    expect(loginRes.sessionId).toBeDefined();

    // 6c. Bật rồi tắt MFA -> ghi sự kiện MFA_DISABLED vào auth_login_history, audit_logs và phát cảnh báo SIEM MFA_PROTECTION_DISABLED
    await h.mfaService.enableEmailOtp(user.id, { enabled: true });
    await h.authService.disableMfa(user.id, {
      method: 'EMAIL_OTP',
      currentPassword: 'Valid#Password123',
    });
    expect(dispatchedAlerts.some((a) => a.anomalyType === 'MFA_PROTECTION_DISABLED')).toBe(true);

    // 6d. Đổi quyền của vai trò -> ghi sự kiện PERMISSION_CHANGED và phát cảnh báo SIEM PRIVILEGE_ESCALATION_OR_CHANGE
    await h.rolesService.setPermissions(role.id, {
      permissions: ['users.read', 'users.export', 'roles.read'],
    });
    expect(dispatchedAlerts.some((a) => a.anomalyType === 'PRIVILEGE_ESCALATION_OR_CHANGE')).toBe(
      true,
    );

    // 6e. Export dữ liệu vượt ngưỡng cảnh báo -> ghi sự kiện DATA_EXPORT và phát cảnh báo SIEM LARGE_DATA_EXPORT
    h.platformSecurityService.setLargeExportThreshold(1);
    const exported = await h.exportService.exportUsersCsv(
      { page: 1, limit: 100, sortBy: 'id', sortOrder: 'ASC', format: 'csv' },
      {
        id: user.id,
        email: user.email,
        username: user.username,
        roles: ['sec45_member'],
        permissions: ['users.read', 'users.export'],
        organizationUnitIds: [],
      },
    );
    expect(exported.totalExported).toBeGreaterThanOrEqual(1);
    expect(dispatchedAlerts.some((a) => a.anomalyType === 'LARGE_DATA_EXPORT')).toBe(true);

    // 6f. Logout -> ghi sự kiện LOGOUT vào cả auth_login_history và audit_logs
    await h.authService.logout(
      {
        userId: user.id,
        sessionId: loginRes.sessionId,
        ipAddress: '10.10.20.30',
        userAgent: 'Mozilla/5.0 Macintosh',
      },
      { ipAddress: '10.10.20.30', userAgent: 'Mozilla/5.0 Macintosh' },
    );

    // Kiểm tra bảng auth_login_history của user có đầy đủ: LOGIN_FAILED, LOGIN_SUCCESS, MFA_DISABLED, LOGOUT
    const userHistory = await h.sessionService.listUserLoginHistory(user.id, 50);
    const historyEventNames = userHistory.map((item) => item.eventTypeName);
    expect(historyEventNames).toEqual(
      expect.arrayContaining(['LOGIN_FAILED', 'LOGIN_SUCCESS', 'MFA_DISABLED', 'LOGOUT']),
    );

    // Kiểm tra bảng audit_logs (module = 'auth') cũng có đầy đủ LOGIN_FAILED, LOGIN_SUCCESS, MFA_DISABLED, LOGOUT
    const authAuditLogs = await h.rolesService.listAuditLogs({
      module: 'auth',
      page: 1,
      limit: 50,
    });
    const authAuditActions = authAuditLogs.data.map((item) => item.action);
    expect(authAuditActions).toEqual(
      expect.arrayContaining(['LOGIN_FAILED', 'LOGIN_SUCCESS', 'MFA_DISABLED', 'LOGOUT']),
    );

    // Kiểm tra danh sách Security Events và Security Alerts qua RolesService
    const secEvents = h.rolesService.listSecurityEvents({ limit: 50 });
    expect(secEvents.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['LOGIN_FAILED', 'MFA_DISABLED', 'PERMISSION_CHANGED', 'DATA_EXPORT']),
    );

    const secAlerts = h.rolesService.listSecurityAlerts({ limit: 50 });
    expect(secAlerts.map((a) => a.anomalyType)).toEqual(
      expect.arrayContaining([
        'BRUTE_FORCE_LOGIN',
        'MFA_PROTECTION_DISABLED',
        'PRIVILEGE_ESCALATION_OR_CHANGE',
        'LARGE_DATA_EXPORT',
      ]),
    );
  });

  it('supports Dynamic Lookup Table & Hybrid Code System (code_types, code_values, 2-tier i18n, dynamic unit types, hybrid behaviorCode, and MasterPermissionSeeder)', async () => {
    const h = createIamInMemoryHarness();
    let typeSeq = 0;
    let valSeq = 0;
    const typeStore = new Map<string, CodeTypeEntity>();
    const valStore = new Map<number, CodeValueEntity>();

    const codeTypeRepo = {
      findByCode: async (code: string) => typeStore.get(code.trim().toLowerCase()) ?? null,
      findFiltered: async (params?: { module?: string; search?: string }) => {
        let list = [...typeStore.values()];
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
        const existing = typeStore.get(norm);
        const entity: CodeTypeEntity = {
          id: existing?.id ?? ++typeSeq,
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
        typeStore.set(norm, entity);
        return entity;
      },
    } as unknown as CodeTypeRepository;

    const codeValueRepo = {
      findByTypeCode: async (typeCode: string, includeInactive = false) => {
        const norm = typeCode.trim().toLowerCase();
        return [...valStore.values()]
          .filter(
            (v) =>
              v.typeCode === norm &&
              !v.deletedAt &&
              (includeInactive || v.status === CODE_ITEM_STATUS.ACTIVE),
          )
          .sort((a, b) => a.sortOrder - b.sortOrder || a.numericCode - b.numericCode);
      },
      findAllOrdered: async (includeInactive = true) =>
        [...valStore.values()].filter(
          (v) => !v.deletedAt && (includeInactive || v.status === CODE_ITEM_STATUS.ACTIVE),
        ),
      findByTypeAndNumericCode: async (typeCode: string, numericCode: number) => {
        const norm = typeCode.trim().toLowerCase();
        return (
          [...valStore.values()].find(
            (v) =>
              v.typeCode === norm && Number(v.numericCode) === Number(numericCode) && !v.deletedAt,
          ) ?? null
        );
      },
      saveEntity: async (partial: Partial<CodeValueEntity>) => {
        const now = new Date();
        const existing = partial.id ? valStore.get(Number(partial.id)) : undefined;
        const entity: CodeValueEntity = {
          id: existing?.id ?? ++valSeq,
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
        valStore.set(entity.id, entity);
        return entity;
      },
      repository: {
        softDelete: async (id: number) => {
          valStore.delete(Number(id));
        },
      },
    } as unknown as CodeValueRepository;

    const i18n = new CoreI18nService();
    const codesService = new CodesService(
      codeTypeRepo,
      codeValueRepo,
      defaultCodeRegistry,
      i18n,
      h.auditLogService,
    );

    // 1. Sync manifests into code_types & code_values
    const syncRes = await codesService.syncManifests();
    expect(syncRes.totalCodeTypes).toBeGreaterThanOrEqual(8);
    expect(syncRes.createdTypesCount).toBeGreaterThanOrEqual(8);
    expect(syncRes.syncedModules).toEqual(
      expect.arrayContaining(['organizations', 'users', 'roles', 'auth']),
    );

    // 2. Verify Bootstrap dictionary & 2-tier i18n (vi + en)
    const bootstrapEn = await codesService.getBootstrapDictionary({ locale: 'en' });
    expect(bootstrapEn.locale).toBe('en');
    expect(bootstrapEn.dictionary['organizations.unit_type']).toBeDefined();
    const hqEn = bootstrapEn.dictionary['organizations.unit_type']!.find(
      (v) => v.numericCode === 1,
    );
    expect(hqEn?.displayLabel).toBe('Headquarters');

    // 3. Add dynamic unit type 5 = CAMPUS to organizations.unit_type and create an Organization Unit with type = 'CAMPUS'
    const campusVal = await codesService.createCodeValue('organizations.unit_type', {
      numericCode: 5,
      code: 'CAMPUS',
      behaviorCode: 'BRANCH',
      name: 'Cơ sở đào tạo',
      labels: { vi: 'Cơ sở đào tạo', en: 'Training Campus' },
      aliases: ['CO SO', 'CƠ SỞ'],
      color: 'cyan',
      status: CODE_ITEM_STATUS.ACTIVE,
    });
    expect(campusVal.numericCode).toBe(5);
    expect(campusVal.code).toBe('CAMPUS');
    expect(campusVal.isSystem).toBe(false);

    const campusOrg = await h.organizationsService.create({
      code: 'CAMPUS_THUDUC',
      name: 'Cơ sở Đào tạo TP. Thủ Đức',
      type: 5,
    });
    expect(campusOrg.type).toBe(5);
    expect(campusOrg.typeName).toBe('CAMPUS');

    // 4. Hybrid User Status: Add custom status 5 = PROBATION_SUSPENDED with behaviorCode = 'LOCKED'
    const customStatusVal = await codesService.createCodeValue('users.status', {
      numericCode: 5,
      code: 'PROBATION_SUSPENDED',
      behaviorCode: 'LOCKED',
      name: 'Tạm đình chỉ thử việc',
      labels: { vi: 'Tạm đình chỉ thử việc', en: 'Probation Suspended' },
      aliases: ['ĐÌNH CHỈ THỬ VIỆC'],
      status: CODE_ITEM_STATUS.ACTIVE,
    });
    expect(customStatusVal.behaviorCode).toBe('LOCKED');
    expect(defaultCodeRegistry.resolveBehaviorCode('users.status', 5)).toBe('LOCKED');

    // 5. Block deleting system anchor code value (isSystem = true)
    await expect(codesService.removeCodeValue('organizations.unit_type', 1)).rejects.toThrow();

    // 6. Block adding custom values to locked code_type (allowCustomValues = false, e.g. roles.data_scope)
    await expect(
      codesService.createCodeValue('roles.data_scope', {
        code: 'CUSTOM_REGION',
        name: 'Vùng tùy chỉnh',
        status: CODE_ITEM_STATUS.ACTIVE,
      }),
    ).rejects.toThrow();

    // 7. Delete custom code value (5 = CAMPUS) and clean up
    const delCampus = await codesService.removeCodeValue('organizations.unit_type', 5);
    expect(delCampus.deleted).toBe(true);
    await codesService.removeCodeValue('users.status', 5);

    // 8. Verify MasterPermissionSeeder executes SQL for code_types & code_values
    const executedQueries: string[] = [];
    const seeder = new MasterPermissionSeeder([
      { code: 'codes.read', module: 'codes', description: 'Read codes' },
    ]);
    const seederRes = await seeder.run({
      driver: 'postgres',
      environment: 'test',
      manager: {
        query: async (sql: string) => {
          executedQueries.push(sql);
          return [];
        },
      } as never,
    });
    expect(seederRes.affected).toBeGreaterThan(20);
    expect(executedQueries.some((q) => q.includes('INSERT INTO code_types'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('INSERT INTO code_values'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('INSERT INTO setting_groups'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('INSERT INTO system_settings'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('INSERT INTO system_setting_scopes'))).toBe(true);
  });

  it('5.1.1 -> 5.1.8: Cấu hình hệ thống động (Nhóm cấu hình, Namespace theo module, Kiểu TEXT/NUMBER/BOOLEAN/JSON, Môi trường, Đơn vị, Mã hóa & Che giấu Secret, Lịch sử thay đổi, Cache & Cầu nối Chính sách mật khẩu)', async () => {
    const settingRegistry = new SettingRegistryService();
    const fieldEncryption = new FieldEncryptionService(new CoreConfigService());
    const auditLogService = new AuditLogService();
    const settingsService = new SettingsService(
      null,
      null,
      null,
      null,
      settingRegistry,
      fieldEncryption,
      auditLogService,
      null,
    );

    const adminActor = {
      id: 1,
      email: 'superadmin@gmail.com',
      roles: ['super_admin'],
      permissions: ['settings.read', 'settings.manage'],
    };

    // Liên kết cầu nối hai chiều với SecuritySettingsService của h
    const securityServiceWithBridge = new SecuritySettingsService(
      (h.securitySettingsService as unknown as { settingRepo: AuthSecuritySettingRepository })
        .settingRepo,
      undefined,
      undefined,
      settingRegistry,
    );

    // 1. Đồng bộ Manifest (5.1.1 & 5.1.2): Nhóm cấu hình hệ thống (email, file, security, ui, system) & Namespace theo module
    const syncRes = await settingsService.syncManifests();
    expect(syncRes.totalGroups).toBeGreaterThanOrEqual(5);
    expect(syncRes.totalSettings).toBeGreaterThanOrEqual(14);

    const groups = await settingsService.listGroups();
    const groupCodes = groups.map((g) => g.code);
    expect(groupCodes).toEqual(
      expect.arrayContaining(['email', 'file', 'security', 'ui', 'system']),
    );

    // Tạo thêm nhóm cấu hình tùy chỉnh (5.1.1)
    const customGroup = await settingsService.createGroup(
      {
        code: 'integrations',
        module: 'settings',
        name: 'Cấu hình tích hợp bên thứ ba',
      },
      adminActor,
    );
    expect(customGroup.code).toBe('integrations');
    expect(customGroup.isSystem).toBe(false);

    // Lọc danh sách cấu hình theo module / namespace (5.1.2)
    const authPasswordSettings = await settingsService.listSettings({
      module: 'auth',
      namespace: 'auth.password',
    });
    expect(authPasswordSettings.length).toBeGreaterThanOrEqual(4);
    expect(authPasswordSettings.some((s) => s.key === 'security.password.min_length')).toBe(true);

    // 2. Validate kiểu dữ liệu TEXT, NUMBER, BOOLEAN, JSON trước khi lưu (5.1.3)
    // - NUMBER: kiểm tra min/max/integerOnly (security.password.min_length có min=6, max=64, integerOnly=true)
    await expect(
      settingsService.updateSettingValue(
        'security.password.min_length',
        { value: 3 }, // < min (6)
        adminActor,
      ),
    ).rejects.toThrow();

    await expect(
      settingsService.updateSettingValue(
        'security.password.min_length',
        { value: 'not-a-number' },
        adminActor,
      ),
    ).rejects.toThrow();

    // - BOOLEAN: kiểm tra kiểu boolean chuẩn
    await expect(
      settingsService.updateSettingValue(
        'security.password.require_uppercase',
        { value: 'yes-invalid-boolean' },
        adminActor,
      ),
    ).rejects.toThrow();

    // - JSON: kiểm tra mảng/object hợp lệ
    const updatedAllowedExts = await settingsService.updateSettingValue(
      'file.upload.allowed_extensions',
      {
        value: ['jpg', 'png', 'pdf', 'docx'],
        reason: 'Cập nhật định dạng tệp cho phép',
      },
      adminActor,
    );
    expect(updatedAllowedExts.valueTypeName).toBe('JSON');
    expect(updatedAllowedExts.value).toEqual(['jpg', 'png', 'pdf', 'docx']);

    // - TEXT: kiểm tra enumOptions (ui.theme.default_mode chỉ nhận light | dark | system)
    await expect(
      settingsService.updateSettingValue(
        'ui.theme.default_mode',
        { value: 'neon-invalid' },
        adminActor,
      ),
    ).rejects.toThrow();

    const updatedTheme = await settingsService.updateSettingValue(
      'ui.theme.default_mode',
      { value: 'dark' },
      adminActor,
    );
    expect(updatedTheme.value).toBe('dark');

    // 3. Hỗ trợ cấu hình theo môi trường (5.1.4) & theo đơn vị (5.1.5) với thứ tự ưu tiên:
    //    UNIT_ENV -> UNIT_ALL -> GLOBAL_ENV -> GLOBAL -> DEFAULT
    await settingsService.updateSettingValue(
      'email.smtp.host',
      { value: 'smtp.global.internal', environment: 'ALL' },
      adminActor,
    );
    await settingsService.updateSettingValue(
      'email.smtp.host',
      { value: 'smtp.prod.amazonaws.com', environment: 'production' },
      adminActor,
    );
    await settingsService.updateSettingValue(
      'email.smtp.host',
      { value: 'smtp.unit10.local', environment: 'ALL', organizationUnitId: 10 },
      adminActor,
    );
    await settingsService.updateSettingValue(
      'email.smtp.host',
      { value: 'smtp.unit10.prod.local', environment: 'production', organizationUnitId: 10 },
      adminActor,
    );

    const resolvedGlobalStaging = await settingsService.resolve<string>('email.smtp.host', {
      environment: 'staging',
    });
    expect(resolvedGlobalStaging.value).toBe('smtp.global.internal');
    expect(resolvedGlobalStaging.resolvedSource).toBe('GLOBAL');

    const resolvedGlobalProd = await settingsService.resolve<string>('email.smtp.host', {
      environment: 'production',
    });
    expect(resolvedGlobalProd.value).toBe('smtp.prod.amazonaws.com');
    expect(resolvedGlobalProd.resolvedSource).toBe('GLOBAL_ENV');

    const resolvedUnitAll = await settingsService.resolve<string>('email.smtp.host', {
      environment: 'staging',
      organizationUnitId: 10,
    });
    expect(resolvedUnitAll.value).toBe('smtp.unit10.local');
    expect(resolvedUnitAll.resolvedSource).toBe('UNIT_ALL');

    const resolvedUnitEnv = await settingsService.resolve<string>('email.smtp.host', {
      environment: 'production',
      organizationUnitId: 10,
    });
    expect(resolvedUnitEnv.value).toBe('smtp.unit10.prod.local');
    expect(resolvedUnitEnv.resolvedSource).toBe('UNIT_ENV');

    // Chặn ghi đè theo đơn vị khi allowUnitOverride = false (ví dụ system.maintenance.enabled)
    await expect(
      settingsService.updateSettingValue(
        'system.maintenance.enabled',
        { value: true, organizationUnitId: 10 },
        adminActor,
      ),
    ).rejects.toThrow();

    // 4. Ẩn hoặc mã hóa cấu hình nhạy cảm (5.1.6): Không hiển thị secret thô qua API/log, giải mã nội bộ
    const updatedSecret = await settingsService.updateSettingValue(
      'email.smtp.password',
      {
        value: 'SuperSecretSmtpKey#2026!',
        reason: 'Cập nhật mật khẩu SMTP',
      },
      adminActor,
    );
    expect(updatedSecret.isSensitive).toBe(true);
    expect(updatedSecret.isEncrypted).toBe(true);
    expect(updatedSecret.value).toBe('••••••••');

    const resolvedSecretPublic = await settingsService.resolve('email.smtp.password');
    expect(resolvedSecretPublic.value).toBe('••••••••');

    // Dịch vụ nội bộ gọi getDecryptedValue sẽ nhận lại đúng chuỗi gốc đã giải mã AES-256-GCM
    const decryptedSecret = await settingsService.getDecryptedValue<string>('email.smtp.password');
    expect(decryptedSecret).toBe('SuperSecretSmtpKey#2026!');

    // 5. Cache cấu hình & tự động xóa cache khi thay đổi (5.1.8) + Cầu nối sang SecuritySettingsService
    const firstResolveMinLen = await settingsService.resolve<number>(
      'security.password.min_length',
    );
    expect(firstResolveMinLen.value).toBe(8);
    expect(firstResolveMinLen.fromCache).toBe(false);

    const cachedResolveMinLen = await settingsService.resolve<number>(
      'security.password.min_length',
    );
    expect(cachedResolveMinLen.value).toBe(8);
    expect(cachedResolveMinLen.fromCache).toBe(true);

    // Khi cập nhật security.password.min_length = 12 -> Cache bị invalidate ngay lập tức và SecuritySettingsService tự đồng bộ
    await settingsService.updateSettingValue(
      'security.password.min_length',
      {
        value: 12,
        reason: 'Tăng độ dài mật khẩu tối thiểu lên 12 ký tự theo tiêu chuẩn an ninh mới',
      },
      adminActor,
    );

    const afterUpdateResolve = await settingsService.resolve<number>(
      'security.password.min_length',
    );
    expect(afterUpdateResolve.value).toBe(12);
    expect(afterUpdateResolve.fromCache).toBe(false);

    // Kiểm tra SecuritySettingsService đã nhận giá trị 12 ký tự và chặn mật khẩu 9 ký tự
    const secView = await securityServiceWithBridge.getSettings();
    expect(secView.passwordMinLength).toBe(12);
    await expect(
      securityServiceWithBridge.validatePasswordPolicy('Abcd@1234', {
        email: 'user@example.com',
      }),
    ).rejects.toThrow();

    // 6. Ghi lịch sử thay đổi cấu hình (5.1.7): Biết ai đã thay đổi, thời gian, giá trị cũ/mới (đã che secret nếu nhạy cảm)
    const minLenHistory = await settingsService.listHistory({
      settingKey: 'security.password.min_length',
    });
    expect(minLenHistory.length).toBeGreaterThanOrEqual(1);
    expect(typeof minLenHistory[0]?.settingId).toBe('number');
    expect(minLenHistory[0]?.environmentCode).toBe(1);
    expect(minLenHistory[0]?.actorUserId).toBe(1);
    expect(minLenHistory[0]?.actorIdentifier).toBe('superadmin@gmail.com');
    expect(minLenHistory[0]?.oldValue).toBe(8);
    expect(minLenHistory[0]?.newValue).toBe(12);

    const secretHistory = await settingsService.listHistory({
      settingKey: 'email.smtp.password',
    });
    expect(secretHistory.length).toBeGreaterThanOrEqual(1);
    expect(secretHistory[0]?.newValue).toBe('••••••••');

    // 7. Kiểm tra thay đổi ngược từ API / SecuritySettingsService -> SettingsService tự động cập nhật & xóa cache
    await securityServiceWithBridge.updateSettings({
      passwordMinLength: 10,
    });
    const resolvedAfterAuthUpdate = await settingsService.resolve<number>(
      'security.password.min_length',
    );
    expect(resolvedAfterAuthUpdate.value).toBe(10);
    expect(resolvedAfterAuthUpdate.fromCache).toBe(false);

    // 8. Kiểm tra khi thay đổi trực tiếp dữ liệu trong Database (system_settings) -> hydrateRegistryFromDbSafe tự động phát hiện, xóa cache và đồng bộ sang SecuritySettingsService
    let dbGlobalMinLen = '14';
    const mockDbSettingRepo = {
      findFiltered: async () => [
        {
          id: 1,
          settingKey: 'security.password.min_length',
          groupId: 3,
          module: 'auth',
          namespace: 'auth.password',
          name: 'Độ dài mật khẩu tối thiểu',
          description: 'Số ký tự tối thiểu khi tạo hoặc đổi mật khẩu',
          valueType: SETTING_VALUE_TYPE.NUMBER,
          defaultValue: '8',
          globalValue: dbGlobalMinLen,
          validationRulesJson: JSON.stringify({ min: 6, max: 64, integerOnly: true }),
          isSensitive: false,
          isEncrypted: false,
          allowUnitOverride: true,
          isSystem: true,
          sortOrder: 1,
          status: 1,
          updatedBy: 1,
        },
      ],
    };
    const dbBackedSettingsService = new SettingsService(
      null,
      mockDbSettingRepo as never,
      null,
      null,
      settingRegistry,
      fieldEncryption,
      auditLogService,
      null,
    );

    const resolvedFromDirectDb1 = await dbBackedSettingsService.resolve<number>(
      'security.password.min_length',
    );
    expect(resolvedFromDirectDb1.value).toBe(14);
    expect((await securityServiceWithBridge.getSettings()).passwordMinLength).toBe(14);

    // Lần đọc thứ 2 trúng cache (fromCache = true)
    const cachedFromDirectDb = await dbBackedSettingsService.resolve<number>(
      'security.password.min_length',
    );
    expect(cachedFromDirectDb.value).toBe(14);
    expect(cachedFromDirectDb.fromCache).toBe(true);

    // Giả lập DBA sửa trực tiếp cột global_value trong bảng system_settings từ '14' -> '16'
    dbGlobalMinLen = '16';
    const resolvedAfterDirectSqlEdit = await dbBackedSettingsService.resolve<number>(
      'security.password.min_length',
    );
    expect(resolvedAfterDirectSqlEdit.value).toBe(16);
    expect(resolvedAfterDirectSqlEdit.fromCache).toBe(false);
    expect((await securityServiceWithBridge.getSettings()).passwordMinLength).toBe(16);
  });

  it('5.2.1 -> 5.2.8: Bật tắt tính năng (Feature Flags) — tạo flag rõ key/mô tả, kiểm tra module đã cài, bật theo user/role/đơn vị/tỷ lệ rollout, tự động đóng khi hết hạn và ghi lịch sử', async () => {
    applyTestEnv();
    const auditLogService = new AuditLogService();
    const flagRegistry = new FeatureFlagRegistryService();
    const featureFlagsService = new FeatureFlagsService(
      null,
      null,
      flagRegistry,
      auditLogService,
      null,
    );

    const adminActor = {
      id: 1,
      email: 'superadmin@gmail.com',
      roles: ['SUPER_ADMIN'],
      permissions: ['settings.read', 'settings.manage'],
    };

    // Đồng bộ Feature Flags mặc định từ module.manifest.json
    const syncRes = await featureFlagsService.syncManifests();
    expect(syncRes.totalFlags).toBeGreaterThanOrEqual(3);

    // 5.2.1: Tạo mới Feature Flag (Đặt key và mô tả rõ ràng)
    const createdFlag = await featureFlagsService.createFeatureFlag(
      {
        key: 'users.smart_onboarding',
        module: 'users',
        name: 'Luồng hội nhập nhân sự thông minh',
        description:
          'Cho phép tự động gợi ý phòng ban và vai trò khi tạo mới nhân sự theo chi nhánh',
        isEnabled: true,
        rolloutPercentage: 100,
        reason: 'Khởi tạo tính năng thử nghiệm hội nhập nhân sự Q4',
      },
      adminActor,
    );
    expect(createdFlag.key).toBe('users.smart_onboarding');
    expect(createdFlag.module).toBe('users');
    expect(createdFlag.isModuleInstalled).toBe(true);
    expect(createdFlag.isEnabled).toBe(true);
    expect(createdFlag.description).toContain('tự động gợi ý phòng ban');

    // Chặn tạo trùng key hoặc thiếu mô tả rõ ràng
    await expect(
      featureFlagsService.createFeatureFlag(
        {
          key: 'users.smart_onboarding',
          name: 'Trùng key',
          description: 'Mô tả hợp lệ nhưng trùng key',
        },
        adminActor,
      ),
    ).rejects.toThrow();

    // 5.2.2: Bật hoặc tắt chức năng đã được cài (Không dùng flag thay cho việc cài module)
    // Giả lập hệ thống chỉ cài đặt ['users', 'auth', 'settings', 'roles', 'organizations', 'codes'] (không có module 'billing')
    featureFlagsService.setInstalledModules([
      'users',
      'auth',
      'settings',
      'roles',
      'organizations',
      'codes',
    ]);

    await expect(
      featureFlagsService.createFeatureFlag(
        {
          key: 'billing.auto_invoice',
          module: 'billing',
          name: 'Tự động xuất hóa đơn',
          description:
            'Tính năng thuộc module billing chưa được cài đặt trong project.manifest.json',
          isEnabled: true,
        },
        adminActor,
      ),
    ).rejects.toThrow(/not installed in enabledModules/i);

    // Ngay cả khi một flag đã có trong registry nhưng module bị gỡ khỏi enabledModules -> evaluate trả về MODULE_NOT_INSTALLED (enabled = false)
    featureFlagsService.setInstalledModules(['auth', 'settings']);
    const evalWhenModuleUninstalled = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 10,
    });
    expect(evalWhenModuleUninstalled.enabled).toBe(false);
    expect(evalWhenModuleUninstalled.reason).toBe('MODULE_NOT_INSTALLED');

    // Khôi phục module 'users' vào enabledModules và kiểm tra bật/tắt (toggle)
    featureFlagsService.setInstalledModules(['users', 'auth', 'settings']);
    const evalWhenModuleInstalled = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 10,
    });
    expect(evalWhenModuleInstalled.enabled).toBe(true);
    expect(evalWhenModuleInstalled.fromCache).toBe(false);

    // Đọc lần 2 trúng Cache L1 (fromCache = true)
    const evalCached = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 10,
    });
    expect(evalCached.enabled).toBe(true);
    expect(evalCached.fromCache).toBe(true);

    // Tắt tính năng qua toggleFeatureFlag -> xóa cache và trả về FLAG_DISABLED
    await featureFlagsService.toggleFeatureFlag(
      'users.smart_onboarding',
      {
        isEnabled: false,
        reason: 'Tạm dừng tính năng để cấu hình danh sách thử nghiệm',
      },
      adminActor,
    );
    const evalAfterDisable = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 10,
    });
    expect(evalAfterDisable.enabled).toBe(false);
    expect(evalAfterDisable.reason).toBe('FLAG_DISABLED');

    // 5.2.3, 5.2.4, 5.2.5: Bật theo người dùng (targetUserIds), theo vai trò (targetRoles), theo đơn vị (targetOrganizationUnitIds)
    await featureFlagsService.updateFeatureFlag(
      'users.smart_onboarding',
      {
        isEnabled: true,
        targetUserIds: ['101', '102'],
        targetRoles: ['HR_DIRECTOR', 'PILOT_TESTER'],
        targetOrganizationUnitIds: ['10', '20'],
        rolloutPercentage: 0, // Tắt rollout đại trà để chỉ cho phép các đối tượng được nhắm mục tiêu
        reason:
          'Chỉ bật thử nghiệm cho User 101/102, Role HR_DIRECTOR/PILOT_TESTER và Chi nhánh 10/20',
      },
      adminActor,
    );

    // 5.2.3: Bật theo người dùng (User 101 nằm trong targetUserIds -> TARGET_USER_MATCH)
    const evalByUser = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 101,
      roles: ['STAFF'],
      organizationUnitId: 99,
    });
    expect(evalByUser.enabled).toBe(true);
    expect(evalByUser.reason).toBe('TARGET_USER_MATCH');

    // 5.2.4: Bật theo vai trò (User 205 có role HR_DIRECTOR -> TARGET_ROLE_MATCH)
    const evalByRole = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 205,
      roles: ['STAFF', 'hr_director'],
      organizationUnitId: 99,
    });
    expect(evalByRole.enabled).toBe(true);
    expect(evalByRole.reason).toBe('TARGET_ROLE_MATCH');

    // 5.2.5: Bật theo đơn vị (User 309 thuộc chi nhánh 20 -> TARGET_ORG_UNIT_MATCH)
    const evalByOrgUnit = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 309,
      roles: ['STAFF'],
      organizationUnitIds: [20, 30],
    });
    expect(evalByOrgUnit.enabled).toBe(true);
    expect(evalByOrgUnit.reason).toBe('TARGET_ORG_UNIT_MATCH');

    // Người dùng ngoài danh sách User, Role, Đơn vị -> bị từ chối (TARGET_MISMATCH)
    const evalOutsider = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 999,
      roles: ['GUEST'],
      organizationUnitId: 88,
    });
    expect(evalOutsider.enabled).toBe(false);
    expect(evalOutsider.reason).toBe('TARGET_MISMATCH');

    // 5.2.6: Bật theo tỷ lệ người dùng (rolloutPercentage 0..100% phục vụ rollout dần)
    await featureFlagsService.updateFeatureFlag(
      'users.smart_onboarding',
      {
        targetUserIds: [],
        targetRoles: [],
        targetOrganizationUnitIds: [],
        rolloutPercentage: 30, // Chỉ bật cho 30% người dùng
        reason: 'Rollout dần cho 30% người dùng toàn hệ thống',
      },
      adminActor,
    );

    let matchedRolloutUsers = 0;
    for (let uid = 1; uid <= 100; uid++) {
      const bucket = computeFeatureFlagRolloutBucket('users.smart_onboarding', String(uid));
      const res = await featureFlagsService.evaluate('users.smart_onboarding', {
        userId: uid,
      });
      if (bucket < 30) {
        expect(res.enabled).toBe(true);
        expect(res.reason).toBe('ROLLOUT_MATCH');
        matchedRolloutUsers++;
      } else {
        expect(res.enabled).toBe(false);
        expect(res.reason).toBe('ROLLOUT_EXCLUDED');
      }
      // Đảm bảo tính nhất quán (deterministic): cùng 1 user gọi lại luôn nhận đúng kết quả đó
      const repeatRes = await featureFlagsService.evaluate('users.smart_onboarding', {
        userId: uid,
      });
      expect(repeatRes.enabled).toBe(res.enabled);
    }
    expect(matchedRolloutUsers).toBeGreaterThan(10);
    expect(matchedRolloutUsers).toBeLessThan(60);

    // 5.2.7: Đặt thời gian bắt đầu và kết thúc (Tự động đóng tính năng thử nghiệm khi hết hạn)
    await expect(
      featureFlagsService.updateFeatureFlag(
        'users.smart_onboarding',
        {
          startsAt: '2026-12-10T00:00:00.000Z',
          endsAt: '2026-12-01T00:00:00.000Z', // Lỗi: startsAt > endsAt
        },
        adminActor,
      ),
    ).rejects.toThrow(/startsAt must be earlier than or equal to endsAt/i);

    await featureFlagsService.updateFeatureFlag(
      'users.smart_onboarding',
      {
        rolloutPercentage: 100,
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-11-15T23:59:59.000Z',
        reason: 'Đặt lịch chạy thử nghiệm từ 01/11/2026 đến hết 15/11/2026',
      },
      adminActor,
    );

    // Trước thời gian bắt đầu -> NOT_STARTED (enabled = false)
    const evalBeforeStart = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 101,
      at: '2026-10-25T10:00:00.000Z',
    });
    expect(evalBeforeStart.enabled).toBe(false);
    expect(evalBeforeStart.reason).toBe('NOT_STARTED');

    // Trong khung thời gian thử nghiệm -> ENABLED_ALL (enabled = true)
    const evalDuringWindow = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 101,
      at: '2026-11-10T10:00:00.000Z',
    });
    expect(evalDuringWindow.enabled).toBe(true);
    expect(evalDuringWindow.reason).toBe('ENABLED_ALL');

    // Sau thời điểm kết thúc -> Tự động đóng tính năng thử nghiệm (EXPIRED, enabled = false)
    const evalAfterEnd = await featureFlagsService.evaluate('users.smart_onboarding', {
      userId: 101,
      at: '2026-11-16T00:00:01.000Z',
    });
    expect(evalAfterEnd.enabled).toBe(false);
    expect(evalAfterEnd.reason).toBe('EXPIRED');

    // 5.2.8: Ghi lịch sử thay đổi Feature Flag (Phục vụ kiểm soát: biết ai sửa, hành động gì, trạng thái cũ/mới)
    const histories = await featureFlagsService.listHistory({
      flagKey: 'users.smart_onboarding',
    });
    expect(histories.length).toBeGreaterThanOrEqual(5);

    const actions = histories.map((h) => h.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('TOGGLE');
    expect(actions).toContain('UPDATE');

    const latestHistory = histories[0]!;
    expect(latestHistory.flagKey).toBe('users.smart_onboarding');
    expect(latestHistory.actorUserId).toBe(1);
    expect(latestHistory.actorIdentifier).toBe('superadmin@gmail.com');
    expect(latestHistory.newState).toMatchObject({
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-11-15T23:59:59.000Z',
    });

    const auditEntries = await auditLogService.listPaginated({
      module: 'settings',
      feature: 'feature_flags',
    });
    expect(auditEntries.meta.totalItems).toBeGreaterThanOrEqual(5);
  });
});
