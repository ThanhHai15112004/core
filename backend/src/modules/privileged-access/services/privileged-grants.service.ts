import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  DomainEventBusService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  NotFoundAppException,
  PRIVILEGED_ACCESS_DOMAIN_EVENTS,
  type PaginatedResult,
  SettingRegistryService,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import { type IRolesPublicService, ROLES_PUBLIC_SERVICE } from '@modules/roles/contracts/index.js';
import {
  SESSIONS_PUBLIC_SERVICE,
  type ISessionsPublicService,
} from '@modules/sessions/contracts/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import { getGrantStatusName, parseGrantStatusCode } from '../contracts/index.js';
import {
  PRIVILEGED_ALERT_EVENT_TYPE,
  PRIVILEGED_GRANT_STATUS,
  PRIVILEGED_TARGET_TYPE,
} from '../enum/privileged-access.enum.js';
import { resolvePrivilegedAccessRuntimeConfig } from '../helpers/privileged-config.helper.js';
import {
  type BasicUserSummaryLike,
  mapGrantEntityToView,
} from '../helpers/privileged-mapper.helper.js';
import { PrivilegedAccessGrantRepository } from '../repositories/privileged-access-grant.repository.js';
import type {
  CreatePrivilegedGrantRequest,
  GrantDecisionRequest,
  ListPrivilegedGrantsQuery,
} from '../requests/privileged-access.requests.js';
import type { PrivilegedGrantView } from '../types/privileged-access.types.js';
import { PrivilegedAlertsService } from './privileged-alerts.service.js';
import { PrivilegedTargetsService } from './privileged-targets.service.js';

@Injectable()
export class PrivilegedGrantsService {
  constructor(
    private readonly grantRepository: PrivilegedAccessGrantRepository,
    private readonly targetsService: PrivilegedTargetsService,
    private readonly alertsService: PrivilegedAlertsService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersService: IUsersPublicService,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesService: IRolesPublicService,
    @Optional()
    @Inject(SESSIONS_PUBLIC_SERVICE)
    private readonly sessionsService?: ISessionsPublicService,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService,
    @Optional()
    private readonly domainEventBus: DomainEventBusService = defaultDomainEventBus,
    @Optional()
    private readonly settingRegistry: SettingRegistryService = defaultSettingRegistry,
    @Optional()
    private readonly featureFlagRegistry: FeatureFlagRegistryService = defaultFeatureFlagRegistry,
  ) {}

  private async hydrateUsersMap(
    userIds: readonly number[],
  ): Promise<Map<number, BasicUserSummaryLike>> {
    const map = new Map<number, BasicUserSummaryLike>();
    if (!this.usersService.getProvisionedUserById) return map;
    const uniqueIds = [...new Set(userIds.map(Number).filter((id) => id > 0))];
    const users = await Promise.all(
      uniqueIds.map((id) => this.usersService.getProvisionedUserById!(id).catch(() => null)),
    );
    for (const u of users) {
      if (u) {
        map.set(Number(u.id), {
          id: Number(u.id),
          username: u.username,
          email: u.email,
          fullName: u.fullName,
          status: Number(u.status),
        });
      }
    }
    return map;
  }

  /** Tạo yêu cầu cấp quyền đặc biệt tạm thời (JIT) có thời hạn và lý do */
  public async requestGrant(
    dto: CreatePrivilegedGrantRequest,
    actor?: UserIdentity,
    options?: { readonly stepUpVerified?: boolean },
  ): Promise<PrivilegedGrantView> {
    const cfg = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );
    if (!cfg.enabled) {
      throw new ForbiddenAppException('privileged-access.featureDisabled');
    }

    const targetUserId = dto.userId ?? actor?.id;
    if (!targetUserId || targetUserId <= 0) {
      throw new NotFoundAppException('privileged-access.userNotFound');
    }

    const targetUser = await this.usersService.findAuthUserById(targetUserId);
    if (!targetUser) {
      throw new NotFoundAppException('privileged-access.userNotFound');
    }

    const targetCode = dto.targetCode.trim();
    const policy = await this.targetsService.findTargetByTypeAndCode(dto.targetType, targetCode);
    if (!policy || !policy.isEnabled) {
      throw new NotFoundAppException('privileged-access.targetNotFound');
    }

    const maxAllowedMinutes = Math.min(Number(policy.maxGrantMinutes), cfg.maxGrantDurationMinutes);
    if (dto.durationMinutes > maxAllowedMinutes) {
      throw new BadRequestAppException('privileged-access.grantDurationExceedsLimit', [], {
        requestedMinutes: dto.durationMinutes,
        maxMinutes: maxAllowedMinutes,
      });
    }

    let roleId: number | null = null;
    if (dto.targetType === PRIVILEGED_TARGET_TYPE.ROLE) {
      const roles = await this.rolesService.findByCodes([targetCode]);
      const role = roles[0];
      if (!role) {
        throw new NotFoundAppException('privileged-access.roleNotFound', { code: targetCode });
      }
      roleId = Number(role.id);
    }

    const requiresApproval =
      policy.requireApproval || (cfg.requireApprovalDefault && !policy.autoApproveAllowed);
    const now = new Date();
    const grantCode = `JIT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const entity = this.grantRepository.create({
      grantCode,
      userId: targetUserId,
      targetType: dto.targetType,
      targetCode,
      roleId,
      reason: dto.reason.trim(),
      ticketRef: dto.ticketRef?.trim() ?? null,
      durationMinutes: dto.durationMinutes,
      status: requiresApproval
        ? PRIVILEGED_GRANT_STATUS.PENDING_APPROVAL
        : PRIVILEGED_GRANT_STATUS.ACTIVE,
      requiresApproval,
      requestedBy: actor?.id ?? targetUserId,
      requestedAt: now,
      approvedBy: requiresApproval ? null : (actor?.id ?? targetUserId),
      approvedAt: requiresApproval ? null : now,
      approvalComment: requiresApproval ? null : 'Auto-approved by policy',
      startsAt: requiresApproval ? null : now,
      expiresAt: requiresApproval ? null : new Date(now.getTime() + dto.durationMinutes * 60_000),
      stepUpVerified: Boolean(options?.stepUpVerified),
    });

    const saved = await this.grantRepository.saveEntity(entity);
    const userMap = await this.hydrateUsersMap([targetUserId]);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_grants',
          action: requiresApproval ? 'pam.grant.request' : 'pam.grant.auto_activate',
          resourceType: 'privileged_access_grants',
          resourceId: String(saved.id),
          actor: actor ?? null,
          afterData: {
            grantCode: saved.grantCode,
            userId: saved.userId,
            targetType: saved.targetType,
            targetCode: saved.targetCode,
            durationMinutes: saved.durationMinutes,
            status: getGrantStatusName(saved.status),
          },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: requiresApproval
          ? PRIVILEGED_ACCESS_DOMAIN_EVENTS.GRANT_REQUESTED
          : PRIVILEGED_ACCESS_DOMAIN_EVENTS.GRANT_APPROVED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedAccessGrant',
        aggregateId: String(saved.id),
        payload: {
          grantCode: saved.grantCode,
          userId: saved.userId,
          targetType: saved.targetType,
          targetCode: saved.targetCode,
          requiresApproval,
        },
      })
      .catch(() => undefined);

    await this.alertsService
      .recordAndDispatchAlert({
        eventType: requiresApproval
          ? PRIVILEGED_ALERT_EVENT_TYPE.GRANT_REQUESTED
          : PRIVILEGED_ALERT_EVENT_TYPE.GRANT_APPROVED,
        severity: 'HIGH',
        actorUserId: actor?.id ?? targetUserId,
        actorUsername: actor?.username ?? targetUser.username,
        targetType: saved.targetType,
        targetCode: saved.targetCode,
        action: requiresApproval ? 'grant.request' : 'grant.auto_activate',
        title: requiresApproval
          ? `[PAM] Yêu cầu cấp quyền đặc biệt tạm thời: ${saved.targetCode}`
          : `[PAM] Đã kích hoạt quyền đặc biệt tạm thời: ${saved.targetCode}`,
        content: `Người dùng ${targetUser.username} (#${targetUserId}) được yêu cầu cấp tạm ${saved.targetType}:${saved.targetCode} trong ${saved.durationMinutes} phút. Lý do: ${saved.reason}`,
        details: {
          grantId: saved.id,
          grantCode: saved.grantCode,
          targetUserId,
          durationMinutes: saved.durationMinutes,
          requiresApproval,
        },
        bypassCooldown: true,
      })
      .catch(() => undefined);

    return mapGrantEntityToView(saved, userMap.get(targetUserId));
  }

  /** Phê duyệt yêu cầu cấp quyền tạm thời (chặn tự duyệt maker === checker) */
  public async approveGrant(
    grantId: number,
    dto: GrantDecisionRequest,
    actor: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    const grant = await this.grantRepository.findById(grantId);
    if (!grant) {
      throw new NotFoundAppException('privileged-access.grantNotFound');
    }
    if (Number(grant.status) !== PRIVILEGED_GRANT_STATUS.PENDING_APPROVAL) {
      throw new BadRequestAppException('privileged-access.grantInvalidTransition', [
        { status: getGrantStatusName(grant.status) },
      ]);
    }
    if (
      Number(grant.requestedBy) === Number(actor.id) ||
      Number(grant.userId) === Number(actor.id)
    ) {
      throw new ForbiddenAppException('privileged-access.selfApprovalForbidden');
    }

    const now = new Date();
    grant.status = PRIVILEGED_GRANT_STATUS.ACTIVE;
    grant.approvedBy = Number(actor.id);
    grant.approvedAt = now;
    grant.approvalComment = dto.comment?.trim() ?? null;
    grant.startsAt = now;
    grant.expiresAt = new Date(now.getTime() + Number(grant.durationMinutes) * 60_000);

    const saved = await this.grantRepository.saveEntity(grant);
    const userMap = await this.hydrateUsersMap([saved.userId]);
    const targetUser = userMap.get(Number(saved.userId));

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_grants',
          action: 'pam.grant.approve',
          resourceType: 'privileged_access_grants',
          resourceId: String(saved.id),
          actor,
          afterData: {
            grantCode: saved.grantCode,
            userId: saved.userId,
            targetCode: saved.targetCode,
            expiresAt: saved.expiresAt?.toISOString() ?? null,
          },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.GRANT_APPROVED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedAccessGrant',
        aggregateId: String(saved.id),
        payload: {
          grantCode: saved.grantCode,
          userId: saved.userId,
          approvedBy: actor.id,
          expiresAt: saved.expiresAt?.toISOString() ?? null,
        },
      })
      .catch(() => undefined);

    await this.alertsService
      .recordAndDispatchAlert({
        eventType: PRIVILEGED_ALERT_EVENT_TYPE.GRANT_APPROVED,
        severity: 'HIGH',
        actorUserId: actor.id,
        actorUsername: actor.username ?? null,
        targetType: saved.targetType,
        targetCode: saved.targetCode,
        action: 'grant.approve',
        title: `[PAM] Đã phê duyệt cấp quyền tạm thời ${saved.targetCode}`,
        content: `Quản trị viên ${actor.username ?? actor.id} đã duyệt cấp ${saved.targetType}:${saved.targetCode} cho ${targetUser?.username ?? `#${saved.userId}`} đến ${saved.expiresAt?.toISOString() ?? ''}.`,
        details: {
          grantId: saved.id,
          grantCode: saved.grantCode,
          targetUserId: saved.userId,
          expiresAt: saved.expiresAt?.toISOString() ?? null,
        },
        bypassCooldown: true,
      })
      .catch(() => undefined);

    return mapGrantEntityToView(saved, targetUser);
  }

  public async rejectGrant(
    grantId: number,
    dto: GrantDecisionRequest,
    actor: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    const grant = await this.grantRepository.findById(grantId);
    if (!grant) {
      throw new NotFoundAppException('privileged-access.grantNotFound');
    }
    if (Number(grant.status) !== PRIVILEGED_GRANT_STATUS.PENDING_APPROVAL) {
      throw new BadRequestAppException('privileged-access.grantInvalidTransition', [
        { status: getGrantStatusName(grant.status) },
      ]);
    }
    if (
      Number(grant.requestedBy) === Number(actor.id) ||
      Number(grant.userId) === Number(actor.id)
    ) {
      throw new ForbiddenAppException('privileged-access.selfApprovalForbidden');
    }

    grant.status = PRIVILEGED_GRANT_STATUS.REJECTED;
    grant.approvedBy = Number(actor.id);
    grant.approvedAt = new Date();
    grant.approvalComment = dto.comment?.trim() ?? 'Rejected';

    const saved = await this.grantRepository.saveEntity(grant);
    const userMap = await this.hydrateUsersMap([saved.userId]);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_grants',
          action: 'pam.grant.reject',
          resourceType: 'privileged_access_grants',
          resourceId: String(saved.id),
          actor,
          afterData: { grantCode: saved.grantCode, comment: saved.approvalComment },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.GRANT_REJECTED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedAccessGrant',
        aggregateId: String(saved.id),
        payload: { grantCode: saved.grantCode, rejectedBy: actor.id },
      })
      .catch(() => undefined);

    return mapGrantEntityToView(saved, userMap.get(Number(saved.userId)));
  }

  public async revokeGrant(
    grantId: number,
    dto: GrantDecisionRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    const grant = await this.grantRepository.findById(grantId);
    if (!grant) {
      throw new NotFoundAppException('privileged-access.grantNotFound');
    }
    if (Number(grant.status) !== PRIVILEGED_GRANT_STATUS.ACTIVE) {
      throw new BadRequestAppException('privileged-access.grantInvalidTransition', [], {
        status: getGrantStatusName(grant.status),
      });
    }

    grant.status = PRIVILEGED_GRANT_STATUS.REVOKED;
    grant.revokedBy = actor?.id ?? null;
    grant.revokedAt = new Date();
    grant.revokeReason = dto.comment?.trim() || 'Manually revoked';
    grant.autoRevoked = false;

    const saved = await this.grantRepository.saveEntity(grant);
    const userMap = await this.hydrateUsersMap([saved.userId]);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_grants',
          action: 'pam.grant.revoke',
          resourceType: 'privileged_access_grants',
          resourceId: String(saved.id),
          actor: actor ?? null,
          afterData: {
            grantCode: saved.grantCode,
            userId: saved.userId,
            revokeReason: saved.revokeReason,
          },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.GRANT_REVOKED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedAccessGrant',
        aggregateId: String(saved.id),
        payload: { grantCode: saved.grantCode, userId: saved.userId, revokedBy: actor?.id ?? null },
      })
      .catch(() => undefined);

    return mapGrantEntityToView(saved, userMap.get(Number(saved.userId)));
  }

  public async cancelGrant(grantId: number, actor: UserIdentity): Promise<PrivilegedGrantView> {
    const grant = await this.grantRepository.findById(grantId);
    if (!grant) {
      throw new NotFoundAppException('privileged-access.grantNotFound');
    }
    if (Number(grant.status) !== PRIVILEGED_GRANT_STATUS.PENDING_APPROVAL) {
      throw new BadRequestAppException('privileged-access.grantInvalidTransition', [], {
        status: getGrantStatusName(grant.status),
      });
    }
    const isAdmin =
      actor.permissions.includes('*') ||
      actor.permissions.includes('privileged-access.manage') ||
      actor.permissions.includes('privileged-access.approve');
    if (
      Number(grant.requestedBy) !== Number(actor.id) &&
      Number(grant.userId) !== Number(actor.id) &&
      !isAdmin
    ) {
      throw new ForbiddenAppException('privileged-access.grantCancelForbidden');
    }

    grant.status = PRIVILEGED_GRANT_STATUS.CANCELLED;
    grant.revokedBy = Number(actor.id);
    grant.revokedAt = new Date();
    grant.revokeReason = 'Cancelled by requester';

    const saved = await this.grantRepository.saveEntity(grant);
    const userMap = await this.hydrateUsersMap([saved.userId]);
    return mapGrantEntityToView(saved, userMap.get(Number(saved.userId)));
  }

  public async listGrants(
    query: ListPrivilegedGrantsQuery,
  ): Promise<PaginatedResult<PrivilegedGrantView>> {
    const statusCode = query.status !== undefined ? parseGrantStatusCode(query.status) : undefined;
    const res = await this.grantRepository.paginateFiltered({
      userId: query.userId,
      status: statusCode,
      targetType: query.targetType,
      targetCode: query.targetCode,
      page: query.page,
      limit: query.limit,
    });
    const userMap = await this.hydrateUsersMap(res.data.map((g) => g.userId));
    return createPaginatedResult(
      res.data.map((g) => mapGrantEntityToView(g, userMap.get(Number(g.userId)))),
      res.meta.total,
      res.meta.page,
      res.meta.limit,
    );
  }

  /** Hợp nhất các quyền/vai trò tạm thời còn hiệu lực vào UserIdentity (mất hiệu lực tức thời khi hết hạn) */
  public async resolveActiveGrantsForUser(userId: number): Promise<{
    readonly roleIds: readonly number[];
    readonly roleCodes: readonly string[];
    readonly permissions: readonly string[];
    readonly grantIds: readonly number[];
  }> {
    const active = await this.grantRepository.findActiveForUser(userId, new Date());
    const roleIds: number[] = [];
    const roleCodes: string[] = [];
    const permissions: string[] = [];
    const grantIds: number[] = [];

    for (const grant of active) {
      grantIds.push(Number(grant.id));
      if (grant.targetType === PRIVILEGED_TARGET_TYPE.ROLE) {
        if (grant.roleId) roleIds.push(Number(grant.roleId));
        roleCodes.push(grant.targetCode);
      } else {
        permissions.push(grant.targetCode);
      }
    }

    return {
      roleIds: [...new Set(roleIds)],
      roleCodes: [...new Set(roleCodes)],
      permissions: [...new Set(permissions)],
      grantIds,
    };
  }

  /** Tự động thu hồi toàn bộ grant tạm thời đã hết hạn (không phụ thuộc thao tác thủ công) */
  public async sweepExpiredGrants(
    now: Date = new Date(),
  ): Promise<{ readonly expiredCount: number; readonly expiredGrantIds: readonly number[] }> {
    const expired = await this.grantRepository.findExpiredActive(now);
    if (expired.length === 0) {
      return { expiredCount: 0, expiredGrantIds: [] };
    }

    const cfg = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );
    const expiredIds: number[] = [];

    for (const grant of expired) {
      grant.status = PRIVILEGED_GRANT_STATUS.EXPIRED;
      grant.autoRevoked = true;
      grant.revokedAt = now;
      grant.revokeReason = 'Auto-revoked upon expiration';
      await this.grantRepository.saveEntity(grant);
      expiredIds.push(Number(grant.id));

      if (cfg.revokeSessionsOnGrantExpiry && this.sessionsService) {
        await this.sessionsService
          .revokeAllUserSessions(Number(grant.userId), 'Temporary privileged grant expired')
          .catch(() => undefined);
      }

      if (this.auditLogService) {
        await this.auditLogService
          .record({
            module: 'privileged-access',
            feature: 'pam_grants',
            action: 'pam.grant.auto_expire',
            resourceType: 'privileged_access_grants',
            resourceId: String(grant.id),
            actorUserId: null,
            afterData: {
              grantCode: grant.grantCode,
              userId: grant.userId,
              targetCode: grant.targetCode,
              autoRevoked: true,
            },
          })
          .catch(() => undefined);
      }

      await this.domainEventBus
        .publish({
          type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.GRANT_EXPIRED,
          sourceModule: 'privileged-access',
          aggregateType: 'PrivilegedAccessGrant',
          aggregateId: String(grant.id),
          payload: {
            grantCode: grant.grantCode,
            userId: grant.userId,
            targetType: grant.targetType,
            targetCode: grant.targetCode,
          },
        })
        .catch(() => undefined);

      await this.alertsService
        .recordAndDispatchAlert({
          eventType: PRIVILEGED_ALERT_EVENT_TYPE.GRANT_EXPIRED,
          severity: 'MEDIUM',
          actorUserId: Number(grant.userId),
          targetType: grant.targetType,
          targetCode: grant.targetCode,
          action: 'grant.auto_expire',
          title: `[PAM] Quyền tạm thời ${grant.targetCode} đã tự động thu hồi`,
          content: `Cấp quyền ${grant.grantCode} cho user #${grant.userId} đã hết hạn và tự động thu hồi lúc ${now.toISOString()}.`,
          details: { grantId: grant.id, grantCode: grant.grantCode, userId: grant.userId },
          bypassCooldown: true,
        })
        .catch(() => undefined);
    }

    return {
      expiredCount: expiredIds.length,
      expiredGrantIds: expiredIds,
    };
  }
}
