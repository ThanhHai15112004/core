import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { safeJsonParseObject, safeJsonParseStringArray } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  type IRolesPublicService,
  ROLE_STATUS,
  ROLES_PUBLIC_SERVICE,
  type RoleSummary,
} from '@modules/roles/contracts/index.js';
import {
  SCIM_AUDIT_META,
  SCIM_PROTECTED_DENIED_ROLES,
} from '../enum/identity-provisioning.enum.js';
import type { ScimClientEntity } from '../entities/scim-client.entity.js';
import type { ScimGroupEntity } from '../entities/scim-group.entity.js';
import { ScimGroupMemberRepository } from '../repositories/scim-group-member.repository.js';
import { ScimGroupRepository } from '../repositories/scim-group.repository.js';

export interface ScimUserRoleSyncResult {
  readonly userId: number;
  readonly applied: boolean;
  readonly appliedRoleCodes: readonly string[];
  readonly blockedRoleCodes: readonly string[];
}

function sameSortedNumberArrays(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

@Injectable()
export class ScimGroupRoleSyncService {
  private readonly logger = new Logger(ScimGroupRoleSyncService.name);

  constructor(
    private readonly groupRepository: ScimGroupRepository,
    private readonly memberRepository: ScimGroupMemberRepository,
    @Optional()
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService?: IRolesPublicService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  public resolveMappedRolesForGroupName(client: ScimClientEntity, displayName: string): string[] {
    const rawMappings = safeJsonParseObject(client.groupRoleMappingsJson) ?? {};
    const lowerMap = new Map<string, string[]>();

    for (const [key, val] of Object.entries(rawMappings)) {
      if (!Array.isArray(val)) continue;
      const roles = val
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
      if (roles.length > 0) {
        lowerMap.set(key.trim().toLowerCase(), roles);
      }
    }

    const direct = lowerMap.get(displayName.trim().toLowerCase());
    if (direct) return direct;
    return [];
  }

  public async syncUserRolesFromClientGroups(
    client: ScimClientEntity,
    userId: number,
    ipAddress?: string | null,
  ): Promise<ScimUserRoleSyncResult> {
    if (!this.rolesPublicService) {
      return { userId, applied: false, appliedRoleCodes: [], blockedRoleCodes: [] };
    }

    const allowedList = safeJsonParseStringArray(client.allowedRoleCodesJson)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const deniedSet = new Set<string>([
      ...SCIM_PROTECTED_DENIED_ROLES.map((c) => c.toUpperCase()),
      ...safeJsonParseStringArray(client.deniedRoleCodesJson)
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    ]);
    const allowedSet = new Set<string>(allowedList.filter((c) => !deniedSet.has(c)));

    const clientGroups = await this.groupRepository.findByClient(client.id);
    const activeGroupById = new Map<number, ScimGroupEntity>();
    for (const grp of clientGroups) {
      if (grp.active) {
        activeGroupById.set(Number(grp.id), grp);
      }
    }

    const memberships = await this.memberRepository.findByClientAndUserId(client.id, userId);
    const candidateCodes = new Set<string>();

    for (const membership of memberships) {
      const grp = activeGroupById.get(Number(membership.scimGroupId));
      if (!grp) continue;
      if (grp.mappedRoleCode?.trim()) {
        candidateCodes.add(grp.mappedRoleCode.trim().toUpperCase());
      }
      for (const mapped of this.resolveMappedRolesForGroupName(client, grp.displayName)) {
        candidateCodes.add(mapped);
      }
    }

    for (const defRole of safeJsonParseStringArray(client.defaultRoleCodesJson)) {
      const upper = defRole.trim().toUpperCase();
      if (upper) candidateCodes.add(upper);
    }

    const permittedCodes: string[] = [];
    const blockedRoleCodes: string[] = [];
    for (const code of candidateCodes) {
      if (
        deniedSet.has(code) ||
        (allowedSet.size > 0 && !allowedSet.has(code)) ||
        allowedSet.size === 0
      ) {
        // An toàn mặc định: chỉ cho phép gán các role nằm trong allowedRoleCodes của SCIM client
        blockedRoleCodes.push(code);
      } else {
        permittedCodes.push(code);
      }
    }

    if (blockedRoleCodes.length > 0) {
      this.logger.warn(
        `[SCIM_ROLE_SYNC_BLOCKED] client=${client.code} userId=${userId} blockedRoles=${blockedRoleCodes.join(',')}`,
      );
    }

    const resolvedRoles =
      permittedCodes.length > 0 ? await this.rolesPublicService.findByCodes(permittedCodes) : [];
    const activeByUpper = new Map<string, RoleSummary>();
    for (const role of resolvedRoles) {
      if (Number(role.status) === ROLE_STATUS.ACTIVE) {
        activeByUpper.set(role.code.trim().toUpperCase(), role);
      }
    }

    const resolvedActiveRoles: RoleSummary[] = [];
    for (const code of permittedCodes) {
      const found = activeByUpper.get(code);
      if (found) resolvedActiveRoles.push(found);
    }

    const existingLinks = this.rolesPublicService.findUserRoleLinksByUserIds
      ? await this.rolesPublicService.findUserRoleLinksByUserIds([userId])
      : [];
    const existingRoleIds = Array.from(new Set(existingLinks.map((l) => Number(l.roleId))));

    const allAllowedRoles =
      allowedSet.size > 0 ? await this.rolesPublicService.findByCodes([...allowedSet]) : [];
    const managedRoleIdSet = new Set<number>(allAllowedRoles.map((r) => Number(r.id)));
    const preservedRoleIds = existingRoleIds.filter((id) => !managedRoleIdSet.has(id));
    const resolvedActiveIds = resolvedActiveRoles.map((r) => Number(r.id));
    const nextRoleIds = Array.from(new Set([...preservedRoleIds, ...resolvedActiveIds]));

    if (sameSortedNumberArrays(existingRoleIds, nextRoleIds)) {
      return {
        userId,
        applied: false,
        appliedRoleCodes: resolvedActiveRoles.map((r) => r.code),
        blockedRoleCodes,
      };
    }

    await this.rolesPublicService.replaceUserRoles?.(userId, nextRoleIds, null);

    await this.auditLogService
      ?.record({
        actorUserId: userId,
        module: SCIM_AUDIT_META.MODULE,
        feature: SCIM_AUDIT_META.FEATURE_ROLE_SYNC,
        action: 'SCIM_SYNC_USER_ROLES',
        resourceType: 'user_roles',
        resourceId: userId,
        ipAddress: ipAddress ?? null,
        beforeData: { roleIds: existingRoleIds },
        afterData: {
          roleIds: nextRoleIds,
          clientCode: client.code,
          appliedRoleCodes: resolvedActiveRoles.map((r) => r.code),
          blockedRoleCodes,
        },
      })
      .catch(() => undefined);

    return {
      userId,
      applied: true,
      appliedRoleCodes: resolvedActiveRoles.map((r) => r.code),
      blockedRoleCodes,
    };
  }
}
