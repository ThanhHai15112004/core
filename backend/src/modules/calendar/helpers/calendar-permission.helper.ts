import { ForbiddenAppException } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import type { CalendarEventParticipantEntity } from '../entities/calendar-event-participant.entity.js';
import type { CalendarEventEntity } from '../entities/calendar-event.entity.js';
import {
  CALENDAR_ACCESS_ROLE,
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_VISIBILITY,
} from '../enum/calendar.enum.js';
import type { CalendarEventAccessEvaluation } from '../types/calendar.types.js';

export async function resolveEventTargetUserIds(params: {
  event: CalendarEventEntity;
  participants: readonly CalendarEventParticipantEntity[];
  usersPublicService?: IUsersPublicService | null | undefined;
  organizationsPublicService?: IOrganizationsPublicService | null | undefined;
}): Promise<number[]> {
  const { event, participants, usersPublicService, organizationsPublicService } = params;
  const userIds = new Set<number>();

  if (event.ownerUserId && Number(event.ownerUserId) > 0) {
    userIds.add(Number(event.ownerUserId));
  }

  const orgUnitIds = new Set<number>();
  for (const part of participants) {
    if (part.participantType === CALENDAR_PARTICIPANT_TYPE.USER && part.userId) {
      userIds.add(Number(part.userId));
    } else if (
      part.participantType === CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT &&
      part.organizationUnitId
    ) {
      orgUnitIds.add(Number(part.organizationUnitId));
    }
  }

  if (orgUnitIds.size > 0 && usersPublicService?.findActiveUserIdsByOrganizationUnitIds) {
    let targetUnitIds = [...orgUnitIds];
    if (organizationsPublicService?.resolveDescendantUnitIds) {
      const descendants = await organizationsPublicService
        .resolveDescendantUnitIds(targetUnitIds)
        .catch(() => targetUnitIds);
      if (descendants.length > 0) {
        targetUnitIds = [...new Set([...targetUnitIds, ...descendants])];
      }
    }
    const unitUsers = await usersPublicService
      .findActiveUserIdsByOrganizationUnitIds(targetUnitIds)
      .catch(() => [] as number[]);
    for (const uid of unitUsers) {
      if (Number(uid) > 0) userIds.add(Number(uid));
    }
  }

  return [...userIds];
}

/**
 * 9.7.6: Phân quyền xem và sửa lịch theo Owner, Participant hoặc Manager.
 */
export async function evaluateCalendarEventAccess(params: {
  event: CalendarEventEntity;
  participants: readonly CalendarEventParticipantEntity[];
  actor?: UserIdentity | null | undefined;
  usersPublicService?: IUsersPublicService | null | undefined;
  organizationsPublicService?: IOrganizationsPublicService | null | undefined;
}): Promise<CalendarEventAccessEvaluation> {
  const { event, participants, actor, usersPublicService, organizationsPublicService } = params;

  if (!actor || !actor.id) {
    return {
      accessRole: CALENDAR_ACCESS_ROLE.VIEWER,
      canView: event.visibility !== CALENDAR_VISIBILITY.PRIVATE,
      canEdit: false,
      canDelete: false,
      canManageParticipants: false,
      canRsvp: false,
      matchedReasons: ['ANONYMOUS_OR_SYSTEM_VIEWER'],
    };
  }

  const actorId = Number(actor.id);
  const reasons: string[] = [];

  // 1. Kiểm tra OWNER (Người tạo / chủ sở hữu sự kiện)
  if (Number(event.ownerUserId) === actorId) {
    reasons.push('EVENT_OWNER');
    return {
      accessRole: CALENDAR_ACCESS_ROLE.OWNER,
      canView: true,
      canEdit: true,
      canDelete: true,
      canManageParticipants: true,
      canRsvp: true,
      matchedReasons: reasons,
    };
  }

  // 2. Kiểm tra MANAGER (Quản lý trực tiếp/cấp trên của Owner, hoặc Trưởng đơn vị tổ chức, hoặc SuperAdmin/Manager)
  let isManager = false;
  const actorRoles = (actor.roles ?? []).map((r) => r.toLowerCase());
  const actorPerms = new Set(actor.permissions ?? []);

  if (
    actorRoles.includes('super_admin') ||
    actorRoles.includes('admin') ||
    actorPerms.has('calendar.manage')
  ) {
    isManager = true;
    reasons.push('CALENDAR_MANAGER_PERMISSION');
  }

  if (!isManager && usersPublicService) {
    if (usersPublicService.resolveApproverChain) {
      const chain = await usersPublicService
        .resolveApproverChain(Number(event.ownerUserId), 5)
        .catch(() => []);
      if (chain.some((step) => Number(step.userId) === actorId)) {
        isManager = true;
        reasons.push('OWNER_MANAGER_CHAIN');
      }
    }
    if (!isManager && usersPublicService.resolveSubordinateUserIds) {
      const subs = await usersPublicService
        .resolveSubordinateUserIds(actorId, { includeTemporary: true })
        .catch(() => [] as number[]);
      if (subs.some((uid) => Number(uid) === Number(event.ownerUserId))) {
        isManager = true;
        reasons.push('OWNER_SUBORDINATE_MANAGER');
      }
    }
    if (!isManager && usersPublicService.findAuthUserById) {
      const ownerUser = await usersPublicService
        .findAuthUserById(Number(event.ownerUserId))
        .catch(() => null);
      if (
        ownerUser &&
        (Number(ownerUser.managerId) === actorId ||
          Number(ownerUser.effectiveManagerId) === actorId ||
          Number(ownerUser.temporaryManagerId) === actorId)
      ) {
        isManager = true;
        reasons.push('OWNER_DIRECT_OR_TEMP_MANAGER');
      }
    }
  }

  const relevantUnitIds = new Set<number>();
  if (event.organizationUnitId) {
    relevantUnitIds.add(Number(event.organizationUnitId));
  }
  for (const part of participants) {
    if (
      part.participantType === CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT &&
      part.organizationUnitId
    ) {
      relevantUnitIds.add(Number(part.organizationUnitId));
    }
  }

  if (!isManager && relevantUnitIds.size > 0 && organizationsPublicService) {
    const units = await organizationsPublicService.findByIds([...relevantUnitIds]).catch(() => []);
    if (units.some((u) => Number(u.managerId) === actorId)) {
      isManager = true;
      reasons.push('ORGANIZATION_UNIT_MANAGER');
    }
  }

  // 3. Kiểm tra PARTICIPANT (Người tham gia trực tiếp USER hoặc thành viên thuộc ĐƠN VỊ tham gia)
  const directParticipant = participants.find(
    (p) => p.participantType === CALENDAR_PARTICIPANT_TYPE.USER && Number(p.userId) === actorId,
  );

  let isOrgUnitParticipant = false;
  let orgParticipantCanEdit = false;

  const actorUnitIds = new Set<number>();
  if (Array.isArray(actor.organizationUnitIds)) {
    for (const uid of actor.organizationUnitIds) {
      if (Number(uid) > 0) actorUnitIds.add(Number(uid));
    }
  }
  if (actorUnitIds.size === 0 && usersPublicService?.findAuthUserById) {
    const actorProfile = await usersPublicService.findAuthUserById(actorId).catch(() => null);
    if (actorProfile?.primaryOrganizationUnitId) {
      actorUnitIds.add(Number(actorProfile.primaryOrganizationUnitId));
    }
    for (const uid of actorProfile?.organizationUnitIds ?? []) {
      if (Number(uid) > 0) actorUnitIds.add(Number(uid));
    }
  }

  for (const part of participants) {
    if (
      part.participantType === CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT &&
      part.organizationUnitId &&
      actorUnitIds.has(Number(part.organizationUnitId))
    ) {
      isOrgUnitParticipant = true;
      if (part.canEdit || part.participantRole === CALENDAR_PARTICIPANT_ROLE.ORGANIZER) {
        orgParticipantCanEdit = true;
      }
    }
  }

  const isParticipant = Boolean(directParticipant || isOrgUnitParticipant);
  if (directParticipant) {
    reasons.push('DIRECT_USER_PARTICIPANT');
  }
  if (isOrgUnitParticipant) {
    reasons.push('ORGANIZATION_UNIT_PARTICIPANT');
  }

  if (isManager) {
    return {
      accessRole: CALENDAR_ACCESS_ROLE.MANAGER,
      canView: true,
      canEdit: true,
      canDelete: true,
      canManageParticipants: true,
      canRsvp: isParticipant,
      matchedReasons: reasons,
    };
  }

  if (isParticipant) {
    const participantCanEdit = Boolean(
      directParticipant?.canEdit ||
      directParticipant?.participantRole === CALENDAR_PARTICIPANT_ROLE.ORGANIZER ||
      orgParticipantCanEdit,
    );
    if (participantCanEdit) {
      reasons.push('PARTICIPANT_WITH_EDIT_PRIVILEGE');
    }
    return {
      accessRole: CALENDAR_ACCESS_ROLE.PARTICIPANT,
      canView: true,
      canEdit: participantCanEdit,
      canDelete: false,
      canManageParticipants: participantCanEdit,
      canRsvp: true,
      matchedReasons: reasons,
    };
  }

  // 4. Người dùng thông thường (không phải Owner, Manager, Participant)
  const canViewByVisibility = event.visibility !== CALENDAR_VISIBILITY.PRIVATE;
  return {
    accessRole: canViewByVisibility ? CALENDAR_ACCESS_ROLE.VIEWER : CALENDAR_ACCESS_ROLE.NONE,
    canView: canViewByVisibility,
    canEdit: false,
    canDelete: false,
    canManageParticipants: false,
    canRsvp: false,
    matchedReasons: canViewByVisibility
      ? ['PUBLIC_OR_INTERNAL_VISIBILITY']
      : ['PRIVATE_RESTRICTED'],
  };
}

export async function assertCanViewCalendarEvent(params: {
  event: CalendarEventEntity;
  participants: readonly CalendarEventParticipantEntity[];
  actor?: UserIdentity | null | undefined;
  usersPublicService?: IUsersPublicService | null | undefined;
  organizationsPublicService?: IOrganizationsPublicService | null | undefined;
}): Promise<CalendarEventAccessEvaluation> {
  const access = await evaluateCalendarEventAccess(params);
  if (!access.canView) {
    throw new ForbiddenAppException('calendar.forbiddenView');
  }
  return access;
}

export async function assertCanEditCalendarEvent(params: {
  event: CalendarEventEntity;
  participants: readonly CalendarEventParticipantEntity[];
  actor?: UserIdentity | null | undefined;
  usersPublicService?: IUsersPublicService | null | undefined;
  organizationsPublicService?: IOrganizationsPublicService | null | undefined;
}): Promise<CalendarEventAccessEvaluation> {
  const access = await evaluateCalendarEventAccess(params);
  if (!access.canEdit) {
    throw new ForbiddenAppException('calendar.forbiddenEdit');
  }
  return access;
}
