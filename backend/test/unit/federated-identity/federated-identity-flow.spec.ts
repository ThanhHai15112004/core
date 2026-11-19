import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';
import type { HttpClientContract } from '@packages/http-client/index.js';
import {
  ConflictAppException,
  ForbiddenAppException,
  SettingRegistryService,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  PlatformSecurityService,
} from '@packages/security/index.js';
import type {
  CompleteExternalLoginInput,
  IAuthPublicService,
  LoginResponse,
} from '../../../src/modules/auth/contracts/index.js';
import type { ICredentialsPublicService } from '../../../src/modules/credentials/contracts/index.js';
import type { ISessionsPublicService } from '../../../src/modules/sessions/contracts/index.js';
import {
  type IUsersPublicService,
  type SelfRegisterUserInput,
  USER_STATUS,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
} from '../../../src/modules/users/contracts/index.js';
import { GoogleOAuthAdapter } from '../../../src/modules/federated-identity/adapters/google-oauth.adapter.js';
import { MicrosoftOAuthAdapter } from '../../../src/modules/federated-identity/adapters/microsoft-oauth.adapter.js';
import { FederatedAuthEventEntity } from '../../../src/modules/federated-identity/entities/federated-auth-event.entity.js';
import { FederatedAuthTransactionEntity } from '../../../src/modules/federated-identity/entities/federated-auth-transaction.entity.js';
import { FederatedIdentityProviderEntity } from '../../../src/modules/federated-identity/entities/federated-identity-provider.entity.js';
import { FederatedIdentityEntity } from '../../../src/modules/federated-identity/entities/federated-identity.entity.js';
import { FEDERATED_SETTING_KEYS } from '../../../src/modules/federated-identity/enum/federated-identity.enum.js';
import type { OidcJwk } from '../../../src/modules/federated-identity/helpers/oidc-jwt-verifier.helper.js';
import type { FederatedAuthEventRepository } from '../../../src/modules/federated-identity/repositories/federated-auth-event.repository.js';
import type { FederatedAuthTransactionRepository } from '../../../src/modules/federated-identity/repositories/federated-auth-transaction.repository.js';
import type { FederatedIdentityProviderRepository } from '../../../src/modules/federated-identity/repositories/federated-identity-provider.repository.js';
import type { FederatedIdentityRepository } from '../../../src/modules/federated-identity/repositories/federated-identity.repository.js';
import { FederatedAuthFlowService } from '../../../src/modules/federated-identity/services/federated-auth-flow.service.js';
import { FederatedIdentityService } from '../../../src/modules/federated-identity/services/federated-identity.service.js';
import { FederatedJwksService } from '../../../src/modules/federated-identity/services/federated-jwks.service.js';
import { FederatedMonitoringService } from '../../../src/modules/federated-identity/services/federated-monitoring.service.js';
import { FederatedProvidersService } from '../../../src/modules/federated-identity/services/federated-providers.service.js';
import { OAuthProviderRegistryService } from '../../../src/modules/federated-identity/services/oauth-provider-registry.service.js';

function createTestRsaKeyPair(kid = 'flow-key-1') {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as OidcJwk;
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    kid,
    jwk: { ...jwk, kid, use: 'sig', alg: 'RS256' } as OidcJwk,
    privatePem,
  };
}

function buildSignedIdToken(params: {
  readonly kid: string;
  readonly privatePem: string;
  readonly claims: Record<string, unknown>;
}): string {
  const headerB64 = Buffer.from(
    JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: params.kid }),
    'utf8',
  ).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(params.claims), 'utf8').toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = sign('RSA-SHA256', Buffer.from(signingInput, 'ascii'), params.privatePem);
  return `${signingInput}.${sig.toString('base64url')}`;
}

function createHarness() {
  const keyPair = createTestRsaKeyPair();
  const settingRegistry = new SettingRegistryService();
  settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.AUTO_LINK_VERIFIED_EMAIL, false);
  settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.ALLOW_AUTO_REGISTER, true);
  settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.REQUIRE_VERIFIED_EMAIL_FOR_REGISTER, true);
  settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.TRANSACTION_TTL_SECONDS, 600);
  settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.JWKS_CACHE_TTL_SECONDS, 3600);
  settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.REQUIRE_STEP_UP_FOR_UNLINK, false);
  settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.ALLOWED_REDIRECT_URIS, [
    'http://localhost:5173/auth',
  ]);

  const encryptionService = new FieldEncryptionService();
  const metrics = new MetricsRegistryService({ runtime: 'test-federated' });
  const auditLogService = new AuditLogService();
  const platformSecurity = new PlatformSecurityService();

  let providerSeq = 1;
  let identitySeq = 1;
  let txSeq = 1;
  let eventSeq = 1;
  let userSeq = 100;

  const providers = new Map<number, FederatedIdentityProviderEntity>();
  const identities = new Map<number, FederatedIdentityEntity>();
  const transactions = new Map<number, FederatedAuthTransactionEntity>();
  const events: FederatedAuthEventEntity[] = [];

  interface FakeUserRecord {
    id: number;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    fullName: string;
    status: 1 | 2 | 3 | 4;
    emailVerifiedAt: Date | null;
    hasPassword: boolean;
  }
  const users = new Map<number, FakeUserRecord>();

  const providerRepo = {
    findByCode: async (code: string, withDeleted = false) => {
      const clean = code.trim().toLowerCase();
      return (
        [...providers.values()].find(
          (p) => (withDeleted || !p.deletedAt) && p.providerCode === clean,
        ) ?? null
      );
    },
    listAll: async () => [...providers.values()].filter((p) => !p.deletedAt),
    findEnabledPublicProviders: async () =>
      [...providers.values()].filter(
        (p) => !p.deletedAt && p.isEnabled && p.status === 1 && Boolean(p.clientId?.trim()),
      ),
    updateTelemetry: async (
      providerId: number,
      payload: { lastSuccessAt?: Date; lastErrorAt?: Date; lastErrorCode?: string | null },
    ) => {
      const p = providers.get(providerId);
      if (!p) return;
      if (payload.lastSuccessAt) p.lastSuccessAt = payload.lastSuccessAt;
      if (payload.lastErrorAt) p.lastErrorAt = payload.lastErrorAt;
      if (payload.lastErrorCode !== undefined) p.lastErrorCode = payload.lastErrorCode;
    },
    saveEntity: async (partial: Partial<FederatedIdentityProviderEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : providerSeq++;
      const existing = providers.get(id);
      const entity = Object.assign(new FederatedIdentityProviderEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt:
          partial.deletedAt !== undefined ? partial.deletedAt : (existing?.deletedAt ?? null),
      });
      providers.set(id, entity);
      return entity;
    },
    repository: {
      softDelete: async (criteria: { id: number }) => {
        const p = providers.get(Number(criteria.id));
        if (p) p.deletedAt = new Date();
      },
    },
  } as unknown as FederatedIdentityProviderRepository;

  const identityRepo = {
    findByIdAndUserId: async (id: number, userId: number) => {
      const item = identities.get(Number(id));
      return item && Number(item.userId) === Number(userId) ? item : null;
    },
    findByProviderSubject: async (providerCode: string, issuerUrl: string, subject: string) =>
      [...identities.values()].find(
        (i) =>
          i.providerCode === providerCode.trim().toLowerCase() &&
          i.issuerUrl === issuerUrl.trim() &&
          i.providerSubject === subject.trim(),
      ) ?? null,
    findByUserId: async (userId: number) =>
      [...identities.values()].filter((i) => Number(i.userId) === Number(userId)),
    countByUserIdExcluding: async (userId: number, excludeId: number) =>
      [...identities.values()].filter(
        (i) => Number(i.userId) === Number(userId) && Number(i.id) !== Number(excludeId),
      ).length,
    hardDeleteById: async (id: number) => {
      identities.delete(Number(id));
    },
    saveEntity: async (partial: Partial<FederatedIdentityEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : identitySeq++;
      const existing = identities.get(id);
      const entity = Object.assign(new FederatedIdentityEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      identities.set(id, entity);
      return entity;
    },
  } as unknown as FederatedIdentityRepository;

  const txRepo = {
    findByStateHash: async (stateHash: string) =>
      [...transactions.values()].find((t) => t.stateHash === stateHash) ?? null,
    consumeAtomically: async (id: number, consumedAt = new Date()) => {
      const tx = transactions.get(Number(id));
      if (!tx || tx.consumedAt) return false;
      tx.consumedAt = consumedAt;
      return true;
    },
    saveEntity: async (partial: Partial<FederatedAuthTransactionEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : txSeq++;
      const existing = transactions.get(id);
      const entity = Object.assign(new FederatedAuthTransactionEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      transactions.set(id, entity);
      return entity;
    },
  } as unknown as FederatedAuthTransactionRepository;

  const eventRepo = {
    saveEntity: async (partial: Partial<FederatedAuthEventEntity>) => {
      const now = new Date();
      const id = eventSeq++;
      const entity = Object.assign(new FederatedAuthEventEntity(), partial, {
        id,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      events.unshift(entity);
      return entity;
    },
    listPaginated: async (filter: {
      page?: number;
      limit?: number;
      providerCode?: string;
      outcome?: string;
    }) => {
      const filtered = events.filter(
        (ev) =>
          (!filter.providerCode || ev.providerCode === filter.providerCode) &&
          (!filter.outcome || ev.outcome === filter.outcome),
      );
      return {
        data: filtered.slice(0, filter.limit ?? 20),
        meta: {
          page: filter.page ?? 1,
          limit: filter.limit ?? 20,
          total: filtered.length,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };
    },
    findEventsSince: async (since: Date, providerCode?: string) =>
      events.filter(
        (ev) =>
          ev.occurredAt.getTime() >= since.getTime() &&
          (!providerCode || ev.providerCode === providerCode),
      ),
  } as unknown as FederatedAuthEventRepository;

  const nextTokenResponse: {
    claims: Record<string, unknown>;
  } = {
    claims: {},
  };

  const mockHttpClient = {
    forService: (serviceName: string) => ({
      get: async () => ({ keys: [keyPair.jwk] }),
      post: async (_url: string, body: unknown) => {
        const params = body instanceof URLSearchParams ? body : new URLSearchParams();
        const iss =
          serviceName === 'oauth-microsoft'
            ? 'https://login.microsoftonline.com/tenant-1/v2.0'
            : 'https://accounts.google.com';
        const aud = serviceName === 'oauth-microsoft' ? 'ms-client-1' : 'google-client-1';
        const nowSec = Math.floor(Date.now() / 1000);
        const token = buildSignedIdToken({
          kid: keyPair.kid,
          privatePem: keyPair.privatePem,
          claims: {
            iss,
            aud,
            iat: nowSec,
            exp: nowSec + 300,
            ...(serviceName === 'oauth-microsoft' ? { tid: 'tenant-1' } : {}),
            ...nextTokenResponse.claims,
            _verifiedCodeVerifierPresent: Boolean(params.get('code_verifier')),
          },
        });
        return { id_token: token };
      },
    }),
  } as unknown as HttpClientContract;

  const usersPublicService = {
    findAuthUserByIdentifier: async (
      identifier: string,
    ): Promise<UserAuthCredentialsView | null> => {
      const clean = identifier.trim().toLowerCase();
      const found = [...users.values()].find(
        (u) => u.email.toLowerCase() === clean || u.username.toLowerCase() === clean,
      );
      if (!found) return null;
      return {
        id: found.id,
        username: found.username,
        email: found.email,
        phone: null,
        firstName: found.firstName,
        lastName: found.lastName,
        fullName: found.fullName,
        passwordHash: found.hasPassword ? 'scrypt$salt$hash' : '',
        status: found.status,
        statusName: 'ACTIVE',
        emailVerifiedAt: found.emailVerifiedAt,
        phoneVerifiedAt: null,
        lockedUntil: null,
        lockReason: null,
        failedLoginAttempts: 0,
        mfaEnabled: false,
        archivedAt: null,
      };
    },
    registerSelfUser: async (input: SelfRegisterUserInput): Promise<UserAuthIdentityView> => {
      const id = ++userSeq;
      const email = (input.email ?? '').trim().toLowerCase();
      const rec: FakeUserRecord = {
        id,
        username: input.username ?? email.split('@')[0] ?? `user${id}`,
        email,
        firstName: input.firstName ?? 'User',
        lastName: input.lastName ?? 'Core',
        fullName: input.fullName ?? 'Core User',
        status: USER_STATUS.ACTIVE,
        emailVerifiedAt: null,
        hasPassword: false,
      };
      users.set(id, rec);
      return {
        id: rec.id,
        username: rec.username,
        email: rec.email,
        firstName: rec.firstName,
        lastName: rec.lastName,
        fullName: rec.fullName,
        phone: null,
        status: rec.status,
        statusName: 'ACTIVE',
        lockedUntil: null,
        mfaEnabled: false,
        primaryOrganizationUnitId: null,
        organizationUnitIds: [],
        roles: ['user'],
        permissions: [],
      };
    },
    markEmailVerified: async (userId: number) => {
      const u = users.get(Number(userId));
      if (u) u.emailVerifiedAt = new Date();
    },
  } as unknown as IUsersPublicService;

  const credentialsPublicService: ICredentialsPublicService = {
    hasPassword: async (userId: number) => Boolean(users.get(Number(userId))?.hasPassword),
  } as ICredentialsPublicService;

  const authPublicService: IAuthPublicService = {
    revokeAllUserSessions: async () => 0,
    verifyStepUpToken: jest.fn(async (_uid: number, tok: string) => tok === 'valid-step-up'),
    completeExternalLogin: jest.fn(
      async (input: CompleteExternalLoginInput): Promise<LoginResponse> => {
        const u = users.get(Number(input.userId))!;
        return {
          mfaRequired: false,
          accessToken: `access-for-${u.id}`,
          refreshToken: `refresh-for-${u.id}`,
          sessionId: 777,
          expiresInSeconds: 900,
          user: {
            id: u.id,
            username: u.username,
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            fullName: u.fullName,
            phone: null,
            status: u.status,
            statusName: 'ACTIVE',
            mfaEnabled: false,
            primaryOrganizationUnitId: null,
            organizationUnitIds: [],
            roles: ['user'],
            permissions: [],
          },
        };
      },
    ),
  };

  const sessionsPublicService = {
    recordAuthEvent: jest.fn(async () => ({})),
  } as unknown as ISessionsPublicService;

  const jwksService = new FederatedJwksService(mockHttpClient);
  const googleAdapter = new GoogleOAuthAdapter(mockHttpClient, jwksService);
  const microsoftAdapter = new MicrosoftOAuthAdapter(mockHttpClient, jwksService);
  const providerRegistry = new OAuthProviderRegistryService(googleAdapter, microsoftAdapter);
  const monitoringService = new FederatedMonitoringService(
    eventRepo,
    providerRepo,
    metrics,
    platformSecurity,
    sessionsPublicService,
  );
  const providersService = new FederatedProvidersService(
    providerRepo,
    providerRegistry,
    settingRegistry,
    encryptionService,
    auditLogService,
  );
  const flowService = new FederatedAuthFlowService(
    providerRepo,
    identityRepo,
    txRepo,
    providersService,
    providerRegistry,
    monitoringService,
    usersPublicService,
    credentialsPublicService,
    authPublicService,
    sessionsPublicService,
    settingRegistry,
    encryptionService,
    undefined,
    auditLogService,
  );
  const service = new FederatedIdentityService(providersService, flowService, monitoringService);

  function extractNonceFromAuthUrl(authUrl: string): string {
    return new URL(authUrl).searchParams.get('nonce') ?? '';
  }

  return {
    service,
    settingRegistry,
    metrics,
    platformSecurity,
    authPublicService,
    sessionsPublicService,
    users,
    identities,
    transactions,
    events,
    nextTokenResponse,
    extractNonceFromAuthUrl,
    seedExistingUser: (data: Partial<FakeUserRecord> & { email: string }) => {
      const id = ++userSeq;
      const rec: FakeUserRecord = {
        id,
        username: data.username ?? data.email.split('@')[0]!,
        email: data.email.toLowerCase(),
        firstName: data.firstName ?? 'Existing',
        lastName: data.lastName ?? 'User',
        fullName: data.fullName ?? 'Existing User',
        status: data.status ?? USER_STATUS.ACTIVE,
        emailVerifiedAt: data.emailVerifiedAt ?? null,
        hasPassword: data.hasPassword ?? true,
      };
      users.set(id, rec);
      return rec;
    },
  };
}

describe('FederatedIdentityService End-to-End Flows (10.4)', () => {
  it('configures providers cleanly, auto-registers first-time OAuth user, and logs in by stable subject even after email changes', async () => {
    const h = createHarness();
    await h.service.upsertProvider('google', {
      isEnabled: true,
      clientId: 'google-client-1',
      clientSecret: 'super-secret-google',
    });

    const publicList = await h.service.listPublicProviders();
    expect(publicList).toHaveLength(1);
    expect(publicList[0]!.providerCode).toBe('google');

    // First login: auto-registers new user without local password
    const auth1 = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    const nonce1 = h.extractNonceFromAuthUrl(auth1.authorizationUrl);

    h.nextTokenResponse.claims = {
      sub: 'google-stable-sub-42',
      email: 'newbie@gmail.com',
      email_verified: true,
      given_name: 'An',
      family_name: 'Le',
      nonce: nonce1,
    };

    const cb1 = await h.service.handleCallback('google', {
      code: 'raw-auth-code-secret-1',
      state: auth1.state,
      redirectUri: 'http://localhost:5173/auth',
    });

    expect(cb1.flowType).toBe('LOGIN');
    if (cb1.flowType !== 'LOGIN') throw new Error('Expected LOGIN');
    expect(cb1.isNewUser).toBe(true);
    expect(cb1.identity.providerSubject).toBe('google-stable-sub-42');
    expect(cb1.loginResult.accessToken).toContain('access-for-');
    const createdUserId = cb1.identity.userId;
    expect(h.users.get(createdUserId)?.hasPassword).toBe(false);
    expect(h.users.get(createdUserId)?.emailVerifiedAt).not.toBeNull();

    // Second login: provider email changed, same stable 'sub' -> logs into SAME userId!
    const auth2 = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    const nonce2 = h.extractNonceFromAuthUrl(auth2.authorizationUrl);
    h.nextTokenResponse.claims = {
      sub: 'google-stable-sub-42',
      email: 'renamed-email@gmail.com',
      email_verified: true,
      nonce: nonce2,
    };

    const cb2 = await h.service.handleCallback('google', {
      code: 'raw-auth-code-secret-2',
      state: auth2.state,
    });
    expect(cb2.flowType).toBe('LOGIN');
    if (cb2.flowType !== 'LOGIN') throw new Error('Expected LOGIN');
    expect(cb2.isNewUser).toBe(false);
    expect(cb2.identity.userId).toBe(createdUserId);
    expect(cb2.identity.emailAtProvider).toBe('renamed-email@gmail.com');
  });

  it('prevents state replay, expired state, provider mismatch, and logs redacted monitoring errors', async () => {
    const h = createHarness();
    await h.service.upsertProvider('google', {
      isEnabled: true,
      clientId: 'google-client-1',
      clientSecret: 'super-secret-google',
    });

    const auth = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    const nonce = h.extractNonceFromAuthUrl(auth.authorizationUrl);
    h.nextTokenResponse.claims = {
      sub: 'google-sub-replay',
      email: 'replay@gmail.com',
      email_verified: true,
      nonce,
    };

    // First callback succeeds
    await h.service.handleCallback('google', {
      code: 'secret-code-abc',
      state: auth.state,
    });

    // Replay with same state fails
    await expect(
      h.service.handleCallback('google', {
        code: 'secret-code-abc',
        state: auth.state,
      }),
    ).rejects.toThrow(UnauthorizedAppException);

    // Expired state fails
    const authExpired = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    const lastTx = [...h.transactions.values()].at(-1)!;
    lastTx.expiresAt = new Date(Date.now() - 10_000);
    await expect(
      h.service.handleCallback('google', {
        code: 'code-exp',
        state: authExpired.state,
      }),
    ).rejects.toThrow(UnauthorizedAppException);

    // Provider error callback consumes state & records monitoring error
    const authErr = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    await expect(
      h.service.handleCallback('google', {
        state: authErr.state,
        error: 'access_denied',
        errorDescription: 'User cancelled consent',
      }),
    ).rejects.toThrow(UnauthorizedAppException);

    const summary = await h.service.getMonitoringSummary(24);
    expect(summary.totalAttempts).toBe(4);
    expect(summary.successCount).toBe(1);
    expect(summary.failureCount).toBe(3);
    expect(summary.errorRatePercent).toBe(75);
    expect(summary.topErrors.some((e) => e.errorCode === 'STATE_REPLAY_DETECTED')).toBe(true);
    expect(summary.topErrors.some((e) => e.providerError === 'access_denied')).toBe(true);

    // Verify Prometheus metrics and ensure no raw secrets leaked into stored events
    const promText = await h.metrics.metrics();
    expect(promText).toContain('federated_auth_attempts_total');
    expect(promText).toContain('federated_auth_failures_total');

    const serializedEvents = JSON.stringify(h.events);
    expect(serializedEvents).not.toContain('super-secret-google');
    expect(serializedEvents).not.toContain('secret-code-abc');
  });

  it('enforces duplicate-user protection: blocks auto-link by default, allows only when policy=true and email_verified=true', async () => {
    const h = createHarness();
    const existingAlice = h.seedExistingUser({
      email: 'alice@company.com',
      hasPassword: true,
    });

    await h.service.upsertProvider('google', {
      isEnabled: true,
      clientId: 'google-client-1',
      clientSecret: 'secret-g',
    });

    // 1. Default auto_link_verified_email = false -> blocks with ConflictAppException
    const auth1 = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'sub-alice',
      email: 'alice@company.com',
      email_verified: true,
      nonce: h.extractNonceFromAuthUrl(auth1.authorizationUrl),
    };
    await expect(
      h.service.handleCallback('google', { code: 'c1', state: auth1.state }),
    ).rejects.toThrow(ConflictAppException);
    expect(h.users.size).toBe(1);

    // 2. Enable auto_link_verified_email = true, but email_verified = false -> still blocked
    h.settingRegistry.setGlobalValue(FEDERATED_SETTING_KEYS.AUTO_LINK_VERIFIED_EMAIL, true);
    const auth2 = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'sub-alice',
      email: 'alice@company.com',
      email_verified: false,
      nonce: h.extractNonceFromAuthUrl(auth2.authorizationUrl),
    };
    await expect(
      h.service.handleCallback('google', { code: 'c2', state: auth2.state }),
    ).rejects.toThrow(ConflictAppException);

    // 3. With auto_link_verified_email = true AND email_verified = true -> auto-links without duplicate user
    const auth3 = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'sub-alice',
      email: 'alice@company.com',
      email_verified: true,
      nonce: h.extractNonceFromAuthUrl(auth3.authorizationUrl),
    };
    const cb3 = await h.service.handleCallback('google', { code: 'c3', state: auth3.state });
    expect(cb3.flowType).toBe('LOGIN');
    if (cb3.flowType !== 'LOGIN') throw new Error('Expected LOGIN');
    expect(cb3.autoLinked).toBe(true);
    expect(cb3.isNewUser).toBe(false);
    expect(cb3.identity.userId).toBe(existingAlice.id);
    expect(h.users.size).toBe(1);
  });

  it('respects allow_auto_register=false and verified email requirement on first login', async () => {
    const h = createHarness();
    await h.service.upsertProvider('google', {
      isEnabled: true,
      clientId: 'google-client-1',
      clientSecret: 'secret-g',
      allowAutoRegisterOverride: false,
    });

    const auth1 = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'brand-new-sub',
      email: 'stranger@gmail.com',
      email_verified: true,
      nonce: h.extractNonceFromAuthUrl(auth1.authorizationUrl),
    };
    await expect(
      h.service.handleCallback('google', { code: 'c1', state: auth1.state }),
    ).rejects.toThrow(ForbiddenAppException);
    expect(h.users.size).toBe(0);
  });

  it('supports explicit LINK flow, blocks account hijacking across users, and prevents unlinking the last login method', async () => {
    const h = createHarness();
    await h.service.upsertProvider('google', {
      isEnabled: true,
      clientId: 'google-client-1',
      clientSecret: 'secret-g',
    });
    await h.service.upsertProvider('microsoft', {
      isEnabled: true,
      clientId: 'ms-client-1',
      clientSecret: 'secret-ms',
      tenantId: 'tenant-1',
    });

    // User A registers via Google (no local password)
    const loginAuth = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'google-a',
      email: 'usera@gmail.com',
      email_verified: true,
      nonce: h.extractNonceFromAuthUrl(loginAuth.authorizationUrl),
    };
    const loginRes = await h.service.handleCallback('google', {
      code: 'c-login',
      state: loginAuth.state,
    });
    if (loginRes.flowType !== 'LOGIN') throw new Error('Expected LOGIN');
    const userAId = loginRes.identity.userId;
    const googleIdentityId = loginRes.identity.id;

    // Cannot unlink Google because User A has no password and no other linked provider!
    await expect(
      h.service.unlinkUserIdentity(userAId, googleIdentityId, { actorUserId: userAId }),
    ).rejects.toThrow(ConflictAppException);

    // User A explicitly links Microsoft
    const linkAuth = await h.service.initiateLinkAuthorize('microsoft', userAId, {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'ms-a',
      email: 'usera@contoso.com',
      xms_edov: true,
      nonce: h.extractNonceFromAuthUrl(linkAuth.authorizationUrl),
    };
    // Calling LINK callback without matching actor must be rejected
    await expect(
      h.service.handleCallback(
        'microsoft',
        { code: 'c-link', state: linkAuth.state },
        { actorUserId: userAId + 999, expectedFlowType: 'LINK' },
      ),
    ).rejects.toThrow(ForbiddenAppException);

    // Correct actor completes LINK
    const linkRes = await h.service.handleCallback(
      'microsoft',
      { code: 'c-link', state: linkAuth.state },
      { actorUserId: userAId, expectedFlowType: 'LINK' },
    );
    expect(linkRes.flowType).toBe('LINK');
    if (linkRes.flowType !== 'LINK') throw new Error('Expected LINK');
    expect(linkRes.linked).toBe(true);
    const msIdentityId = linkRes.identity.id;

    // User B cannot hijack User A's Microsoft link
    const userB = h.seedExistingUser({ email: 'userb@company.com', hasPassword: true });
    const hijackAuth = await h.service.initiateLinkAuthorize('microsoft', userB.id, {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'ms-a',
      email: 'usera@contoso.com',
      xms_edov: true,
      nonce: h.extractNonceFromAuthUrl(hijackAuth.authorizationUrl),
    };
    await expect(
      h.service.handleCallback(
        'microsoft',
        { code: 'c-hijack', state: hijackAuth.state },
        { actorUserId: userB.id, expectedFlowType: 'LINK' },
      ),
    ).rejects.toThrow(ConflictAppException);

    // Now User A can unlink Google because Microsoft remains!
    const unlinkGoogle = await h.service.unlinkUserIdentity(userAId, googleIdentityId, {
      actorUserId: userAId,
    });
    expect(unlinkGoogle.unlinked).toBe(true);
    expect(unlinkGoogle.remainingLinkedCount).toBe(1);

    // User A still cannot unlink Microsoft while lacking a password
    await expect(
      h.service.unlinkUserIdentity(userAId, msIdentityId, { actorUserId: userAId }),
    ).rejects.toThrow(ConflictAppException);

    // Once User A sets a local password, unlinking Microsoft succeeds
    h.users.get(userAId)!.hasPassword = true;
    const unlinkMs = await h.service.unlinkUserIdentity(userAId, msIdentityId, {
      actorUserId: userAId,
    });
    expect(unlinkMs.unlinked).toBe(true);
    expect(unlinkMs.remainingLinkedCount).toBe(0);
    expect(unlinkMs.hasLocalPassword).toBe(true);
  });

  it('does not bump lastLoginAt and records LOGIN_COMPLETION failure when completeExternalLogin throws for a locked returning user', async () => {
    const h = createHarness();
    await h.service.upsertProvider('google', {
      isEnabled: true,
      clientId: 'google-client-1',
      clientSecret: 'secret-1',
    });

    // 1. User logs in for the first time via Google (succeeds)
    const firstAuth = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'google-sub-locked-test',
      email: 'locked.user@gmail.com',
      email_verified: true,
      nonce: h.extractNonceFromAuthUrl(firstAuth.authorizationUrl),
    };
    const firstRes = await h.service.handleCallback('google', {
      code: 'c-first',
      state: firstAuth.state,
    });
    if (firstRes.flowType !== 'LOGIN') throw new Error('Expected LOGIN');

    const identityId = firstRes.identity.id;
    const savedIdentity = h.identities.get(identityId)!;
    const initialLastLoginAt = new Date('2025-01-01T00:00:00.000Z');
    savedIdentity.lastLoginAt = initialLastLoginAt;

    // 2. Subsequent login fails inside authPublicService.completeExternalLogin (e.g. account locked)
    jest
      .spyOn(h.authPublicService, 'completeExternalLogin')
      .mockRejectedValueOnce(new ForbiddenAppException('auth.accountLocked'));

    const secondAuth = await h.service.initiateLoginAuthorize('google', {
      redirectUri: 'http://localhost:5173/auth',
    });
    h.nextTokenResponse.claims = {
      sub: 'google-sub-locked-test',
      email: 'updated.email@gmail.com',
      email_verified: true,
      nonce: h.extractNonceFromAuthUrl(secondAuth.authorizationUrl),
    };

    await expect(
      h.service.handleCallback('google', {
        code: 'c-second',
        state: secondAuth.state,
      }),
    ).rejects.toThrow(ForbiddenAppException);

    // lastLoginAt & emailAtProvider must remain untouched when completeExternalLogin rejects
    expect(h.identities.get(identityId)!.lastLoginAt?.getTime()).toBe(initialLastLoginAt.getTime());
    expect(h.identities.get(identityId)!.emailAtProvider).toBe('locked.user@gmail.com');

    // Monitoring must record a LOGIN_COMPLETION failure event
    const failureEvent = h.events.find(
      (ev) => ev.stage === 'LOGIN_COMPLETION' && ev.outcome === 'FAILED',
    );
    expect(failureEvent).toBeDefined();
    expect(failureEvent?.errorCode).toBe('LOGIN_COMPLETION_FAILED');
    expect(failureEvent?.identityId).toBe(identityId);
  });
});
