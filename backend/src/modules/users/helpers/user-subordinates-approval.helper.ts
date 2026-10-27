import type {
  IOrganizationsPublicService,
  OrganizationUnitSummary,
} from '@modules/organizations/contracts/index.js';
import type {
  UserApproverSummaryView,
  UserOrganizationHistoryItemView,
  UserSubordinateSummaryView,
} from '../contracts/index.js';
import { USER_STATUS } from '../enum/users.enum.js';
import { getUserStatusName, parseUserStatus } from './user-normalizer.helper.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UserOrganizationHistoryRepository } from '../repositories/user-organization-history.repository.js';
import type { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';

export function resolveEffectiveManagerForUser(
  user: Pick<
    UserEntity,
    'managerId' | 'temporaryManagerId' | 'temporaryManagerFrom' | 'temporaryManagerUntil'
  >,
  nowMs = Date.now(),
): {
  readonly managerId: number | null;
  readonly temporaryManagerId: number | null;
  readonly temporaryManagerFrom: string | null;
  readonly temporaryManagerUntil: string | null;
  readonly effectiveManagerId: number | null;
  readonly isTemporaryActive: boolean;
} {
  const managerId =
    user.managerId !== undefined && user.managerId !== null ? Number(user.managerId) : null;
  const temporaryManagerId =
    user.temporaryManagerId !== undefined && user.temporaryManagerId !== null
      ? Number(user.temporaryManagerId)
      : null;
  const fromDate = user.temporaryManagerFrom ? new Date(user.temporaryManagerFrom) : null;
  const untilDate = user.temporaryManagerUntil ? new Date(user.temporaryManagerUntil) : null;
  const isTemporaryActive =
    temporaryManagerId !== null &&
    (!fromDate || fromDate.getTime() <= nowMs) &&
    Boolean(untilDate && untilDate.getTime() >= nowMs);

  return {
    managerId,
    temporaryManagerId,
    temporaryManagerFrom:
      fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate.toISOString() : null,
    temporaryManagerUntil:
      untilDate && !Number.isNaN(untilDate.getTime()) ? untilDate.toISOString() : null,
    effectiveManagerId: isTemporaryActive ? temporaryManagerId : managerId,
    isTemporaryActive,
  };
}

export async function resolveUserOrganizationHistoryList(params: {
  userId: number;
  userOrgHistoryRepository: UserOrganizationHistoryRepository | null;
  organizationsPublicService: IOrganizationsPublicService | null;
}): Promise<UserOrganizationHistoryItemView[]> {
  const { userId, userOrgHistoryRepository, organizationsPublicService } = params;
  if (!userOrgHistoryRepository) return [];

  const rows = await userOrgHistoryRepository.findByUserId(userId);
  if (rows.length === 0) return [];

  const orgIds = new Set<number>();
  for (const r of rows) {
    orgIds.add(Number(r.organizationUnitId));
    if (r.fromOrganizationUnitId !== undefined && r.fromOrganizationUnitId !== null) {
      orgIds.add(Number(r.fromOrganizationUnitId));
    }
  }

  const orgSummaries: OrganizationUnitSummary[] =
    orgIds.size > 0 && organizationsPublicService
      ? await organizationsPublicService.findByIds([...orgIds])
      : [];
  const orgMap = new Map(orgSummaries.map((o) => [Number(o.id), o]));

  return rows.map((r) => {
    const targetOrg = orgMap.get(Number(r.organizationUnitId));
    const fromOrgId =
      r.fromOrganizationUnitId !== undefined && r.fromOrganizationUnitId !== null
        ? Number(r.fromOrganizationUnitId)
        : null;
    const fromOrg = fromOrgId !== null ? orgMap.get(fromOrgId) : undefined;

    return {
      id: Number(r.id),
      userId: Number(r.userId),
      organizationUnitId: Number(r.organizationUnitId),
      organizationUnitCode: targetOrg?.code ?? null,
      organizationUnitName: targetOrg?.name ?? null,
      fromOrganizationUnitId: fromOrgId,
      fromOrganizationUnitCode: fromOrg?.code ?? null,
      fromOrganizationUnitName: fromOrg?.name ?? null,
      actionType: r.actionType,
      isPrimary: Boolean(r.isPrimary),
      positionTitle: r.positionTitle ?? null,
      startDate: r.startDate ? new Date(r.startDate).toISOString() : null,
      endDate: r.endDate ? new Date(r.endDate).toISOString() : null,
      reason: r.reason ?? null,
      changedBy: r.changedBy !== undefined && r.changedBy !== null ? Number(r.changedBy) : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function resolveUserSubordinatesList(params: {
  managerId: number;
  options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean } | undefined;
  userRepository: UserRepository;
  userOrgRepository: UserOrganizationUnitRepository;
  findProfilesByUserIds: (userIds: readonly number[]) => Promise<UserProfileEntity[]>;
  organizationsPublicService: IOrganizationsPublicService | null;
}): Promise<UserSubordinateSummaryView[]> {
  const {
    managerId,
    options,
    userRepository,
    userOrgRepository,
    findProfilesByUserIds,
    organizationsPublicService,
  } = params;

  if (typeof userRepository.findSubordinateRelations !== 'function') {
    return [];
  }

  const relations = await userRepository.findSubordinateRelations(managerId, options);
  if (relations.length === 0) return [];

  const subIds = relations.map((r) => r.userId);
  const [users, profiles, orgLinks] = await Promise.all([
    Promise.all(subIds.map((uid) => userRepository.findByIdWithArchived(uid, false))),
    findProfilesByUserIds(subIds),
    userOrgRepository.findByUserIds(subIds),
  ]);

  const userMap = new Map<number, UserEntity>();
  for (const u of users) {
    if (u && !u.deletedAt && !u.archivedAt) {
      userMap.set(Number(u.id), u);
    }
  }

  const profileMap = new Map<number, UserProfileEntity>();
  for (const p of profiles) {
    profileMap.set(Number(p.userId), p);
  }

  const primaryPositionByUser = new Map<number, string | null>();
  const distinctOrgIds = new Set<number>();
  for (const u of userMap.values()) {
    if (u.primaryOrganizationUnitId) {
      distinctOrgIds.add(Number(u.primaryOrganizationUnitId));
    }
  }
  for (const link of orgLinks) {
    const uid = Number(link.userId);
    distinctOrgIds.add(Number(link.organizationUnitId));
    if (link.isPrimary || !primaryPositionByUser.has(uid)) {
      primaryPositionByUser.set(uid, link.positionTitle ?? null);
    }
  }

  const orgSummaries =
    distinctOrgIds.size > 0 && organizationsPublicService
      ? await organizationsPublicService.findByIds([...distinctOrgIds])
      : [];
  const orgMap = new Map(orgSummaries.map((o) => [Number(o.id), o]));

  const items: UserSubordinateSummaryView[] = [];
  for (const rel of relations) {
    const u = userMap.get(rel.userId);
    if (!u) continue;
    const prof = profileMap.get(rel.userId);
    const statusCode = parseUserStatus(u.status);
    const primaryOrgId =
      u.primaryOrganizationUnitId !== undefined && u.primaryOrganizationUnitId !== null
        ? Number(u.primaryOrganizationUnitId)
        : null;
    const mgrInfo = resolveEffectiveManagerForUser(u);

    items.push({
      id: rel.userId,
      username: u.username,
      fullName:
        prof?.fullName || `${prof?.lastName ?? ''} ${prof?.firstName ?? ''}`.trim() || u.username,
      email: u.email ?? '',
      status: statusCode,
      statusName: getUserStatusName(statusCode),
      primaryOrganizationUnitId: primaryOrgId,
      primaryOrganizationUnitName:
        primaryOrgId !== null ? (orgMap.get(primaryOrgId)?.name ?? null) : null,
      positionTitle: primaryPositionByUser.get(rel.userId) ?? null,
      managerId: mgrInfo.managerId,
      temporaryManagerId: mgrInfo.temporaryManagerId,
      temporaryManagerFrom: mgrInfo.temporaryManagerFrom,
      temporaryManagerUntil: mgrInfo.temporaryManagerUntil,
      effectiveManagerId: mgrInfo.effectiveManagerId,
      relationType: rel.relationType,
      level: rel.level,
    });
  }

  return items;
}

export async function resolveUserApproverChain(params: {
  userId: number;
  maxLevels?: number | undefined;
  userRepository: UserRepository;
  userOrgRepository: UserOrganizationUnitRepository;
  findProfilesByUserIds: (userIds: readonly number[]) => Promise<UserProfileEntity[]>;
}): Promise<UserApproverSummaryView[]> {
  const {
    userId,
    maxLevels = 5,
    userRepository,
    userOrgRepository,
    findProfilesByUserIds,
  } = params;

  const visited = new Set<number>([Number(userId)]);
  const chainEntries: Array<{
    readonly step: number;
    readonly user: UserEntity;
    readonly sourceType: 'DIRECT_MANAGER' | 'TEMPORARY_MANAGER';
  }> = [];

  let currentUser = await userRepository.findByIdWithArchived(Number(userId), false);
  let step = 1;

  while (currentUser && step <= maxLevels) {
    const mgrInfo = resolveEffectiveManagerForUser(currentUser);
    const nextManagerId = mgrInfo.effectiveManagerId;
    if (!nextManagerId || visited.has(nextManagerId)) {
      break;
    }
    visited.add(nextManagerId);

    const managerEntity = await userRepository.findByIdWithArchived(nextManagerId, false);
    if (
      !managerEntity ||
      managerEntity.deletedAt ||
      managerEntity.archivedAt ||
      Number(managerEntity.status) !== USER_STATUS.ACTIVE
    ) {
      break;
    }

    chainEntries.push({
      step,
      user: managerEntity,
      sourceType: mgrInfo.isTemporaryActive ? 'TEMPORARY_MANAGER' : 'DIRECT_MANAGER',
    });

    currentUser = managerEntity;
    step += 1;
  }

  if (chainEntries.length === 0) return [];

  const approverIds = chainEntries.map((c) => Number(c.user.id));
  const [profiles, orgLinks] = await Promise.all([
    findProfilesByUserIds(approverIds),
    userOrgRepository.findByUserIds(approverIds),
  ]);

  const profileMap = new Map<number, UserProfileEntity>();
  for (const p of profiles) {
    profileMap.set(Number(p.userId), p);
  }

  const positionByUser = new Map<number, string | null>();
  for (const link of orgLinks) {
    const uid = Number(link.userId);
    if (link.isPrimary || !positionByUser.has(uid)) {
      positionByUser.set(uid, link.positionTitle ?? null);
    }
  }

  return chainEntries.map((entry) => {
    const uid = Number(entry.user.id);
    const prof = profileMap.get(uid);
    return {
      step: entry.step,
      userId: uid,
      username: entry.user.username,
      fullName:
        prof?.fullName ||
        `${prof?.lastName ?? ''} ${prof?.firstName ?? ''}`.trim() ||
        entry.user.username,
      email: entry.user.email ?? '',
      status: parseUserStatus(entry.user.status),
      primaryOrganizationUnitId:
        entry.user.primaryOrganizationUnitId !== undefined &&
        entry.user.primaryOrganizationUnitId !== null
          ? Number(entry.user.primaryOrganizationUnitId)
          : null,
      positionTitle: positionByUser.get(uid) ?? null,
      sourceType: entry.sourceType,
    };
  });
}
