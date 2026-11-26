import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import type { HttpClientContract } from '@packages/http-client/index.js';
import {
  ConflictAppException,
  FeatureFlagRegistryService,
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
import {
  DATA_SCOPE,
  type IRolesPublicService,
  ROLE_STATUS,
  type RoleSummary,
  type UserRoleLinkSummary,
} from '../../../src/modules/roles/contracts/index.js';
import type { ISessionsPublicService } from '../../../src/modules/sessions/contracts/index.js';
import {
  type IUsersPublicService,
  type SelfRegisterUserInput,
  USER_STATUS,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
} from '../../../src/modules/users/contracts/index.js';
import { GenericOidcAdapter } from '../../../src/modules/federated-identity/adapters/generic-oidc.adapter.js';
import { GoogleOAuthAdapter } from '../../../src/modules/federated-identity/adapters/google-oauth.adapter.js';
import { MicrosoftOAuthAdapter } from '../../../src/modules/federated-identity/adapters/microsoft-oauth.adapter.js';
import { FederatedAuthEventEntity } from '../../../src/modules/federated-identity/entities/federated-auth-event.entity.js';
import { FederatedAuthTransactionEntity } from '../../../src/modules/federated-identity/entities/federated-auth-transaction.entity.js';
import { FederatedIdentityProviderEntity } from '../../../src/modules/federated-identity/entities/federated-identity-provider.entity.js';
import { FederatedIdentityEntity } from '../../../src/modules/federated-identity/entities/federated-identity.entity.js';
import {
  FEDERATED_DRIVER_CODE,
  FEDERATED_FEATURE_FLAGS,
  FEDERATED_ROLE_SYNC_MODE,
  FEDERATED_SETTING_KEYS,
} from '../../../src/modules/federated-identity/enum/federated-identity.enum.js';
import {
  type OidcJwk,
  OidcTokenVerificationError,
  verifyOidcIdToken,
} from '../../../src/modules/federated-identity/helpers/oidc-jwt-verifier.helper.js';
import type { FederatedAuthEventRepository } from '../../../src/modules/federated-identity/repositories/federated-auth-event.repository.js';
import type { FederatedAuthTransactionRepository } from '../../../src/modules/federated-identity/repositories/federated-auth-transaction.repository.js';
import type { FederatedIdentityProviderRepository } from '../../../src/modules/federated-identity/repositories/federated-identity-provider.repository.js';
import type { FederatedIdentityRepository } from '../../../src/modules/federated-identity/repositories/federated-identity.repository.js';
import { FederatedAuthFlowService } from '../../../src/modules/federated-identity/services/federated-auth-flow.service.js';
import { FederatedIdentityService } from '../../../src/modules/federated-identity/services/federated-identity.service.js';
import { FederatedJwksService } from '../../../src/modules/federated-identity/services/federated-jwks.service.js';
import { FederatedMonitoringService } from '../../../src/modules/federated-identity/services/federated-monitoring.service.js';
import { FederatedProvidersService } from '../../../src/modules/federated-identity/services/federated-providers.service.js';
import { FederatedRoleSyncService } from '../../../src/modules/federated-identity/services/federated-role-sync.service.js';
import { OAuthProviderRegistryService } from '../../../src/modules/federated-identity/services/oauth-provider-registry.service.js';
import { OidcDiscoveryService } from '../../../src/modules/federated-identity/services/oidc-discovery.service.js';

function createRsaKeyPair(kid: string) {
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

function createEnterpriseHarness() {
  const keycloakKey = createRsaKeyPair('kc-key-1');
  const oktaKey = createRsaKeyPair('okta-key-1');

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

  const featureFlagRegistry = new FeatureFlagRegistryService();
  featureFlagRegistry.upsertDefinition({
    id: 9001,
    key: FEDERATED_FEATURE_FLAGS.ENTERPRISE_OIDC_SSO,
    module: 'federated-identity',
    name: 'Enterprise OIDC SSO',
    description: 'Enterprise OIDC SSO test flag',
    isEnabled: true,
    rolloutPercentage: 100,
    targetUserIds: [],
    targetRoles: [],
    targetOrganizationUnitIds: [],
    startsAt: null,
    endsAt: null,
    metadata: null,
    isSystem: true,
    status: 1,
    updatedBy: null,
    updatedAt: new Date().toISOString(),
  });

  const encryptionService = new FieldEncryptionService();
  const metrics = new MetricsRegistryService({ runtime: 'test-enterprise-oidc' });
  const auditLogService = new AuditLogService();
  const platformSecurity = new PlatformSecurityService();

  let providerSeq = 1;
  let identitySeq = 1;
  let txSeq = 1;
  let eventSeq = 1;
  let userSeq = 200;

  const providers = new Map<number, FederatedIdentityProviderEntity>();
  const identities = new Map<number, FederatedIdentityEntity>();
  const transactions = new Map<number, FederatedAuthTransactionEntity>();
  const events: FederatedAuthEventEntity[] = [];

  interface FakeUser {
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
  const users = new Map<number, FakeUser>();

  const rolesCatalog: RoleSummary[] = [
    {
      id: 1,
      code: 'super_admin',
      name: 'Super Admin',
      isSystem: true,
      dataScope: DATA_SCOPE.ALL,
      dataScopeName: 'ALL',
      status: ROLE_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: ['*'],
    },
    {
      id: 2,
      code: 'admin',
      name: 'Admin',
      isSystem: true,
      dataScope: DATA_SCOPE.ALL,
      dataScopeName: 'ALL',
      status: ROLE_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: ['users.read'],
    },
    {
      id: 3,
      code: 'manager',
      name: 'Manager',
      isSystem: false,
      dataScope: DATA_SCOPE.ORG_UNIT,
      dataScopeName: 'ORG_UNIT',
      status: ROLE_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: ['reports.read'],
    },
    {
      id: 4,
      code: 'viewer',
      name: 'Viewer',
      isSystem: false,
      dataScope: DATA_SCOPE.SELF,
      dataScopeName: 'SELF',
      status: ROLE_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: ['profile.read'],
    },
    {
      id: 5,
      code: 'local_specialist',
      name: 'Local Specialist',
      isSystem: false,
      dataScope: DATA_SCOPE.SELF,
      dataScopeName: 'SELF',
      status: ROLE_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: ['special.read'],
    },
    {
      id: 6,
      code: 'inactive_role',
      name: 'Inactive Role',
      isSystem: false,
      dataScope: DATA_SCOPE.SELF,
      dataScopeName: 'SELF',
      status: ROLE_STATUS.INACTIVE,
      statusName: 'INACTIVE',
      permissionIds: [],
      permissions: [],
    },
  ];
  const userRolesMap = new Map<number, number[]>();

  const rolesPublicService: IRolesPublicService = {
    findByIds: async (ids) => rolesCatalog.filter((r) => ids.includes(r.id)),
    findByCodes: async (codes) => {
      const wanted = new Set(codes.map((c) => c.trim().toLowerCase()));
      return rolesCatalog.filter((r) => wanted.has(r.code.toLowerCase()));
    },
    resolvePermissionsByRoleIds: async () => [],
    ensureActiveRolesExist: async (ids) =>
      rolesCatalog.filter((r) => ids.includes(r.id) && r.status === ROLE_STATUS.ACTIVE),
    findUserRoleLinksByUserIds: async (userIds) => {
      const links: UserRoleLinkSummary[] = [];
      for (const uid of userIds) {
        for (const roleId of userRolesMap.get(uid) ?? []) {
          links.push({ userId: uid, roleId });
        }
      }
      return links;
    },
    replaceUserRoles: async (userId, roleIds) => {
      const unique = Array.from(new Set(roleIds.map(Number)));
      userRolesMap.set(userId, unique);
      return unique.map((roleId) => ({ userId, roleId }));
    },
  };

  let discoveryFetchCount = 0;
  let nextClaimsByTokenUrl: Record<string, Record<string, unknown>> = {};
  const nextAccessToken = 'access-token-1';
  let nextUserInfoResponse: Record<string, unknown> | null = null;

  const httpClient = {
    forService: () => ({
      get: async <T>(url: string): Promise<T> => {
        if (url === 'https://sso.keycloak.local/realms/corp/.well-known/openid-configuration') {
          discoveryFetchCount += 1;
          return {
            issuer: 'https://sso.keycloak.local/realms/corp',
            authorization_endpoint:
              'https://sso.keycloak.local/realms/corp/protocol/openid-connect/auth',
            token_endpoint:
              'https://sso.keycloak.local/realms/corp/protocol/openid-connect/token',
            jwks_uri: 'https://sso.keycloak.local/realms/corp/protocol/openid-connect/certs',
            userinfo_endpoint:
              'https://sso.keycloak.local/realms/corp/protocol/openid-connect/userinfo',
          } as unknown as T;
        }
        if (url === 'https://sso.keycloak.local/realms/corp/protocol/openid-connect/certs') {
          return { keys: [keycloakKey.jwk] } as unknown as T;
        }
        if (url === 'https://sso.keycloak.local/realms/corp/protocol/openid-connect/userinfo') {
          return (nextUserInfoResponse ?? { sub: 'kc-user-1' }) as unknown as T;
        }
        if (url === 'https://corp.okta.local/oauth2/default/.well-known/openid-configuration') {
          discoveryFetchCount += 1;
          return {
            issuer: 'https://corp.okta.local/oauth2/default',
            authorization_endpoint: 'https://corp.okta.local/oauth2/default/v1/authorize',
            token_endpoint: 'https://corp.okta.local/oauth2/default/v1/token',
            jwks_uri: 'https://corp.okta.local/oauth2/default/v1/keys',
            userinfo_endpoint: 'https://corp.okta.local/oauth2/default/v1/userinfo',
          } as unknown as T;
        }
        if (url === 'https://corp.okta.local/oauth2/default/v1/keys') {
          return { keys: [oktaKey.jwk] } as unknown as T;
        }
        if (url === 'https://mismatch.idp.local/.well-known/openid-configuration') {
          return {
            issuer: 'https://other-issuer.idp.local',
            authorization_endpoint: 'https://mismatch.idp.local/auth',
            token_endpoint: 'https://mismatch.idp.local/token',
            jwks_uri: 'https://mismatch.idp.local/jwks',
          } as unknown as T;
        }
        throw new Error(`Unexpected GET ${url}`);
      },
      post: async <T, B>(url: string, body: B): Promise<T> => {
        const params = body as unknown as URLSearchParams;
        const txRecord = [...transactions.values()].find((t) => Boolean(t.consumedAt));
        const customClaims = nextClaimsByTokenUrl[url] ?? {};

        if (url === 'https://sso.keycloak.local/realms/corp/protocol/openid-connect/token') {
          const nonce =
            (customClaims['nonce'] as string | undefined) ??
            lastCapturedAuthorizeParams.get('nonce') ??
            '';
          const codeVerifier = params.get('code_verifier') ?? '';
          const expectedChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
          if (expectedChallenge !== lastCapturedAuthorizeParams.get('code_challenge')) {
            throw new Error('PKCE verifier mismatch');
          }
          const nowSec = Math.floor(Date.now() / 1000);
          const idToken = buildSignedIdToken({
            kid: keycloakKey.kid,
            privatePem: keycloakKey.privatePem,
            claims: {
              iss: 'https://sso.keycloak.local/realms/corp',
              aud: 'kc-client-1',
              sub: 'kc-sub-1',
              nonce,
              iat: nowSec,
              exp: nowSec + 300,
              email: 'alice@corp.local',
              email_verified: true,
              name: 'Alice Nguyen',
              ...customClaims,
            },
          });
          return {
            id_token: idToken,
            access_token: nextAccessToken,
            token_type: 'Bearer',
            expires_in: 300,
          } as unknown as T;
        }

        if (url === 'https://corp.okta.local/oauth2/default/v1/token') {
          const nonce =
            (customClaims['nonce'] as string | undefined) ??
            lastCapturedAuthorizeParams.get('nonce') ??
            '';
          const nowSec = Math.floor(Date.now() / 1000);
          const idToken = buildSignedIdToken({
            kid: oktaKey.kid,
            privatePem: oktaKey.privatePem,
            claims: {
              iss: 'https://corp.okta.local/oauth2/default',
              aud: 'okta-client-1',
              sub: 'okta-sub-1',
              nonce,
              iat: nowSec,
              exp: nowSec + 300,
              email: 'bob@partner.local',
              email_verified: true,
              name: 'Bob Tran',
              ...customClaims,
            },
          });
          return {
            id_token: idToken,
            access_token: nextAccessToken,
            token_type: 'Bearer',
            expires_in: 300,
          } as unknown as T;
        }

        void txRecord;
        throw new Error(`Unexpected POST ${url}`);
      },
    }),
  } as unknown as HttpClientContract;

  let lastCapturedAuthorizeParams = new URLSearchParams();

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
      flowType?: string;
      userId?: number;
      stage?: string;
      outcome?: string;
      errorCode?: string;
    }) => {
      const filtered = events.filter(
        (ev) =>
          (!filter.providerCode || ev.providerCode === filter.providerCode) &&
          (!filter.flowType || ev.flowType === filter.flowType) &&
          (filter.userId === undefined || Number(ev.userId) === Number(filter.userId)) &&
          (!filter.stage || ev.stage === filter.stage) &&
          (!filter.outcome || ev.outcome === filter.outcome) &&
          (!filter.errorCode || ev.errorCode === filter.errorCode),
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
          ev.occurredAt >= since &&
          (!providerCode || ev.providerCode === providerCode.toLowerCase()),
      ),
  } as unknown as FederatedAuthEventRepository;

  const usersPublicService = {
    findAuthUserByIdentifier: async (identifier: string): Promise<UserAuthCredentialsView | null> => {
      const clean = identifier.trim().toLowerCase();
      const found = [...users.values()].find((u) => u.email === clean || u.username === clean);
      if (!found) return null;
      return {
        id: found.id,
        username: found.username,
        email: found.email,
        phone: null,
        firstName: found.firstName,
        lastName: found.lastName,
        fullName: found.fullName,
        passwordHash: '',
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
      const id = userSeq++;
      const email = (input.email ?? `user${id}@corp.local`).trim().toLowerCase();
      const user: FakeUser = {
        id,
        username: email.split('@')[0] ?? `user${id}`,
        email,
        firstName: input.firstName ?? '',
        lastName: input.lastName ?? '',
        fullName: input.fullName ?? email,
        status: (input.status ?? USER_STATUS.ACTIVE) as 1 | 2 | 3 | 4,
        emailVerifiedAt: null,
        hasPassword: false,
      };
      users.set(id, user);
      return {
        id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        phone: null,
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE',
        lockedUntil: null,
        mfaEnabled: false,
        primaryOrganizationUnitId: null,
        organizationUnitIds: [],
        roles: [],
        permissions: [],
      };
    },
    markEmailVerified: async (userId: number) => {
      const u = users.get(userId);
      if (u) u.emailVerifiedAt = new Date();
    },
  } as unknown as IUsersPublicService;

  const credentialsPublicService = {
    hasPassword: async (userId: number) => users.get(userId)?.hasPassword ?? false,
  } as unknown as ICredentialsPublicService;

  const authPublicService = {
    completeExternalLogin: async (input: CompleteExternalLoginInput): Promise<LoginResponse> => {
      const u = users.get(input.userId)!;
      const roleIds = userRolesMap.get(input.userId) ?? [];
      const roleCodes = rolesCatalog.filter((r) => roleIds.includes(r.id)).map((r) => r.code);
      return {
        mfaRequired: false,
        accessToken: `jwt-user-${input.userId}`,
        refreshToken: `refresh-user-${input.userId}`,
        expiresInSeconds: 900,
        user: {
          id: u.id,
          username: u.username,
          email: u.email,
          phone: null,
          firstName: u.firstName,
          lastName: u.lastName,
          fullName: u.fullName,
          status: u.status,
          statusName: 'ACTIVE',
          mfaEnabled: false,
          primaryOrganizationUnitId: null,
          organizationUnitIds: [],
          roles: roleCodes,
          permissions: [],
        },
      };
    },
    verifyStepUpToken: async () => true,
  } as unknown as IAuthPublicService;

  const sessionsPublicService = {
    recordAuthEvent: async () => undefined,
  } as unknown as ISessionsPublicService;

  const jwksService = new FederatedJwksService(httpClient);
  const discoveryService = new OidcDiscoveryService(httpClient);
  const googleAdapter = new GoogleOAuthAdapter(httpClient, jwksService);
  const microsoftAdapter = new MicrosoftOAuthAdapter(httpClient, jwksService);
  const genericOidcAdapter = new GenericOidcAdapter(httpClient, jwksService, discoveryService);
  const providerRegistry = new OAuthProviderRegistryService(
    googleAdapter,
    microsoftAdapter,
    genericOidcAdapter,
  );
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
    undefined,
    discoveryService,
  );
  const roleSyncService = new FederatedRoleSyncService(rolesPublicService, auditLogService);
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
    undefined,
    roleSyncService,
    featureFlagRegistry,
  );
  const service = new FederatedIdentityService(
    providersService,
    flowService,
    monitoringService,
  );

  const runLogin = async (providerCode: string) => {
    const authInit = await service.initiateLoginAuthorize(providerCode, {
      redirectUri: 'http://localhost:5173/auth',
    });
    const parsedUrl = new URL(authInit.authorizationUrl);
    lastCapturedAuthorizeParams = parsedUrl.searchParams;
    return service.handleCallback(providerCode, {
      code: 'auth-code-123',
      state: authInit.state,
      redirectUri: 'http://localhost:5173/auth',
    });
  };

  return {
    service,
    discoveryService,
    featureFlagRegistry,
    users,
    userRolesMap,
    events,
    keycloakKey,
    getDiscoveryFetchCount: () => discoveryFetchCount,
    setTokenClaims: (tokenUrl: string, claims: Record<string, unknown>) => {
      nextClaimsByTokenUrl = { ...nextClaimsByTokenUrl, [tokenUrl]: claims };
    },
    setUserInfoResponse: (payload: Record<string, unknown> | null) => {
      nextUserInfoResponse = payload;
    },
    seedExistingUser: (data: Partial<FakeUser> & { id: number; email: string }) => {
      users.set(data.id, {
        id: data.id,
        username: data.username ?? data.email.split('@')[0] ?? `u${data.id}`,
        email: data.email.toLowerCase(),
        firstName: data.firstName ?? 'Existing',
        lastName: data.lastName ?? 'User',
        fullName: data.fullName ?? 'Existing User',
        status: USER_STATUS.ACTIVE,
        emailVerifiedAt: new Date(),
        hasPassword: true,
      });
    },
    runLogin,
  };
}

describe('Enterprise OIDC SSO (Phase 14.1)', () => {
  it('supports configuring multiple OIDC Identity Providers and OIDC Discovery caching', async () => {
    const h = createEnterpriseHarness();

    const kc = await h.service.upsertProvider('keycloak-vn', {
      driverCode: FEDERATED_DRIVER_CODE.OIDC,
      displayName: 'Keycloak VN',
      isEnabled: true,
      clientId: 'kc-client-1',
      clientSecret: 'kc-secret-1',
      issuerUrl: 'https://sso.keycloak.local/realms/corp',
    });
    const okta = await h.service.upsertProvider('okta-corp', {
      driverCode: FEDERATED_DRIVER_CODE.OIDC,
      displayName: 'Okta Corp',
      isEnabled: true,
      clientId: 'okta-client-1',
      clientSecret: 'okta-secret-1',
      issuerUrl: 'https://corp.okta.local/oauth2/default',
    });

    expect(kc.isConfigured).toBe(true);
    expect(okta.isConfigured).toBe(true);
    expect(kc.oidcOptions.discoveryEnabled).toBe(true);

    const publicProviders = await h.service.listPublicProviders();
    expect(publicProviders.map((p) => p.providerCode)).toEqual(['keycloak-vn', 'okta-corp']);

    const discoveryRes = await h.service.discoverProviderConfiguration('keycloak-vn');
    expect(discoveryRes.ok).toBe(true);
    expect(discoveryRes.jwksUri).toBe(
      'https://sso.keycloak.local/realms/corp/protocol/openid-connect/certs',
    );

    const connRes = await h.service.testProviderConnection('okta-corp');
    expect(connRes.ok).toBe(true);
    expect(connRes.discovered).toBe(true);
    expect(connRes.keyCount).toBe(1);

    // Clear cache, then verify two logins on keycloak-vn only fetch discovery once
    h.discoveryService.clearCache();
    const beforeCount = h.getDiscoveryFetchCount();
    await h.runLogin('keycloak-vn');
    const afterFirstCount = h.getDiscoveryFetchCount();
    await h.runLogin('keycloak-vn');
    expect(afterFirstCount).toBe(beforeCount + 1);
    expect(h.getDiscoveryFetchCount()).toBe(afterFirstCount);
  });

  it('rejects discovery issuer mismatch and insecure non-localhost http discovery URL', async () => {
    const h = createEnterpriseHarness();

    await h.service.upsertProvider('bad-issuer-idp', {
      driverCode: FEDERATED_DRIVER_CODE.OIDC,
      isEnabled: true,
      clientId: 'c1',
      clientSecret: 's1',
      issuerUrl: 'https://mismatch.idp.local',
    });
    const badDiscovery = await h.service.discoverProviderConfiguration('bad-issuer-idp');
    expect(badDiscovery.ok).toBe(false);
    expect(badDiscovery.errorCode).toBe('DISCOVERY_ISSUER_MISMATCH');

    expect(() =>
      h.discoveryService.buildDiscoveryUrl('http://insecure.idp.local/realms/test'),
    ).toThrow();
    expect(h.discoveryService.buildDiscoveryUrl('http://localhost:8080/realms/test')).toBe(
      'http://localhost:8080/realms/test/.well-known/openid-configuration',
    );
  });

  it('validates OIDC azp claim when aud is an array or azp mismatches', async () => {
    const { kid, jwk, privatePem } = createRsaKeyPair('azp-key');
    const nowSec = Math.floor(Date.now() / 1000);
    const nonce = 'nonce-azp-123';
    const expectedNonceHash = createHash('sha256').update(nonce, 'utf8').digest('hex');

    const badAzpToken = buildSignedIdToken({
      kid,
      privatePem,
      claims: {
        iss: 'https://idp.example.com',
        aud: ['client-a', 'client-b'],
        azp: 'wrong-client',
        sub: 'user-1',
        nonce,
        iat: nowSec,
        exp: nowSec + 300,
      },
    });

    await expect(
      verifyOidcIdToken({
        idToken: badAzpToken,
        initialJwks: { keys: [jwk] },
        expectedAudience: 'client-a',
        expectedNonceHash,
        validateIssuer: (iss) => iss === 'https://idp.example.com',
      }),
    ).rejects.toThrow(OidcTokenVerificationError);

    const goodAzpToken = buildSignedIdToken({
      kid,
      privatePem,
      claims: {
        iss: 'https://idp.example.com',
        aud: ['client-a', 'client-b'],
        azp: 'client-a',
        sub: 'user-1',
        nonce,
        iat: nowSec,
        exp: nowSec + 300,
      },
    });

    const verified = await verifyOidcIdToken({
      idToken: goodAzpToken,
      initialJwks: { keys: [jwk] },
      expectedAudience: 'client-a',
      expectedNonceHash,
      validateIssuer: (iss) => iss === 'https://idp.example.com',
    });
    expect(verified['sub']).toBe('user-1');
  });

  it('maps nested claims, fetches UserInfo fallback, and rejects UserInfo sub mismatch', async () => {
    const h = createEnterpriseHarness();

    await h.service.upsertProvider('keycloak-vn', {
      driverCode: FEDERATED_DRIVER_CODE.OIDC,
      isEnabled: true,
      clientId: 'kc-client-1',
      clientSecret: 'kc-secret-1',
      issuerUrl: 'https://sso.keycloak.local/realms/corp',
      oidcOptions: {
        fetchUserInfo: true,
      },
      claimMapping: {
        groupsClaim: 'realm_access.roles',
        emailClaim: 'corporate_email',
        nameClaim: 'display_name',
      },
      roleSyncPolicy: {
        enabled: true,
        mode: FEDERATED_ROLE_SYNC_MODE.ADDITIVE,
        allowedRoleCodes: ['MANAGER', 'VIEWER'],
        groupRoleMappings: {
          'corp-managers': ['MANAGER'],
        },
      },
    });

    h.setTokenClaims('https://sso.keycloak.local/realms/corp/protocol/openid-connect/token', {
      email: undefined,
      name: undefined,
      corporate_email: 'alice.nested@corp.local',
      realm_access: { roles: ['corp-managers'] },
    });
    h.setUserInfoResponse({
      sub: 'kc-sub-1',
      display_name: 'Alice From UserInfo',
    });

    const res = await h.runLogin('keycloak-vn');
    expect(res.flowType).toBe('LOGIN');
    if (res.flowType !== 'LOGIN') return;
    expect(res.isNewUser).toBe(true);
    expect(res.identity.emailAtProvider).toBe('alice.nested@corp.local');
    expect(res.identity.displayName).toBe('Alice From UserInfo');
    expect(res.roleSync?.appliedRoleCodes).toEqual(['manager']);
    expect(res.loginResult.user?.roles).toEqual(['manager']);

    // Now simulate UserInfo sub mismatch
    h.setUserInfoResponse({ sub: 'different-sub' });
    await expect(h.runLogin('keycloak-vn')).rejects.toThrow(UnauthorizedAppException);
  });

  it('enforces allowedEmailDomains and auto-register policy before creating user', async () => {
    const h = createEnterpriseHarness();

    await h.service.upsertProvider('keycloak-vn', {
      driverCode: FEDERATED_DRIVER_CODE.OIDC,
      isEnabled: true,
      clientId: 'kc-client-1',
      clientSecret: 'kc-secret-1',
      issuerUrl: 'https://sso.keycloak.local/realms/corp',
      oidcOptions: {
        allowedEmailDomains: ['allowed.vn'],
      },
    });

    // Token returns alice@corp.local -> blocked by domain policy
    await expect(h.runLogin('keycloak-vn')).rejects.toThrow(ForbiddenAppException);
    expect(h.users.size).toBe(0);

    // Update email to allowed.vn, but disable auto-register
    await h.service.upsertProvider('keycloak-vn', {
      allowAutoRegisterOverride: false,
    });
    h.setTokenClaims('https://sso.keycloak.local/realms/corp/protocol/openid-connect/token', {
      email: 'alice@allowed.vn',
    });
    await expect(h.runLogin('keycloak-vn')).rejects.toThrow(ForbiddenAppException);
    expect(h.users.size).toBe(0);
  });

  it('enforces Group->Role allowlist, blocks SUPER_ADMIN, and supports all 3 sync modes', async () => {
    const h = createEnterpriseHarness();

    // 1. Test allowlist + SUPER_ADMIN block + ADDITIVE
    await h.service.upsertProvider('keycloak-vn', {
      driverCode: FEDERATED_DRIVER_CODE.OIDC,
      isEnabled: true,
      clientId: 'kc-client-1',
      clientSecret: 'kc-secret-1',
      issuerUrl: 'https://sso.keycloak.local/realms/corp',
      claimMapping: { groupsClaim: 'groups' },
      roleSyncPolicy: {
        enabled: true,
        mode: FEDERATED_ROLE_SYNC_MODE.ADDITIVE,
        allowedRoleCodes: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'VIEWER'],
        groupRoleMappings: {
          'idp-super': ['SUPER_ADMIN', 'ADMIN'],
          'idp-secret': ['NOT_ALLOWED_CUSTOM_ROLE'],
          'idp-mgr': ['MANAGER'],
        },
      },
    });

    h.setTokenClaims('https://sso.keycloak.local/realms/corp/protocol/openid-connect/token', {
      groups: ['idp-super', 'idp-secret', 'idp-mgr'],
    });

    const firstLogin = await h.runLogin('keycloak-vn');
    expect(firstLogin.flowType).toBe('LOGIN');
    if (firstLogin.flowType !== 'LOGIN') return;
    expect(firstLogin.roleSync?.applied).toBe(true);
    expect(firstLogin.roleSync?.appliedRoleCodes).toEqual(['admin', 'manager']);
    expect(firstLogin.roleSync?.blockedRoleCodes).toEqual([
      'SUPER_ADMIN',
      'NOT_ALLOWED_CUSTOM_ROLE',
    ]);
    const userId = firstLogin.loginResult.user!.id;
    // Simulate a locally assigned role not managed by SSO allowlist (local_specialist = id 5)
    h.userRolesMap.set(userId, [...(h.userRolesMap.get(userId) ?? []), 5]);

    // 2. Test SYNC_MANAGED removes managed roles left by user, keeps unmanaged local_specialist (id 5)
    await h.service.upsertProvider('keycloak-vn', {
      roleSyncPolicy: {
        mode: FEDERATED_ROLE_SYNC_MODE.SYNC_MANAGED,
      },
    });
    h.setTokenClaims('https://sso.keycloak.local/realms/corp/protocol/openid-connect/token', {
      groups: ['idp-mgr'],
    });
    const syncManagedLogin = await h.runLogin('keycloak-vn');
    if (syncManagedLogin.flowType !== 'LOGIN') return;
    expect(syncManagedLogin.roleSync?.action).toBe('UPDATED');
    expect([...(syncManagedLogin.loginResult.user?.roles ?? [])].sort()).toEqual([
      'local_specialist',
      'manager',
    ]);

    // 3. Test ASSIGN_ON_CREATE skips existing users
    await h.service.upsertProvider('keycloak-vn', {
      roleSyncPolicy: {
        mode: FEDERATED_ROLE_SYNC_MODE.ASSIGN_ON_CREATE,
      },
    });
    h.setTokenClaims('https://sso.keycloak.local/realms/corp/protocol/openid-connect/token', {
      groups: ['idp-super'],
    });
    const skipExisting = await h.runLogin('keycloak-vn');
    if (skipExisting.flowType !== 'LOGIN') return;
    expect(skipExisting.roleSync?.action).toBe('SKIPPED_EXISTING_USER');
    expect([...(skipExisting.loginResult.user?.roles ?? [])].sort()).toEqual([
      'local_specialist',
      'manager',
    ]);

    // 4. Test requireMatchedGroup blocks unmatched user
    await h.service.upsertProvider('keycloak-vn', {
      roleSyncPolicy: {
        requireMatchedGroup: true,
      },
    });
    h.setTokenClaims('https://sso.keycloak.local/realms/corp/protocol/openid-connect/token', {
      groups: ['unknown-group'],
    });
    await expect(h.runLogin('keycloak-vn')).rejects.toThrow(ForbiddenAppException);
  });

  it('links SSO account to existing user without creating duplicate users and records SSO history', async () => {
    const h = createEnterpriseHarness();
    h.seedExistingUser({ id: 77, email: 'bob@partner.local', fullName: 'Existing Bob' });

    await h.service.upsertProvider('okta-corp', {
      driverCode: FEDERATED_DRIVER_CODE.OIDC,
      isEnabled: true,
      clientId: 'okta-client-1',
      clientSecret: 'okta-secret-1',
      issuerUrl: 'https://corp.okta.local/oauth2/default',
      autoLinkVerifiedEmailOverride: false,
    });

    // Without auto-link override, existing email must require manual link
    await expect(h.runLogin('okta-corp')).rejects.toThrow(ConflictAppException);
    expect(h.users.size).toBe(1);

    // Enable verified-email auto-link override -> links to user 77 without creating duplicate
    await h.service.upsertProvider('okta-corp', {
      autoLinkVerifiedEmailOverride: true,
    });
    const loginRes = await h.runLogin('okta-corp');
    expect(loginRes.flowType).toBe('LOGIN');
    if (loginRes.flowType !== 'LOGIN') return;
    expect(loginRes.isNewUser).toBe(false);
    expect(loginRes.autoLinked).toBe(true);
    expect(loginRes.loginResult.user?.id).toBe(77);
    expect(h.users.size).toBe(1);

    // Check SSO login history filters (provider, outcome, flowType, userId)
    const successHistory = await h.service.listAuthEvents({
      providerCode: 'okta-corp',
      flowType: 'LOGIN',
      outcome: 'SUCCESS',
      userId: 77,
    });
    expect(successHistory.data.length).toBe(1);
    expect(successHistory.data[0]?.providerCode).toBe('okta-corp');

    const failedHistory = await h.service.listAuthEvents({
      providerCode: 'okta-corp',
      outcome: 'FAILED',
    });
    expect(failedHistory.data.length).toBe(1);
    expect(failedHistory.data[0]?.errorCode).toBe('ACCOUNT_EXISTS_MANUAL_LINK_REQUIRED');
  });

  it('respects enterprise OIDC feature flag', async () => {
    const h = createEnterpriseHarness();
    await h.service.upsertProvider('keycloak-vn', {
      driverCode: FEDERATED_DRIVER_CODE.OIDC,
      isEnabled: true,
      clientId: 'kc-client-1',
      clientSecret: 'kc-secret-1',
      issuerUrl: 'https://sso.keycloak.local/realms/corp',
    });

    h.featureFlagRegistry.upsertDefinition({
      id: 9001,
      key: FEDERATED_FEATURE_FLAGS.ENTERPRISE_OIDC_SSO,
      module: 'federated-identity',
      name: 'Enterprise OIDC SSO',
      description: 'Enterprise OIDC SSO test flag',
      isEnabled: false,
      rolloutPercentage: 100,
      targetUserIds: [],
      targetRoles: [],
      targetOrganizationUnitIds: [],
      startsAt: null,
      endsAt: null,
      metadata: null,
      isSystem: true,
      status: 1,
      updatedBy: null,
      updatedAt: new Date().toISOString(),
    });

    await expect(h.runLogin('keycloak-vn')).rejects.toThrow(ForbiddenAppException);
    expect(h.events[0]?.errorCode).toBe('ENTERPRISE_OIDC_DISABLED');
  });
});
