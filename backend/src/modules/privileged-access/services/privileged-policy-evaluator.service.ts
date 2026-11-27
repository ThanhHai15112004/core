import { Injectable, Optional } from '@nestjs/common';
import {
  FeatureFlagRegistryService,
  SettingRegistryService,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import {
  type IPrivilegedAccessRequestEvaluator,
  type PrivilegedAccessGuardDecision,
  type PrivilegedAccessGuardRequestContext,
  type PrivilegedMatchedTargetInfo,
  TokenService,
} from '@packages/security/index.js';
import {
  PRIVILEGED_ALERT_EVENT_TYPE,
  PRIVILEGED_TARGET_TYPE,
} from '../enum/privileged-access.enum.js';
import { resolvePrivilegedAccessRuntimeConfig } from '../helpers/privileged-config.helper.js';
import { PrivilegedAlertsService } from './privileged-alerts.service.js';
import { PrivilegedTargetsService } from './privileged-targets.service.js';

@Injectable()
export class PrivilegedPolicyEvaluatorService implements IPrivilegedAccessRequestEvaluator {
  constructor(
    private readonly targetsService: PrivilegedTargetsService,
    private readonly alertsService: PrivilegedAlertsService,
    @Optional() private readonly tokenService?: TokenService,
    @Optional()
    private readonly settingRegistry: SettingRegistryService = defaultSettingRegistry,
    @Optional()
    private readonly featureFlagRegistry: FeatureFlagRegistryService = defaultFeatureFlagRegistry,
  ) {}

  /** Đánh giá yêu cầu HTTP đối với quyền/vai trò đặc biệt: ép MFA Step-Up và ghi nhận cảnh báo */
  public async evaluateRequest(
    context: PrivilegedAccessGuardRequestContext,
  ): Promise<PrivilegedAccessGuardDecision> {
    const cfg = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );
    if (!cfg.enabled) {
      return { allowed: true };
    }

    const enabledTargets = await this.targetsService.getEnabledTargetsCached();
    if (enabledTargets.length === 0 && !context.user.isBreakGlass) {
      return { allowed: true };
    }

    const permTargetMap = new Map(
      enabledTargets
        .filter((t) => t.targetType === PRIVILEGED_TARGET_TYPE.PERMISSION)
        .map((t) => [t.targetCode, t]),
    );
    const roleTargetMap = new Map(
      enabledTargets
        .filter((t) => t.targetType === PRIVILEGED_TARGET_TYPE.ROLE)
        .map((t) => [t.targetCode, t]),
    );

    const matchedPermTargets = context.requiredPermissions
      .map((code) => permTargetMap.get(code))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    const matchedRoleTargets = context.requiredRoles
      .map((code) => roleTargetMap.get(code))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    const userPrivilegedRoles = context.user.roles
      .map((r) => roleTargetMap.get(r))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    const stepUpTargets = [...matchedPermTargets, ...matchedRoleTargets].filter(
      (t) => t.requireMfaStepUp,
    );

    if (cfg.enforceStepUpMfa && stepUpTargets.length > 0) {
      const token = context.stepUpToken?.trim() ?? '';
      if (!token) {
        void this.alertsService
          .recordAndDispatchAlert({
            eventType: PRIVILEGED_ALERT_EVENT_TYPE.STEP_UP_MFA_BLOCKED,
            severity: 'HIGH',
            actorUserId: context.user.id,
            actorUsername: context.user.username ?? null,
            targetType: stepUpTargets[0]?.targetType ?? null,
            targetCode: stepUpTargets[0]?.targetCode ?? null,
            action: `${context.method} ${context.url}`,
            endpoint: context.url,
            httpMethod: context.method,
            ipAddress: context.ipAddress,
            title: `[PAM] Chặn thao tác đặc biệt do thiếu MFA Step-Up`,
            content: `User ${context.user.username ?? `#${context.user.id}`} gọi ${context.method} ${context.url} thiếu X-Step-Up-Token MFA.`,
            details: { targetCodes: stepUpTargets.map((t) => t.targetCode) },
          })
          .catch(() => undefined);

        return {
          allowed: false,
          errorCode: 'privileged-access.stepUpMfaRequired',
          errorDetails: [{ requiredTargets: stepUpTargets.map((t) => t.targetCode) }],
        };
      }

      const validMfa = this.tokenService
        ? await this.tokenService.verifyStepUpActionToken(context.user.id, token, undefined, {
            requireMfa: true,
          })
        : false;

      if (!validMfa) {
        return {
          allowed: false,
          errorCode: 'privileged-access.stepUpMfaInvalidOrPasswordOnly',
          errorDetails: [{ requiredTargets: stepUpTargets.map((t) => t.targetCode) }],
        };
      }
    }

    const isUsingTemporaryElevation =
      Boolean(context.user.temporaryPermissions?.length) ||
      Boolean(context.user.temporaryRoleCodes?.length);

    const uniqueTargetsMap = new Map<string, PrivilegedMatchedTargetInfo>();
    for (const t of [...matchedPermTargets, ...matchedRoleTargets, ...userPrivilegedRoles]) {
      if (!t.alertOnUse) continue;
      uniqueTargetsMap.set(`${t.targetType}:${t.targetCode}`, {
        targetType: t.targetType,
        targetCode: t.targetCode,
        sensitivityLevel: t.sensitivityLevel,
        requireMfaStepUp: Boolean(t.requireMfaStepUp),
        alertOnUse: Boolean(t.alertOnUse),
      });
    }
    const matchedTargets = [...uniqueTargetsMap.values()];

    const isWriteOrPrivilegedRoute =
      matchedPermTargets.length > 0 ||
      matchedRoleTargets.length > 0 ||
      Boolean(context.user.isBreakGlass) ||
      isUsingTemporaryElevation;

    const shouldNotify =
      isWriteOrPrivilegedRoute &&
      (matchedPermTargets.some((t) => t.alertOnUse) ||
        matchedRoleTargets.some((t) => t.alertOnUse) ||
        Boolean(context.user.isBreakGlass) ||
        isUsingTemporaryElevation) &&
      !context.url.includes('/privileged-access/alerts') &&
      !context.url.includes('/privileged-access/overview') &&
      !context.url.includes('/privileged-access/directory');

    return {
      allowed: true,
      privilegedActionDetected: shouldNotify,
      matchedTargets,
    };
  }

  public async onPrivilegedAccessAllowed(
    context: PrivilegedAccessGuardRequestContext & {
      readonly matchedTargets: readonly PrivilegedMatchedTargetInfo[];
    },
  ): Promise<void> {
    const primaryTarget = context.matchedTargets[0];
    const primaryCode = primaryTarget?.targetCode ?? 'privileged_session';
    const isCritical =
      Boolean(context.user.isBreakGlass) ||
      context.matchedTargets.some((t) => t.sensitivityLevel === 'CRITICAL');

    await this.alertsService.recordAndDispatchAlert({
      eventType: PRIVILEGED_ALERT_EVENT_TYPE.PRIVILEGED_ACTION_USED,
      severity: isCritical ? 'CRITICAL' : 'HIGH',
      actorUserId: context.user.id,
      actorUsername: context.user.username ?? null,
      targetType:
        primaryTarget?.targetType ??
        (context.requiredPermissions.length > 0 ? 'PERMISSION' : 'ROLE'),
      targetCode: primaryCode,
      action: `${context.method} ${context.url}`,
      endpoint: context.url,
      httpMethod: context.method,
      ipAddress: context.ipAddress,
      title: context.user.isBreakGlass
        ? `[CRITICAL][PAM] Tài khoản Break-glass thực hiện thao tác: ${context.method} ${context.url}`
        : `[PAM] Sử dụng quyền quản trị đặc biệt: ${primaryCode}`,
      content: `User ${context.user.username ?? `#${context.user.id}`} đã thực hiện ${context.method} ${context.url} (targets: ${context.matchedTargets.map((t) => t.targetCode).join(', ') || 'break-glass'}).`,
      details: {
        matchedTargets: context.matchedTargets.map((t) => t.targetCode),
        isBreakGlass: Boolean(context.user.isBreakGlass),
        temporaryRoleCodes: context.user.temporaryRoleCodes ?? [],
        temporaryPermissions: context.user.temporaryPermissions ?? [],
      },
      createIncidentIfCritical: Boolean(context.user.isBreakGlass),
    });
  }
}
