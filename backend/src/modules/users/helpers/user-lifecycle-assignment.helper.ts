import { NotFoundAppException } from '@packages/kernel/index.js';
import type { TransactionManager } from '@packages/database/index.js';
import type {
  AuditLogService,
  PlatformSecurityService,
  UserIdentity,
} from '@packages/security/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import type { IRolesPublicService } from '@modules/roles/contracts/index.js';
import { USERS_AUDIT_META, type UserStatusCode } from '../enum/users.enum.js';
import type { UserStatusTransitionAction } from '../types/users.types.js';
import { parseUserStatus } from './user-normalizer.helper.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import type { UserRoleRepository } from '../repositories/user-role.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type {
  AssignUserOrganizationsRequest,
  AssignUserRolesRequest,
} from '../requests/users.requests.js';
import type { UserResponse } from '../responses/users.response.js';

export async function executeUserStatusTransition(params: {
  id: number;
  toStatus: UserStatusCode;
  action: UserStatusTransitionAction;
  reason: string;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  lockedUntil?: Date | null | undefined;
  lockReason?: string | null | undefined;
  preserveLockReason?: boolean | undefined;
  archiveTimestamp?: Date | null | undefined;
  resetFailedAttempts?: boolean | undefined;
  userRepository: UserRepository;
  ensureAccessUserRecord: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  recordStatusHistory: (
    userId: number,
    fromStatus: UserStatusCode | null,
    toStatus: UserStatusCode,
    reason?: string | null,
    changedBy?: number | null,
  ) => Promise<void>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
  getById: (id: number, includeArchived: boolean) => Promise<UserResponse>;
  auditLogService: AuditLogService | null;
}): Promise<UserResponse> {
  const {
    id,
    toStatus,
    action,
    reason,
    actorId,
    actor,
    lockedUntil,
    lockReason,
    preserveLockReason,
    archiveTimestamp,
    resetFailedAttempts,
    userRepository,
    ensureAccessUserRecord,
    recordStatusHistory,
    invalidateIdentityCache,
    getById,
    auditLogService,
  } = params;

  const user = await userRepository.findByIdWithArchived(id, true);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserRecord(user, actor, 'status');
  }

  const prevStatus = parseUserStatus(user.status);
  const prevLockReason = user.lockReason ?? null;

  user.status = toStatus;
  if (lockedUntil !== undefined) {
    user.lockedUntil = lockedUntil;
  }
  if (!preserveLockReason && lockReason !== undefined) {
    user.lockReason = lockReason;
  }
  if (resetFailedAttempts) {
    user.failedLoginAttempts = 0;
  }
  if (archiveTimestamp !== undefined) {
    user.archivedAt = archiveTimestamp;
    user.deletedAt = archiveTimestamp;
  }

  await userRepository.saveEntity(user);
  await recordStatusHistory(id, prevStatus, toStatus, reason, actorId);
  await invalidateIdentityCache(id);
  const updated = await getById(id, true);

  await auditLogService?.record({
    actorUserId: actorId ?? null,
    module: USERS_AUDIT_META.MODULE,
    feature: USERS_AUDIT_META.FEATURES.STATUS,
    action,
    resourceType: USERS_AUDIT_META.RESOURCE_TYPES.USER,
    resourceId: id,
    beforeData: {
      status: prevStatus,
      ...(action === 'user.unlock' ? { lockReason: prevLockReason } : {}),
    },
    afterData: {
      status: toStatus,
      ...(action === 'user.lock'
        ? {
            lockReason: user.lockReason,
            lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
          }
        : {}),
      ...(action === 'user.unlock' ? { lockReason: null, failedLoginAttempts: 0 } : {}),
      ...(action === 'user.archive' && archiveTimestamp
        ? { archivedAt: archiveTimestamp.toISOString() }
        : {}),
      ...(action === 'user.restore' ? { archivedAt: null } : {}),
    },
    reason,
  });

  return updated;
}

export async function executeAssignUserRolesFlow(params: {
  id: number;
  dto: AssignUserRolesRequest;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  userRepository: UserRepository;
  userRoleRepository: UserRoleRepository;
  rolesPublicService: IRolesPublicService;
  verifySensitiveActionStepUp: (
    actorId?: number,
    stepUpToken?: string,
    requireStepUp?: boolean,
    action?: string,
  ) => Promise<void>;
  ensureAccessUserEntity: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
  getById: (id: number) => Promise<UserResponse>;
  auditLogService: AuditLogService | null;
  platformSecurityService: PlatformSecurityService | null;
}): Promise<UserResponse> {
  const {
    id,
    dto,
    actorId,
    actor,
    userRepository,
    userRoleRepository,
    rolesPublicService,
    verifySensitiveActionStepUp,
    ensureAccessUserEntity,
    invalidateIdentityCache,
    getById,
    auditLogService,
    platformSecurityService,
  } = params;

  await verifySensitiveActionStepUp(
    actorId,
    dto.stepUpToken,
    dto.requireStepUp,
    'users.assignRoles',
  );
  const user = await userRepository.findByIdWithArchived(id, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserEntity(user, actor, 'update');
  }

  const prevLinks = await userRoleRepository.findByUserIds([id]);
  const prevRoleIds = prevLinks.map((l) => Number(l.roleId));
  if (dto.roleIds.length > 0) {
    await rolesPublicService.ensureActiveRolesExist(dto.roleIds);
  }

  await userRoleRepository.replaceUserRoles(id, dto.roleIds, actorId);
  await invalidateIdentityCache(id);
  const updated = await getById(id);

  await auditLogService?.record({
    actorUserId: actorId ?? null,
    module: USERS_AUDIT_META.MODULE,
    feature: USERS_AUDIT_META.FEATURES.ROLES,
    action: 'user.assign_roles',
    resourceType: USERS_AUDIT_META.RESOURCE_TYPES.USER,
    resourceId: id,
    beforeData: { roleIds: prevRoleIds },
    afterData: {
      roleIds: updated.roles.map((r) => r.roleId),
      roleCodes: updated.roles.map((r) => r.code),
    },
    reason: 'Updated user roles assignment',
  });
  await platformSecurityService?.recordSecurityEvent({
    eventType: 'PERMISSION_CHANGED',
    module: USERS_AUDIT_META.MODULE,
    feature: USERS_AUDIT_META.FEATURES.ROLES,
    action: 'user.assign_roles',
    actorId: actorId ?? null,
    targetUserId: id,
    resourceType: USERS_AUDIT_META.RESOURCE_TYPES.USER,
    resourceId: id,
    reason: 'Updated user roles assignment',
    beforeData: { roleIds: prevRoleIds },
    afterData: {
      roleIds: updated.roles.map((r) => r.roleId),
      roleCodes: updated.roles.map((r) => r.code),
    },
    persistToAuditLog: false,
  });
  return updated;
}

export async function executeAssignUserOrganizationsFlow(params: {
  id: number;
  dto: AssignUserOrganizationsRequest;
  actorId?: number | undefined;
  actor?: UserIdentity | undefined;
  userRepository: UserRepository;
  userOrgRepository: UserOrganizationUnitRepository;
  organizationsPublicService: IOrganizationsPublicService | null;
  transactionManager: TransactionManager | null;
  ensureAccessUserEntity: (user: UserEntity, actor: UserIdentity, action: string) => Promise<void>;
  invalidateIdentityCache: (userId: number) => Promise<void>;
  getById: (id: number) => Promise<UserResponse>;
  auditLogService: AuditLogService | null;
}): Promise<UserResponse> {
  const {
    id,
    dto,
    actorId,
    actor,
    userRepository,
    userOrgRepository,
    organizationsPublicService,
    transactionManager,
    ensureAccessUserEntity,
    invalidateIdentityCache,
    getById,
    auditLogService,
  } = params;

  const user = await userRepository.findByIdWithArchived(id, false);
  if (!user) {
    throw new NotFoundAppException('users.notFound', { id });
  }
  if (actor) {
    await ensureAccessUserEntity(user, actor, 'update');
  }

  const prevLinks = await userOrgRepository.findByUserIds([id]);
  const prevOrgUnitIds = prevLinks.map((l) => Number(l.organizationUnitId));
  const unitIds = dto.organizationUnits.map((o) => o.organizationUnitId);
  if (unitIds.length > 0 && organizationsPublicService) {
    await organizationsPublicService.ensureActiveUnitsExist(unitIds);
  }

  const work = async (): Promise<void> => {
    const savedLinks = await userOrgRepository.replaceUserOrganizations(id, dto.organizationUnits);
    const primaryLink = savedLinks.find((l) => l.isPrimary) ?? savedLinks[0];
    user.primaryOrganizationUnitId = primaryLink ? Number(primaryLink.organizationUnitId) : null;
    await userRepository.saveEntity(user);
  };

  if (transactionManager) {
    await transactionManager.runInTransaction(work);
  } else {
    await work();
  }

  await invalidateIdentityCache(id);
  const updated = await getById(id);
  await auditLogService?.record({
    actorUserId: actorId ?? actor?.id ?? null,
    module: USERS_AUDIT_META.MODULE,
    feature: USERS_AUDIT_META.FEATURES.ORGANIZATIONS,
    action: 'user.assign_organizations',
    resourceType: USERS_AUDIT_META.RESOURCE_TYPES.USER,
    resourceId: id,
    beforeData: { organizationUnitIds: prevOrgUnitIds },
    afterData: {
      organizationUnitIds: updated.organizationUnits.map((o) => o.organizationUnitId),
      primaryOrganizationUnitId: updated.primaryOrganizationUnitId,
    },
    reason: 'Updated user organization units assignment',
  });
  return updated;
}
