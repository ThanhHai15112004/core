import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  IS_PUBLIC_KEY,
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ROLES_KEY,
} from '@packages/http/index.js';
import {
  FeatureFlagRegistryService,
  ForbiddenAppException,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import {
  AuthGuard,
  PrivilegedAccessHookRegistry,
  TokenService,
  type UserIdentity,
} from '@packages/security/index.js';
import { PRIVILEGED_TARGET_TYPE } from '../../../src/modules/privileged-access/enum/privileged-access.enum.js';
import type { PrivilegedAccessTargetEntity } from '../../../src/modules/privileged-access/entities/privileged-access-target.entity.js';
import { PrivilegedAlertsService } from '../../../src/modules/privileged-access/services/privileged-alerts.service.js';
import { PrivilegedPolicyEvaluatorService } from '../../../src/modules/privileged-access/services/privileged-policy-evaluator.service.js';
import type { PrivilegedTargetsService } from '../../../src/modules/privileged-access/services/privileged-targets.service.js';

describe('Privileged Access Policy & MFA Step-Up Unit Tests (14.4)', () => {
  let tokenService: TokenService;
  let hookRegistry: PrivilegedAccessHookRegistry;
  let settingRegistry: SettingRegistryService;
  let featureFlagRegistry: FeatureFlagRegistryService;
  let dispatchedNotifications: unknown[];
  let savedAlerts: Record<string, unknown>[];

  const sampleActor: UserIdentity = {
    id: 3,
    username: 'admin_security',
    email: 'admin.security@gmail.com',
    roles: ['admin_security'],
    permissions: ['privileged-access.read', 'privileged-access.manage'],
  };

  beforeEach(() => {
    const mockConfig = {
      auth: {
        jwt: {
          accessSecret: 'unit-test-access-secret-1234567890123456',
          refreshSecret: 'unit-test-refresh-secret-1234567890123456',
          accessExpiration: '15m',
          refreshExpiration: '7d',
        },
      },
    };
    tokenService = new TokenService(mockConfig as never);
    hookRegistry = new PrivilegedAccessHookRegistry();
    settingRegistry = new SettingRegistryService();
    featureFlagRegistry = new FeatureFlagRegistryService();
    featureFlagRegistry.setInstalledModules(['privileged-access', 'auth', 'roles', 'users']);
    dispatchedNotifications = [];
    savedAlerts = [];

    const mockTargetsService = {
      getEnabledTargetsCached: async (): Promise<PrivilegedAccessTargetEntity[]> => [
        {
          id: 1,
          targetType: PRIVILEGED_TARGET_TYPE.PERMISSION,
          targetCode: 'privileged-access.manage',
          displayName: 'PAM Manage',
          description: null,
          sensitivityLevel: 'CRITICAL',
          requireMfaStepUp: true,
          requireApproval: true,
          autoApproveAllowed: false,
          maxGrantMinutes: 120,
          alertOnUse: true,
          reviewIntervalDays: 60,
          isEnabled: true,
          createdBy: 1,
          updatedBy: 1,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as PrivilegedAccessTargetEntity,
      ],
    } as unknown as PrivilegedTargetsService;

    const mockAlertRepo = {
      create: (data: Record<string, unknown>) => ({ ...data }),
      saveEntity: async (entity: Record<string, unknown>) => {
        const saved = { id: savedAlerts.length + 1, ...entity, createdAt: new Date() };
        savedAlerts.push(saved);
        return saved;
      },
    };

    const mockNotifications = {
      dispatch: async (input: unknown) => {
        dispatchedNotifications.push(input);
        return { id: dispatchedNotifications.length };
      },
    };

    const alertsService = new PrivilegedAlertsService(
      mockAlertRepo as never,
      mockNotifications as never,
      undefined,
      undefined,
      settingRegistry,
      featureFlagRegistry,
    );

    const evaluator = new PrivilegedPolicyEvaluatorService(
      mockTargetsService,
      alertsService,
      tokenService,
      settingRegistry,
      featureFlagRegistry,
    );

    hookRegistry.registerGuardEvaluator(evaluator);
  });

  it('rejects password-only step-up tokens when requireMfa=true and accepts MFA methods', async () => {
    const pwdToken = await tokenService.signStepUpToken(
      { sub: 3, sid: 11, action: 'privileged-access.manage', method: 'PASSWORD' },
      300,
    );
    const totpToken = await tokenService.signStepUpToken(
      { sub: 3, sid: 11, action: 'privileged-access.manage', method: 'TOTP' },
      300,
    );

    expect(
      await tokenService.verifyStepUpActionToken(3, pwdToken, undefined, { requireMfa: false }),
    ).toBe(true);
    expect(
      await tokenService.verifyStepUpActionToken(3, pwdToken, undefined, { requireMfa: true }),
    ).toBe(false);
    expect(
      await tokenService.verifyStepUpActionToken(3, totpToken, undefined, { requireMfa: true }),
    ).toBe(true);
    expect(
      await tokenService.verifyStepUpActionToken(999, totpToken, undefined, { requireMfa: true }),
    ).toBe(false);
  });

  it('enforces MFA step-up inside AuthGuard and dispatches alert with cooldown dedup', async () => {
    const accessToken = await tokenService.signAccessToken({
      sub: sampleActor.id,
      username: sampleActor.username,
      email: sampleActor.email,
      roles: [...sampleActor.roles],
      permissions: [...sampleActor.permissions],
    });

    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === REQUIRED_PERMISSIONS_KEY) return ['privileged-access.manage'];
        if (key === REQUIRED_ROLES_KEY) return [];
        if (key === REQUIRED_ANY_PERMISSIONS_KEY) return false;
        return undefined;
      }),
    } as unknown as Reflector;

    const guard = new AuthGuard(reflector, tokenService, undefined, undefined, hookRegistry);

    const makeCtx = (stepUpHeader?: string): ExecutionContext =>
      ({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {
              authorization: `Bearer ${accessToken}`,
              ...(stepUpHeader ? { 'x-step-up-token': stepUpHeader } : {}),
            },
            query: {},
            method: 'POST',
            url: '/api/v1/privileged-access/targets',
          }),
          getResponse: () => ({ header: jest.fn() }),
        }),
      }) as unknown as ExecutionContext;

    // 1. Missing X-Step-Up-Token -> blocked
    await expect(guard.canActivate(makeCtx())).rejects.toThrow(ForbiddenAppException);

    // 2. Password-only stepUpToken -> blocked
    const pwdStepUp = await tokenService.signStepUpToken(
      { sub: sampleActor.id, method: 'PASSWORD' },
      300,
    );
    await expect(guard.canActivate(makeCtx(pwdStepUp))).rejects.toThrow(ForbiddenAppException);

    // 3. Valid MFA TOTP stepUpToken -> allowed + alert dispatched
    const mfaStepUp = await tokenService.signStepUpToken(
      { sub: sampleActor.id, method: 'TOTP' },
      300,
    );
    await expect(guard.canActivate(makeCtx(mfaStepUp))).resolves.toBe(true);

    // Wait briefly for fire-and-forget alert promise
    await new Promise((r) => setTimeout(r, 20));
    expect(
      savedAlerts.some((a) => a['eventType'] === 'PRIVILEGED_ACTION_USED'),
    ).toBe(true);
    const firstAlertCount = savedAlerts.length;

    // 4. Second immediate identical call is deduplicated by cooldown
    await expect(guard.canActivate(makeCtx(mfaStepUp))).resolves.toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(savedAlerts.length).toBe(firstAlertCount);
  });
});
