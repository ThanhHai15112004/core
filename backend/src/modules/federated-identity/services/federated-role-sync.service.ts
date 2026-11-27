import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ForbiddenAppException } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  type IRolesPublicService,
  ROLE_STATUS,
  ROLES_PUBLIC_SERVICE,
  type RoleSummary,
} from '@modules/roles/contracts/index.js';
import {
  FEDERATED_AUDIT_META,
  FEDERATED_PROTECTED_DENIED_ROLES,
  FEDERATED_ROLE_SYNC_MODE,
} from '../enum/federated-identity.enum.js';
import type {
  FederatedRoleSyncPolicy,
  FederatedRoleSyncSummary,
} from '../types/federated-identity.types.js';

export interface SyncRolesForLoginInput {
  readonly userId: number;
  readonly providerCode: string;
  readonly isNewUser: boolean;
  readonly groups: readonly string[];
  readonly policy: FederatedRoleSyncPolicy;
  readonly ipAddress?: string | null | undefined;
}

function sameSortedNumberArrays(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

@Injectable()
export class FederatedRoleSyncService {
  private readonly logger = new Logger(FederatedRoleSyncService.name);

  constructor(
    @Optional()
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService?: IRolesPublicService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  public async syncRolesForLogin(input: SyncRolesForLoginInput): Promise<FederatedRoleSyncSummary> {
    const { userId, providerCode, isNewUser, groups, policy } = input;

    if (!policy.enabled) {
      return {
        enabled: false,
        applied: false,
        mode: policy.mode,
        action: 'DISABLED',
        matchedGroups: [],
        appliedRoleCodes: [],
        blockedRoleCodes: [],
        ignoredRoleCodes: [],
      };
    }

    const matched = this.matchGroupsToCandidateRoles(groups, policy.groupRoleMappings);
    if (policy.requireMatchedGroup && matched.matchedGroups.length === 0) {
      throw new ForbiddenAppException('federated-identity.ssoGroupNotAllowed');
    }

    if (!this.rolesPublicService) {
      return {
        enabled: true,
        applied: false,
        mode: policy.mode,
        action: 'NO_ROLES_SERVICE',
        matchedGroups: matched.matchedGroups,
        appliedRoleCodes: [],
        blockedRoleCodes: [],
        ignoredRoleCodes: [],
      };
    }

    const deniedSet = new Set<string>([
      ...FEDERATED_PROTECTED_DENIED_ROLES.map((c) => c.toUpperCase()),
      ...policy.deniedRoleCodes.map((c) => c.trim().toUpperCase()).filter(Boolean),
    ]);

    const allowedSet = new Set<string>(
      policy.allowedRoleCodes
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length > 0 && !deniedSet.has(c)),
    );

    const candidateCodes = new Set<string>(matched.candidateRoleCodes);
    if (matched.matchedGroups.length === 0 || isNewUser) {
      for (const defCode of policy.defaultRoleCodes) {
        const upper = defCode.trim().toUpperCase();
        if (upper) candidateCodes.add(upper);
      }
    }

    const permittedCodes: string[] = [];
    const blockedRoleCodes: string[] = [];
    for (const code of candidateCodes) {
      if (deniedSet.has(code) || !allowedSet.has(code)) {
        blockedRoleCodes.push(code);
      } else {
        permittedCodes.push(code);
      }
    }

    if (blockedRoleCodes.length > 0) {
      this.logger.warn(
        `[SSO_ROLE_SYNC_BLOCKED] provider=${providerCode} userId=${userId} blockedRoles=${blockedRoleCodes.join(',')}`,
      );
    }

    if (policy.mode === FEDERATED_ROLE_SYNC_MODE.ASSIGN_ON_CREATE && !isNewUser) {
      return {
        enabled: true,
        applied: false,
        mode: policy.mode,
        action: 'SKIPPED_EXISTING_USER',
        matchedGroups: matched.matchedGroups,
        appliedRoleCodes: [],
        blockedRoleCodes,
        ignoredRoleCodes: [],
      };
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
    const ignoredRoleCodes: string[] = [];
    for (const code of permittedCodes) {
      const found = activeByUpper.get(code);
      if (found) {
        resolvedActiveRoles.push(found);
      } else {
        ignoredRoleCodes.push(code);
      }
    }

    const existingLinks = this.rolesPublicService.findUserRoleLinksByUserIds
      ? await this.rolesPublicService.findUserRoleLinksByUserIds([userId])
      : [];
    const existingRoleIds = Array.from(new Set(existingLinks.map((link) => Number(link.roleId))));

    let nextRoleIds: number[];
    const resolvedActiveIds = resolvedActiveRoles.map((r) => Number(r.id));

    if (policy.mode === FEDERATED_ROLE_SYNC_MODE.SYNC_MANAGED) {
      const allAllowedRoles =
        allowedSet.size > 0 ? await this.rolesPublicService.findByCodes([...allowedSet]) : [];
      const managedRoleIdSet = new Set<number>(allAllowedRoles.map((r) => Number(r.id)));
      const preservedRoleIds = existingRoleIds.filter((id) => !managedRoleIdSet.has(id));
      nextRoleIds = Array.from(new Set([...preservedRoleIds, ...resolvedActiveIds]));
    } else {
      nextRoleIds = Array.from(new Set([...existingRoleIds, ...resolvedActiveIds]));
    }

    const appliedRoleCodes = resolvedActiveRoles.map((r) => r.code);
    if (sameSortedNumberArrays(existingRoleIds, nextRoleIds)) {
      return {
        enabled: true,
        applied: false,
        mode: policy.mode,
        action: 'UNCHANGED',
        matchedGroups: matched.matchedGroups,
        appliedRoleCodes,
        blockedRoleCodes,
        ignoredRoleCodes,
      };
    }

    await this.rolesPublicService.replaceUserRoles?.(userId, nextRoleIds, null);

    await this.auditLogService
      ?.record({
        actorUserId: userId,
        module: FEDERATED_AUDIT_META.MODULE,
        feature: FEDERATED_AUDIT_META.FEATURE_ROLE_SYNC,
        action: 'SYNC_ROLES',
        resourceType: 'user_roles',
        resourceId: userId,
        ipAddress: input.ipAddress ?? null,
        beforeData: { roleIds: existingRoleIds },
        afterData: {
          roleIds: nextRoleIds,
          providerCode,
          mode: policy.mode,
          matchedGroups: matched.matchedGroups,
          appliedRoleCodes,
          blockedRoleCodes,
          ignoredRoleCodes,
        },
      })
      .catch(() => undefined);

    return {
      enabled: true,
      applied: true,
      mode: policy.mode,
      action: 'UPDATED',
      matchedGroups: matched.matchedGroups,
      appliedRoleCodes,
      blockedRoleCodes,
      ignoredRoleCodes,
    };
  }

  private matchGroupsToCandidateRoles(
    groups: readonly string[],
    mappings: Readonly<Record<string, readonly string[]>>,
  ): {
    readonly matchedGroups: string[];
    readonly candidateRoleCodes: string[];
  } {
    const cleanGroups = groups.map((g) => g.trim()).filter(Boolean);
    if (cleanGroups.length === 0) {
      return { matchedGroups: [], candidateRoleCodes: [] };
    }

    const lowerMap = new Map<string, readonly string[]>();
    for (const [key, roleList] of Object.entries(mappings)) {
      const cleanKey = key.trim();
      if (cleanKey) {
        lowerMap.set(cleanKey.toLowerCase(), roleList);
      }
    }

    const matchedGroups: string[] = [];
    const candidateRoleSet = new Set<string>();

    for (const grp of cleanGroups) {
      const exactRoles = Object.prototype.hasOwnProperty.call(mappings, grp)
        ? mappings[grp]
        : undefined;
      const resolvedRoles = exactRoles ?? lowerMap.get(grp.toLowerCase());
      if (!resolvedRoles || resolvedRoles.length === 0) continue;
      matchedGroups.push(grp);
      for (const roleCode of resolvedRoles) {
        const upper = roleCode.trim().toUpperCase();
        if (upper) candidateRoleSet.add(upper);
      }
    }

    return {
      matchedGroups,
      candidateRoleCodes: Array.from(candidateRoleSet),
    };
  }
}
