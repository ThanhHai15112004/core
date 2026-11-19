import { describe, expect, it, jest } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import { ForbiddenAppException } from '@packages/kernel/index.js';
import { PasswordHasherService, TokenService } from '@packages/security/index.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { AuthService } from '../../../src/modules/auth/services/auth.service.js';
import type { AuthPasswordResetRepository } from '../../../src/modules/credentials/repositories/auth-password-reset.repository.js';
import type { UserCredentialRepository } from '../../../src/modules/credentials/repositories/user-credential.repository.js';
import { PasswordService } from '../../../src/modules/credentials/services/password.service.js';
import type { MfaService } from '../../../src/modules/mfa/index.js';
import type { SessionService } from '../../../src/modules/sessions/index.js';
import {
  type IUsersPublicService,
  USER_STATUS,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
} from '../../../src/modules/users/contracts/index.js';

describe('AuthService.completeExternalLogin & PasswordService.hasPassword', () => {
  it('PasswordService.hasPassword checks UserCredentialRepository and falls back to UsersPublicService', async () => {
    const passwordHasher = new PasswordHasherService();
    const credRepo = {
      findByUserId: jest.fn(async (uid: number) =>
        uid === 1
          ? { userId: 1, passwordHash: 'scrypt$salt$hash', passwordChangedAt: new Date() }
          : null,
      ),
      findByUserIds: jest.fn(async () => []),
      upsertPasswordHash: jest.fn(async () => undefined),
    } as unknown as UserCredentialRepository;

    const usersPublicService = {
      findAuthCredentialsByUserId: jest.fn(async (uid: number) =>
        uid === 2 ? ({ id: 2, passwordHash: '' } as unknown as UserAuthCredentialsView) : null,
      ),
      findAuthUserById: jest.fn(async () => null),
    } as unknown as IUsersPublicService;

    const passwordService = new PasswordService(
      {} as AuthPasswordResetRepository,
      passwordHasher,
      {} as SessionService,
      usersPublicService,
      undefined,
      undefined,
      undefined,
      undefined,
      credRepo,
    );

    expect(await passwordService.hasPassword(1)).toBe(true);
    expect(await passwordService.hasPassword(2)).toBe(false);
    expect(await passwordService.hasPassword(0)).toBe(false);
  });

  it('AuthService.completeExternalLogin issues session for active user, enforces MFA challenge, and rejects locked accounts', async () => {
    applyTestEnv();
    const passwordHasher = new PasswordHasherService();
    const tokenService = new TokenService(new CoreConfigService());

    const activeUser: UserAuthCredentialsView = {
      id: 10,
      username: 'oauth_user',
      email: 'oauth_user@gmail.com',
      phone: null,
      firstName: 'OAuth',
      lastName: 'User',
      fullName: 'User OAuth',
      passwordHash: '',
      status: USER_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      lockedUntil: null,
      lockReason: null,
      failedLoginAttempts: 0,
      mfaEnabled: false,
      archivedAt: null,
    };

    const mfaUser: UserAuthCredentialsView = {
      ...activeUser,
      id: 11,
      username: 'mfa_user',
      email: 'mfa_user@gmail.com',
      mfaEnabled: true,
    };

    const lockedUser: UserAuthCredentialsView = {
      ...activeUser,
      id: 12,
      status: USER_STATUS.LOCKED,
      statusName: 'LOCKED',
      lockReason: 'Suspended by security',
      lockedUntil: new Date(Date.now() + 3_600_000),
    };

    const toIdentity = (c: UserAuthCredentialsView): UserAuthIdentityView => ({
      id: c.id,
      username: c.username,
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      fullName: c.fullName,
      phone: null,
      status: c.status,
      statusName: c.statusName,
      lockedUntil: c.lockedUntil,
      mfaEnabled: c.mfaEnabled,
      primaryOrganizationUnitId: null,
      organizationUnitIds: [],
      roles: ['user'],
      permissions: [],
    });

    const usersPublicService = {
      findAuthCredentialsByUserId: jest.fn(async (uid: number) => {
        if (uid === 10) return activeUser;
        if (uid === 11) return mfaUser;
        if (uid === 12) return lockedUser;
        return null;
      }),
      findAuthUserById: jest.fn(async (uid: number) => {
        if (uid === 10) return toIdentity(activeUser);
        if (uid === 11) return toIdentity(mfaUser);
        return null;
      }),
      recordLoginSuccess: jest.fn(async () => undefined),
      autoUnlockExpiredLock: jest.fn(async () => undefined),
    } as unknown as IUsersPublicService;

    const sessionService = {
      setSecuritySettingsService: jest.fn(),
      recordAuthEvent: jest.fn(async () => ({})),
      createSession: jest.fn(async (identity: UserAuthIdentityView) => ({
        sessionId: 901,
        accessToken: `jwt-${identity.id}`,
        refreshToken: `ref-${identity.id}`,
        expiresInSeconds: 900,
      })),
    } as unknown as SessionService;

    const mfaService = {
      registerSecurityEventDelegate: jest.fn(),
      getAvailableMethodsForUser: jest.fn(async () => ['TOTP'] as const),
      verifyTrustedDevice: jest.fn(async () => false),
      maskEmail: (email: string) => email,
    } as unknown as MfaService;

    const authService = new AuthService(
      passwordHasher,
      tokenService,
      sessionService,
      mfaService,
      usersPublicService,
    );

    // 1. Active user gets session tokens & OAUTH_LOGIN_SUCCESS event
    const loginRes = await authService.completeExternalLogin({
      userId: 10,
      providerCode: 'google',
      issuer: 'https://accounts.google.com',
      identityId: 50,
    });
    expect(loginRes.mfaRequired).toBe(false);
    expect(loginRes.accessToken).toBe('jwt-10');
    expect(sessionService.recordAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 10, eventType: 16 }),
    );

    // 2. MFA-enabled user receives MFA step-2 challenge
    const mfaRes = await authService.completeExternalLogin({
      userId: 11,
      providerCode: 'google',
      issuer: 'https://accounts.google.com',
      identityId: 51,
    });
    expect(mfaRes.mfaRequired).toBe(true);
    expect(mfaRes.mfaChallengeToken).toBeTruthy();

    // 3. Locked user is rejected with ForbiddenAppException
    await expect(
      authService.completeExternalLogin({
        userId: 12,
        providerCode: 'google',
        issuer: 'https://accounts.google.com',
      }),
    ).rejects.toThrow(ForbiddenAppException);
  });
});
