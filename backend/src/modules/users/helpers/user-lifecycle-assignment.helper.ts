import { BadRequestAppException, NotFoundAppException } from '@packages/kernel/index.js';
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
import type {
  RecordUserOrganizationHistoryInput,
  UserOrganizationHistoryRepository,
} from '../repositories/user-organization-history.repository.js';
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
  userOrgHistoryRepository?: UserOrganizationHistoryRepository | null | undefined;
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
    userOrgHistoryRepository,
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

  for (const item of dto.organizationUnits) {
    if (item.startDate && item.endDate) {
      const startMs = new Date(item.startDate).getTime();
      const endMs = new Date(item.endDate).getTime();
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs < startMs) {
        throw new BadRequestAppException('users.invalidOrganizationMembershipPeriod');
      }
    }
  }

  const prevLinks = await userOrgRepository.findByUserIds([id]);
  const prevOrgUnitIds = prevLinks.map((l) => Number(l.organizationUnitId));
  const unitIds = dto.organizationUnits.map((o) => o.organizationUnitId);
  if (unitIds.length > 0 && organizationsPublicService) {
    await organizationsPublicService.ensureActiveUnitsExist(unitIds);
  }

  const effectiveActorId = actorId ?? actor?.id ?? null;
  const effectiveReason = dto.reason?.trim() || null;

  const work = async (): Promise<void> => {
    const savedLinks = await userOrgRepository.replaceUserOrganizations(id, dto.organizationUnits);
    const primaryLink = savedLinks.find((l) => l.isPrimary) ?? savedLinks[0];
    user.primaryOrganizationUnitId = primaryLink ? Number(primaryLink.organizationUnitId) : null;
    await userRepository.saveEntity(user);

    if (userOrgHistoryRepository) {
      const prevByUnitId = new Map(prevLinks.map((l) => [Number(l.organizationUnitId), l]));
      const nextByUnitId = new Map(savedLinks.map((l) => [Number(l.organizationUnitId), l]));
      const removedLinks = prevLinks.filter((l) => !nextByUnitId.has(Number(l.organizationUnitId)));
      const primaryRemovedUnitId =
        (removedLinks.find((r) => r.isPrimary) ?? removedLinks[0])?.organizationUnitId ?? null;

      const historyEntries: RecordUserOrganizationHistoryInput[] = [];
      const now = new Date();

      for (const removed of removedLinks) {
        historyEntries.push({
          userId: id,
          organizationUnitId: Number(removed.organizationUnitId),
          fromOrganizationUnitId: null,
          actionType: 'END',
          isPrimary: Boolean(removed.isPrimary),
          positionTitle: removed.positionTitle ?? null,
          startDate: removed.startDate ? new Date(removed.startDate) : null,
          endDate: removed.endDate ? new Date(removed.endDate) : now,
          reason: effectiveReason ?? 'Ended organization unit membership',
          changedBy: effectiveActorId,
        });
      }

      for (const saved of savedLinks) {
        const unitId = Number(saved.organizationUnitId);
        const prev = prevByUnitId.get(unitId);
        if (!prev) {
          const isTransfer = removedLinks.length > 0;
          historyEntries.push({
            userId: id,
            organizationUnitId: unitId,
            fromOrganizationUnitId:
              isTransfer && primaryRemovedUnitId !== null ? Number(primaryRemovedUnitId) : null,
            actionType: isTransfer ? 'TRANSFER' : 'ASSIGN',
            isPrimary: Boolean(saved.isPrimary),
            positionTitle: saved.positionTitle ?? null,
            startDate: saved.startDate ? new Date(saved.startDate) : now,
            endDate: saved.endDate ? new Date(saved.endDate) : null,
            reason:
              effectiveReason ??
              (isTransfer
                ? 'Transferred user to new organization unit'
                : 'Assigned user to organization unit'),
            changedBy: effectiveActorId,
          });
        } else {
          const prevStartIso = prev.startDate ? new Date(prev.startDate).toISOString() : null;
          const nextStartIso = saved.startDate ? new Date(saved.startDate).toISOString() : null;
          const prevEndIso = prev.endDate ? new Date(prev.endDate).toISOString() : null;
          const nextEndIso = saved.endDate ? new Date(saved.endDate).toISOString() : null;
          const hasChanged =
            Boolean(prev.isPrimary) !== Boolean(saved.isPrimary) ||
            (prev.positionTitle ?? null) !== (saved.positionTitle ?? null) ||
            prevStartIso !== nextStartIso ||
            prevEndIso !== nextEndIso ||
            Boolean(effectiveReason);

          if (hasChanged) {
            historyEntries.push({
              userId: id,
              organizationUnitId: unitId,
              fromOrganizationUnitId: unitId,
              actionType: 'UPDATE',
              isPrimary: Boolean(saved.isPrimary),
              positionTitle: saved.positionTitle ?? null,
              startDate: saved.startDate ? new Date(saved.startDate) : null,
              endDate: saved.endDate ? new Date(saved.endDate) : null,
              reason: effectiveReason ?? 'Updated organization unit membership details',
              changedBy: effectiveActorId,
            });
          }
        }
      }

      if (historyEntries.length > 0) {
        await userOrgHistoryRepository.recordHistories(historyEntries);
      }
    }
  };

  if (transactionManager) {
    await transactionManager.runInTransaction(work);
  } else {
    await work();
  }

  await invalidateIdentityCache(id);
  const updated = await getById(id);
  await auditLogService?.record({
    actorUserId: effectiveActorId,
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
    reason: effectiveReason ?? 'Updated user organization units assignment',
  });
  return updated;
}
