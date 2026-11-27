import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
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
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  AuditLogService,
  type IPrivilegedLoginPolicyHook,
  type PrivilegedBreakGlassLoginCheckResult,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  type IRolesPublicService,
  ROLES_PUBLIC_SERVICE,
} from '@modules/roles/contracts/index.js';
import {
  SESSIONS_PUBLIC_SERVICE,
  type ISessionsPublicService,
} from '@modules/sessions/contracts/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
} from '@modules/users/contracts/index.js';
import {
  BREAK_GLASS_STATUS,
  PRIVILEGED_ALERT_EVENT_TYPE,
} from '../enum/privileged-access.enum.js';
import { resolvePrivilegedAccessRuntimeConfig } from '../helpers/privileged-config.helper.js';
import {
  type BasicUserSummaryLike,
  mapBreakGlassEntityToView,
} from '../helpers/privileged-mapper.helper.js';
import type { PrivilegedBreakGlassAccountEntity } from '../entities/privileged-break-glass-account.entity.js';
import { PrivilegedBreakGlassAccountRepository } from '../repositories/privileged-break-glass-account.repository.js';
import type {
  ActivateBreakGlassRequest,
  CreateBreakGlassAccountRequest,
  ListBreakGlassAccountsQuery,
  SealBreakGlassRequest,
} from '../requests/privileged-access.requests.js';
import type { BreakGlassAccountView } from '../types/privileged-access.types.js';
import { PrivilegedAlertsService } from './privileged-alerts.service.js';

@Injectable()
export class PrivilegedBreakGlassService implements IPrivilegedLoginPolicyHook {
  constructor(
    private readonly breakGlassRepository: PrivilegedBreakGlassAccountRepository,
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

  private async ensureUserHasRole(userId: number, roleCode: string, actorId?: number): Promise<void> {
    const roles = await this.rolesService.findByCodes([roleCode]);
    const targetRole = roles[0];
    if (!targetRole) {
      throw new NotFoundAppException('privileged-access.roleNotFound', { code: roleCode });
    }
    if (
      !this.rolesService.findUserRoleLinksByUserIds ||
      !this.rolesService.replaceUserRoles
    ) {
      return;
    }
    const existingLinks = await this.rolesService.findUserRoleLinksByUserIds([userId]);
    const currentIds = existingLinks.map((l) => Number(l.roleId));
    if (!currentIds.includes(Number(targetRole.id))) {
      await this.rolesService.replaceUserRoles(
        userId,
        [...currentIds, Number(targetRole.id)],
        actorId ?? null,
      );
    }
  }

  /**
   * Đăng ký tài khoản khẩn cấp Break-glass:
   * - Hỗ trợ `LINK_EXISTING`: liên kết trực tiếp user admin đặc biệt đã có sẵn trong bảng `users`
   * - Hỗ trợ `CREATE_NEW`: tạo mới tài khoản chuyên dụng và niêm phong ngay
   */
  public async createBreakGlassAccount(
    dto: CreateBreakGlassAccountRequest,
    actor?: UserIdentity,
  ): Promise<BreakGlassAccountView> {
    const cfg = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );
    if (!cfg.enabled || !cfg.breakGlassEnabled) {
      throw new ForbiddenAppException('privileged-access.breakGlassFeatureDisabled');
    }

    const normalizedCode = dto.code.trim().toLowerCase();
    const existingByCode = await this.breakGlassRepository.findByCode(normalizedCode);
    if (existingByCode) {
      throw new ConflictAppException('privileged-access.breakGlassAlreadyExists');
    }

    const roleCode = dto.roleCode.trim();
    const roles = await this.rolesService.findByCodes([roleCode]);
    if (roles.length === 0) {
      throw new NotFoundAppException('privileged-access.roleNotFound', { code: roleCode });
    }

    const isCreateNew =
      dto.mode === 'CREATE_NEW' ||
      (!dto.existingUserId && !dto.existingIdentifier && Boolean(dto.username || dto.email));

    let targetUserId: number;
    let targetUsername: string;

    if (isCreateNew) {
      if (!this.usersService.createProvisionedUser) {
        throw new BadRequestAppException('privileged-access.userNotFound');
      }
      const created = await this.usersService.createProvisionedUser(
        {
          username: dto.username!.trim(),
          email: dto.email!.trim().toLowerCase(),
          password: dto.password!,
          firstName: dto.firstName?.trim() || 'Break',
          lastName: dto.lastName?.trim() || 'Glass',
          fullName: `${dto.firstName?.trim() || 'Break'} ${dto.lastName?.trim() || 'Glass'}`.trim(),
        },
        actor?.id,
      );
      targetUserId = Number(created.id);
      targetUsername = created.username;
    } else {
      let existingUser = null;
      if (dto.existingUserId && this.usersService.getProvisionedUserById) {
        existingUser = await this.usersService.getProvisionedUserById(dto.existingUserId);
      } else if (dto.existingIdentifier && this.usersService.findProvisionedUserByIdentifier) {
        existingUser = await this.usersService.findProvisionedUserByIdentifier(
          dto.existingIdentifier.trim(),
        );
      }
      if (!existingUser) {
        throw new NotFoundAppException('privileged-access.userNotFound');
      }
      targetUserId = Number(existingUser.id);
      targetUsername = existingUser.username;
    }

    const existingByUser = await this.breakGlassRepository.findByUserId(targetUserId);
    if (existingByUser) {
      throw new ConflictAppException('privileged-access.breakGlassAlreadyLinked');
    }

    const sealImmediately = dto.sealImmediately !== false;
    if (sealImmediately && actor && Number(actor.id) === targetUserId) {
      throw new ForbiddenAppException('privileged-access.breakGlassCannotSealSelf');
    }

    await this.ensureUserHasRole(targetUserId, roleCode, actor?.id);

    const now = new Date();
    const maxActMinutes = Math.min(dto.maxActivationMinutes, cfg.breakGlassMaxMinutes);
    let initialStatus: typeof BREAK_GLASS_STATUS.SEALED | typeof BREAK_GLASS_STATUS.ACTIVE =
      BREAK_GLASS_STATUS.SEALED;
    let activatedAt: Date | null = null;
    let expiresAt: Date | null = null;
    let sealedAt: Date | null = now;
    let sealedBy: number | null = actor?.id ?? null;
    let sealReason: string | null = 'Initial sealed state';

    if (sealImmediately) {
      await this.usersService.lockProvisionedUser?.(
        targetUserId,
        `Break-glass sealed (${normalizedCode})`,
        actor?.id,
      );
      await this.sessionsService
        ?.revokeAllUserSessions(targetUserId, `Break-glass sealed (${normalizedCode})`)
        .catch(() => undefined);
    } else {
      const requestedDuration = Math.min(dto.durationMinutes ?? maxActMinutes, maxActMinutes);
      initialStatus = BREAK_GLASS_STATUS.ACTIVE;
      activatedAt = now;
      expiresAt = new Date(now.getTime() + requestedDuration * 60_000);
      sealedAt = null;
      sealedBy = null;
      sealReason = null;
    }

    const entity = this.breakGlassRepository.create({
      code: normalizedCode,
      userId: targetUserId,
      label: dto.label.trim(),
      description: dto.description?.trim() ?? null,
      roleCode,
      status: initialStatus,
      requireMfa: dto.requireMfa,
      maxActivationMinutes: maxActMinutes,
      alertRecipientsJson: JSON.stringify(dto.alertRecipients ?? []),
      lastActivatedBy: initialStatus === BREAK_GLASS_STATUS.ACTIVE ? (actor?.id ?? null) : null,
      lastActivationReason:
        initialStatus === BREAK_GLASS_STATUS.ACTIVE
          ? dto.activationReason?.trim() || 'Linked in active emergency window'
          : null,
      activatedAt,
      expiresAt,
      sealedBy,
      sealedAt,
      sealReason,
      activationCount: initialStatus === BREAK_GLASS_STATUS.ACTIVE ? 1 : 0,
      createdBy: actor?.id ?? null,
      updatedBy: actor?.id ?? null,
    });

    const saved = await this.breakGlassRepository.saveEntity(entity);
    const userMap = await this.hydrateUsersMap([targetUserId]);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_break_glass',
          action: 'pam.break_glass.create',
          resourceType: 'privileged_break_glass_accounts',
          resourceId: String(saved.id),
          actor: actor ?? null,
          afterData: {
            code: saved.code,
            userId: saved.userId,
            mode: isCreateNew ? 'CREATE_NEW' : 'LINK_EXISTING',
            status: saved.status,
            roleCode: saved.roleCode,
          },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.BREAK_GLASS_CREATED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedBreakGlassAccount',
        aggregateId: String(saved.id),
        payload: { code: saved.code, userId: saved.userId, status: saved.status },
      })
      .catch(() => undefined);

    await this.alertsService
      .recordAndDispatchAlert({
        eventType: PRIVILEGED_ALERT_EVENT_TYPE.BREAK_GLASS_CREATED,
        severity: 'HIGH',
        actorUserId: actor?.id ?? null,
        actorUsername: actor?.username ?? null,
        targetType: 'ROLE',
        targetCode: saved.roleCode,
        action: 'break_glass.create',
        title: `[PAM] Đăng ký tài khoản khẩn cấp Break-glass: ${saved.code}`,
        content: `Tài khoản Break-glass ${saved.code} (liên kết user ${targetUsername} #${targetUserId}, role ${saved.roleCode}) đã được tạo với trạng thái ${sealImmediately ? 'NIÊM PHONG (SEALED)' : 'ACTIVE'}.`,
        extraRecipients: dto.alertRecipients,
        details: { breakGlassId: saved.id, code: saved.code, userId: saved.userId },
        bypassCooldown: true,
      })
      .catch(() => undefined);

    return mapBreakGlassEntityToView(saved, userMap.get(targetUserId));
  }

  /** Kích hoạt khẩn cấp tài khoản Break-glass trong một cửa sổ thời gian giới hạn */
  public async activateBreakGlass(
    id: number,
    dto: ActivateBreakGlassRequest,
    actor?: UserIdentity,
  ): Promise<BreakGlassAccountView> {
    const cfg = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );
    if (!cfg.enabled || !cfg.breakGlassEnabled) {
      throw new ForbiddenAppException('privileged-access.breakGlassFeatureDisabled');
    }

    const account = await this.breakGlassRepository.findById(id);
    if (!account) {
      throw new NotFoundAppException('privileged-access.breakGlassNotFound');
    }
    if (Number(account.status) === BREAK_GLASS_STATUS.REVOKED) {
      throw new BadRequestAppException('privileged-access.breakGlassInvalidState');
    }

    const maxAllowed = Math.min(Number(account.maxActivationMinutes), cfg.breakGlassMaxMinutes);
    if (dto.durationMinutes > maxAllowed) {
      throw new BadRequestAppException(
        'privileged-access.breakGlassDurationExceedsLimit',
        [],
        { requestedMinutes: dto.durationMinutes, maxMinutes: maxAllowed },
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + dto.durationMinutes * 60_000);

    await this.usersService.unlockProvisionedUser?.(Number(account.userId), actor?.id);

    account.status = BREAK_GLASS_STATUS.ACTIVE;
    account.lastActivatedBy = actor?.id ?? null;
    account.lastActivationReason = dto.reason.trim();
    account.lastTicketRef = dto.ticketRef?.trim() ?? null;
    account.activatedAt = now;
    account.expiresAt = expiresAt;
    account.activationCount = Number(account.activationCount ?? 0) + 1;
    account.updatedBy = actor?.id ?? null;

    const saved = await this.breakGlassRepository.saveEntity(account);
    const userMap = await this.hydrateUsersMap([saved.userId]);
    const recipients = safeJsonParseStringArray(saved.alertRecipientsJson);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_break_glass',
          action: 'pam.break_glass.activate',
          resourceType: 'privileged_break_glass_accounts',
          resourceId: String(saved.id),
          actor: actor ?? null,
          afterData: {
            code: saved.code,
            userId: saved.userId,
            reason: saved.lastActivationReason,
            expiresAt: expiresAt.toISOString(),
          },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.BREAK_GLASS_ACTIVATED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedBreakGlassAccount',
        aggregateId: String(saved.id),
        payload: {
          code: saved.code,
          userId: saved.userId,
          activatedBy: actor?.id ?? null,
          expiresAt: expiresAt.toISOString(),
        },
      })
      .catch(() => undefined);

    await this.alertsService
      .recordAndDispatchAlert({
        eventType: PRIVILEGED_ALERT_EVENT_TYPE.BREAK_GLASS_ACTIVATED,
        severity: 'CRITICAL',
        actorUserId: actor?.id ?? null,
        actorUsername: actor?.username ?? null,
        targetType: 'ROLE',
        targetCode: saved.roleCode,
        action: 'break_glass.activate',
        title: `[CRITICAL][PAM] Kích hoạt khẩn cấp Break-glass ${saved.code}`,
        content: `Tài khoản Break-glass ${saved.code} (user #${saved.userId}) vừa được mở khóa khẩn cấp trong ${dto.durationMinutes} phút (hết hạn ${expiresAt.toISOString()}). Lý do: ${dto.reason}`,
        extraRecipients: recipients,
        details: {
          breakGlassId: saved.id,
          code: saved.code,
          userId: saved.userId,
          durationMinutes: dto.durationMinutes,
          ticketRef: dto.ticketRef ?? null,
        },
        bypassCooldown: true,
        createIncidentIfCritical: true,
      })
      .catch(() => undefined);

    return mapBreakGlassEntityToView(saved, userMap.get(Number(saved.userId)));
  }

  /** Niêm phong tài khoản Break-glass (thủ công hoặc tự động hết hạn): khóa user + thu hồi mọi phiên */
  public async sealBreakGlass(
    id: number,
    dto: SealBreakGlassRequest,
    actor?: UserIdentity,
    options?: { readonly autoSealed?: boolean; readonly revokePermanently?: boolean },
  ): Promise<BreakGlassAccountView> {
    const account = await this.breakGlassRepository.findById(id);
    if (!account) {
      throw new NotFoundAppException('privileged-access.breakGlassNotFound');
    }

    if (actor && Number(actor.id) === Number(account.userId)) {
      throw new ForbiddenAppException('privileged-access.breakGlassCannotSealSelf');
    }

    const now = new Date();
    const reason =
      dto.reason?.trim() ||
      (options?.autoSealed ? 'Auto-sealed upon expiration' : 'Manually sealed');

    await this.usersService.lockProvisionedUser?.(
      Number(account.userId),
      `Break-glass sealed: ${reason}`,
      actor?.id,
    );
    await this.sessionsService
      ?.revokeAllUserSessions(Number(account.userId), `Break-glass sealed: ${reason}`)
      .catch(() => undefined);

    account.status = options?.revokePermanently
      ? BREAK_GLASS_STATUS.REVOKED
      : BREAK_GLASS_STATUS.SEALED;
    account.sealedBy = actor?.id ?? null;
    account.sealedAt = now;
    account.sealReason = reason;
    account.expiresAt = null;
    account.updatedBy = actor?.id ?? null;

    const saved = await this.breakGlassRepository.saveEntity(account);
    const userMap = await this.hydrateUsersMap([saved.userId]);
    const recipients = safeJsonParseStringArray(saved.alertRecipientsJson);

    const eventType = options?.autoSealed
      ? PRIVILEGED_ALERT_EVENT_TYPE.BREAK_GLASS_AUTO_SEALED
      : PRIVILEGED_ALERT_EVENT_TYPE.BREAK_GLASS_SEALED;

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_break_glass',
          action: options?.autoSealed ? 'pam.break_glass.auto_seal' : 'pam.break_glass.seal',
          resourceType: 'privileged_break_glass_accounts',
          resourceId: String(saved.id),
          actor: actor ?? null,
          afterData: {
            code: saved.code,
            userId: saved.userId,
            status: saved.status,
            sealReason: reason,
          },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: options?.autoSealed
          ? PRIVILEGED_ACCESS_DOMAIN_EVENTS.BREAK_GLASS_AUTO_SEALED
          : PRIVILEGED_ACCESS_DOMAIN_EVENTS.BREAK_GLASS_SEALED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedBreakGlassAccount',
        aggregateId: String(saved.id),
        payload: { code: saved.code, userId: saved.userId, sealReason: reason },
      })
      .catch(() => undefined);

    await this.alertsService
      .recordAndDispatchAlert({
        eventType,
        severity: 'HIGH',
        actorUserId: actor?.id ?? Number(saved.userId),
        actorUsername: actor?.username ?? null,
        targetType: 'ROLE',
        targetCode: saved.roleCode,
        action: options?.autoSealed ? 'break_glass.auto_seal' : 'break_glass.seal',
        title: `[PAM] Tài khoản Break-glass ${saved.code} đã được niêm phong lại`,
        content: `Tài khoản Break-glass ${saved.code} (user #${saved.userId}) đã khóa lại và thu hồi toàn bộ phiên. Lý do: ${reason}`,
        extraRecipients: recipients,
        details: { breakGlassId: saved.id, code: saved.code, autoSealed: Boolean(options?.autoSealed) },
        bypassCooldown: true,
      })
      .catch(() => undefined);

    return mapBreakGlassEntityToView(saved, userMap.get(Number(saved.userId)));
  }

  public async listBreakGlassAccounts(
    query: ListBreakGlassAccountsQuery,
  ): Promise<PaginatedResult<BreakGlassAccountView>> {
    const res = await this.breakGlassRepository.paginateFiltered({
      status: query.status as PrivilegedBreakGlassAccountEntity['status'] | undefined,
      page: query.page,
      limit: query.limit,
    });
    const userMap = await this.hydrateUsersMap(res.data.map((x) => x.userId));
    return createPaginatedResult(
      res.data.map((x) => mapBreakGlassEntityToView(x, userMap.get(Number(x.userId)))),
      res.meta.total,
      res.meta.page,
      res.meta.limit,
    );
  }

  public async sweepExpiredBreakGlassAccounts(
    now: Date = new Date(),
  ): Promise<{ readonly autoSealedCount: number; readonly autoSealedIds: readonly number[] }> {
    const expired = await this.breakGlassRepository.findExpiredActive(now);
    const sealedIds: number[] = [];
    for (const bg of expired) {
      await this.sealBreakGlass(
        Number(bg.id),
        { reason: 'Auto-sealed after emergency window expired' },
        undefined,
        { autoSealed: true },
      );
      sealedIds.push(Number(bg.id));
    }
    return { autoSealedCount: sealedIds.length, autoSealedIds: sealedIds };
  }

  public async isActiveBreakGlassUser(userId: number): Promise<boolean> {
    const bg = await this.breakGlassRepository.findByUserId(userId);
    if (!bg) return false;
    if (Number(bg.status) !== BREAK_GLASS_STATUS.ACTIVE) return false;
    if (bg.expiresAt && bg.expiresAt.getTime() <= Date.now()) return false;
    return true;
  }

  /** Hook AuthService: chặn đăng nhập nếu tài khoản Break-glass đang bị niêm phong hoặc hết hạn */
  public async assertCanLogin(
    userId: number,
  ): Promise<PrivilegedBreakGlassLoginCheckResult> {
    const bg = await this.breakGlassRepository.findByUserId(userId);
    if (!bg) {
      return { isBreakGlass: false, requireMfa: false, breakGlassId: null, code: null };
    }

    if (Number(bg.status) !== BREAK_GLASS_STATUS.ACTIVE) {
      throw new ForbiddenAppException('privileged-access.breakGlassSealedLoginDenied', [], {
        code: bg.code,
      });
    }

    if (bg.expiresAt && bg.expiresAt.getTime() <= Date.now()) {
      await this.sealBreakGlass(
        Number(bg.id),
        { reason: 'Auto-sealed on expired login attempt' },
        undefined,
        { autoSealed: true },
      );
      throw new ForbiddenAppException('privileged-access.breakGlassSealedLoginDenied', [], {
        code: bg.code,
      });
    }

    return {
      isBreakGlass: true,
      requireMfa: Boolean(bg.requireMfa),
      breakGlassId: Number(bg.id),
      code: bg.code,
    };
  }

  /** Hook AuthService: ghi nhận & bắn cảnh báo CRITICAL ngay khi tài khoản Break-glass đăng nhập thành công */
  public async onLoginSucceeded(
    userId: number,
    info: PrivilegedBreakGlassLoginCheckResult & {
      readonly ipAddress?: string | null;
      readonly userAgent?: string | null;
    },
  ): Promise<void> {
    if (!info.isBreakGlass || !info.breakGlassId) return;
    const bg = await this.breakGlassRepository.findById(info.breakGlassId);
    if (!bg) return;

    bg.lastUsedAt = new Date();
    bg.lastUsedIp = info.ipAddress ?? null;
    await this.breakGlassRepository.saveEntity(bg);

    const recipients = safeJsonParseStringArray(bg.alertRecipientsJson);
    await this.alertsService.recordAndDispatchAlert({
      eventType: PRIVILEGED_ALERT_EVENT_TYPE.BREAK_GLASS_LOGIN,
      severity: 'CRITICAL',
      actorUserId: userId,
      targetType: 'ROLE',
      targetCode: bg.roleCode,
      action: 'break_glass.login',
      ipAddress: info.ipAddress ?? null,
      title: `[CRITICAL][PAM] Tài khoản Break-glass ${bg.code} vừa đăng nhập`,
      content: `Tài khoản khẩn cấp ${bg.code} (user #${userId}) vừa đăng nhập thành công từ IP ${info.ipAddress ?? 'unknown'}.`,
      extraRecipients: recipients,
      details: {
        breakGlassId: bg.id,
        code: bg.code,
        userAgent: info.userAgent ?? null,
      },
      bypassCooldown: true,
      createIncidentIfCritical: true,
    });
  }
}
