import { BadRequestAppException, ForbiddenAppException } from '@packages/kernel/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import type { IRolesPublicService } from '@modules/roles/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import {
  NOTIFICATION_TARGET_TYPE,
  type NotificationTargetTypeCode,
} from '../enum/notifications.enum.js';
import type {
  NotificationTargetPayload,
  ResolvedNotificationRuntimeConfig,
} from '../types/notifications.types.js';

export interface ResolvedNotificationTargetRecipients {
  readonly targetType: NotificationTargetTypeCode;
  readonly targetPayload: NotificationTargetPayload;
  readonly recipientUserIds: readonly number[];
}

export async function resolveNotificationTargetRecipients(params: {
  targetType: NotificationTargetTypeCode;
  userId?: number | undefined;
  userIds?: readonly number[] | undefined;
  roleIds?: readonly number[] | undefined;
  roleCodes?: readonly string[] | undefined;
  organizationUnitIds?: readonly number[] | undefined;
  includeSubUnits?: boolean | undefined;
  runtimeConfig: ResolvedNotificationRuntimeConfig;
  usersPublicService: IUsersPublicService | null;
  rolesPublicService: IRolesPublicService | null;
  organizationsPublicService: IOrganizationsPublicService | null;
}): Promise<ResolvedNotificationTargetRecipients> {
  const {
    targetType,
    userId,
    userIds,
    roleIds,
    roleCodes,
    organizationUnitIds,
    includeSubUnits,
    runtimeConfig,
    usersPublicService,
    rolesPublicService,
    organizationsPublicService,
  } = params;

  if (targetType === NOTIFICATION_TARGET_TYPE.SINGLE_USER) {
    const candidateId =
      userId !== undefined && Number(userId) >= 1
        ? Number(userId)
        : userIds && userIds.length === 1 && Number(userIds[0]) >= 1
          ? Number(userIds[0])
          : null;

    if (!candidateId) {
      throw new BadRequestAppException('notifications.singleUserRequired');
    }

    let resolvedIds = [candidateId];
    if (usersPublicService?.findActiveUserIdsByIds) {
      resolvedIds = await usersPublicService.findActiveUserIdsByIds([candidateId]);
    } else if (usersPublicService) {
      const u = await usersPublicService.findAuthUserById(candidateId);
      resolvedIds = u ? [u.id] : [];
    }

    if (resolvedIds.length === 0) {
      throw new BadRequestAppException('notifications.targetUserNotFoundOrInactive', [
        { userId: candidateId },
      ]);
    }

    return {
      targetType,
      targetPayload: { userIds: [candidateId] },
      recipientUserIds: resolvedIds,
    };
  }

  if (targetType === NOTIFICATION_TARGET_TYPE.USER_GROUP) {
    const rawIds = [
      ...(userId !== undefined ? [Number(userId)] : []),
      ...(userIds ?? []).map(Number),
    ].filter((n) => Number.isFinite(n) && n >= 1);
    const uniqueUserIds = [...new Set(rawIds)];

    if (uniqueUserIds.length === 0) {
      throw new BadRequestAppException('notifications.userGroupEmpty');
    }

    let resolvedIds = uniqueUserIds;
    if (usersPublicService?.findActiveUserIdsByIds) {
      resolvedIds = await usersPublicService.findActiveUserIdsByIds(uniqueUserIds);
    }

    if (resolvedIds.length > runtimeConfig.maxRecipientsPerBatch) {
      throw new BadRequestAppException('notifications.maxRecipientsExceeded', [
        {
          count: resolvedIds.length,
          max: runtimeConfig.maxRecipientsPerBatch,
        },
      ]);
    }

    return {
      targetType,
      targetPayload: { userIds: uniqueUserIds },
      recipientUserIds: resolvedIds,
    };
  }

  if (targetType === NOTIFICATION_TARGET_TYPE.ROLE) {
    if (!runtimeConfig.roleTargetingEnabled || !runtimeConfig.roleBroadcastFlagEnabled) {
      throw new ForbiddenAppException('notifications.roleTargetingDisabled');
    }

    const inputRoleIds = [...new Set((roleIds ?? []).map(Number).filter((n) => n >= 1))];
    const inputRoleCodes = [
      ...new Set((roleCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean)),
    ];

    if (inputRoleIds.length === 0 && inputRoleCodes.length === 0) {
      throw new BadRequestAppException('notifications.roleTargetRequired');
    }

    const finalRoleIds = new Set<number>(inputRoleIds);
    const finalRoleCodes = new Set<string>(inputRoleCodes);

    if (rolesPublicService) {
      if (inputRoleIds.length > 0) {
        const activeRoles = await rolesPublicService.ensureActiveRolesExist(inputRoleIds);
        for (const r of activeRoles) {
          finalRoleIds.add(r.id);
          finalRoleCodes.add(r.code);
        }
      }
      if (inputRoleCodes.length > 0) {
        const foundByCodes = await rolesPublicService.findByCodes(inputRoleCodes);
        if (foundByCodes.length === 0 && finalRoleIds.size === 0) {
          throw new BadRequestAppException('notifications.roleTargetNotFound');
        }
        for (const r of foundByCodes) {
          finalRoleIds.add(r.id);
          finalRoleCodes.add(r.code);
        }
      }
    }

    const roleIdArray = [...finalRoleIds];
    let resolvedUserIds: number[] = [];
    if (usersPublicService?.findActiveUserIdsByRoleIds && roleIdArray.length > 0) {
      resolvedUserIds = await usersPublicService.findActiveUserIdsByRoleIds(roleIdArray);
    }

    if (resolvedUserIds.length > runtimeConfig.maxRecipientsPerBatch) {
      throw new BadRequestAppException('notifications.maxRecipientsExceeded', [
        {
          count: resolvedUserIds.length,
          max: runtimeConfig.maxRecipientsPerBatch,
        },
      ]);
    }

    return {
      targetType,
      targetPayload: {
        roleIds: roleIdArray,
        roleCodes: [...finalRoleCodes],
      },
      recipientUserIds: resolvedUserIds,
    };
  }

  if (targetType === NOTIFICATION_TARGET_TYPE.ORG_UNIT) {
    if (!runtimeConfig.orgUnitModuleInstalled || !organizationsPublicService) {
      throw new BadRequestAppException('notifications.organizationModuleNotAvailable');
    }

    if (!runtimeConfig.orgUnitTargetingEnabled || !runtimeConfig.orgUnitBroadcastFlagEnabled) {
      throw new ForbiddenAppException('notifications.organizationTargetingDisabled');
    }

    const inputUnitIds = [
      ...new Set(
        (organizationUnitIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n >= 1),
      ),
    ];
    if (inputUnitIds.length === 0) {
      throw new BadRequestAppException('notifications.organizationTargetRequired');
    }

    await organizationsPublicService.ensureActiveUnitsExist(inputUnitIds);

    const effectiveIncludeSubUnits =
      includeSubUnits !== undefined
        ? Boolean(includeSubUnits)
        : runtimeConfig.orgUnitIncludeSubUnitsDefault;

    let effectiveUnitIds = [...inputUnitIds];
    if (
      effectiveIncludeSubUnits &&
      typeof organizationsPublicService.resolveDescendantUnitIds === 'function'
    ) {
      const withDescendants =
        await organizationsPublicService.resolveDescendantUnitIds(inputUnitIds);
      if (withDescendants.length > 0) {
        effectiveUnitIds = [...new Set([...inputUnitIds, ...withDescendants])];
      }
    }

    let resolvedUserIds: number[] = [];
    if (usersPublicService?.findActiveUserIdsByOrganizationUnitIds) {
      resolvedUserIds =
        await usersPublicService.findActiveUserIdsByOrganizationUnitIds(effectiveUnitIds);
    }

    if (resolvedUserIds.length > runtimeConfig.maxRecipientsPerBatch) {
      throw new BadRequestAppException('notifications.maxRecipientsExceeded', [
        {
          count: resolvedUserIds.length,
          max: runtimeConfig.maxRecipientsPerBatch,
        },
      ]);
    }

    return {
      targetType,
      targetPayload: {
        organizationUnitIds: inputUnitIds,
        includeSubUnits: effectiveIncludeSubUnits,
      },
      recipientUserIds: resolvedUserIds,
    };
  }

  throw new BadRequestAppException('notifications.invalidTargetType');
}
