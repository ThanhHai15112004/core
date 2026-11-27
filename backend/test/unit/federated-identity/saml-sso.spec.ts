import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { SignedXml } from 'xml-crypto';
import type { HttpClientContract } from '@packages/http-client/index.js';
import {
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
import { SamlProviderAdapter } from '../../../src/modules/federated-identity/adapters/saml.adapter.js';
import { FederatedAuthEventEntity } from '../../../src/modules/federated-identity/entities/federated-auth-event.entity.js';
import { FederatedAuthTransactionEntity } from '../../../src/modules/federated-identity/entities/federated-auth-transaction.entity.js';
import { FederatedIdentityProviderEntity } from '../../../src/modules/federated-identity/entities/federated-identity-provider.entity.js';
import { FederatedIdentityEntity } from '../../../src/modules/federated-identity/entities/federated-identity.entity.js';
import { FederatedSamlAssertionReplayEntity } from '../../../src/modules/federated-identity/entities/federated-saml-assertion-replay.entity.js';
import {
  FEDERATED_DRIVER_CODE,
  FEDERATED_FEATURE_FLAGS,
  FEDERATED_SETTING_KEYS,
  SAML_BINDING,
  SAML_CERT_STATUS,
} from '../../../src/modules/federated-identity/enum/federated-identity.enum.js';
import { stripPemHeaders } from '../../../src/modules/federated-identity/helpers/saml-certificate.helper.js';
import { verifySamlXmlSignature } from '../../../src/modules/federated-identity/helpers/saml-xml-signature.helper.js';
import type { FederatedAuthEventRepository } from '../../../src/modules/federated-identity/repositories/federated-auth-event.repository.js';
import type { FederatedAuthTransactionRepository } from '../../../src/modules/federated-identity/repositories/federated-auth-transaction.repository.js';
import type { FederatedIdentityProviderRepository } from '../../../src/modules/federated-identity/repositories/federated-identity-provider.repository.js';
import type { FederatedIdentityRepository } from '../../../src/modules/federated-identity/repositories/federated-identity.repository.js';
import type { FederatedSamlAssertionReplayRepository } from '../../../src/modules/federated-identity/repositories/federated-saml-assertion-replay.repository.js';
import { FederatedAuthFlowService } from '../../../src/modules/federated-identity/services/federated-auth-flow.service.js';
import { FederatedIdentityService } from '../../../src/modules/federated-identity/services/federated-identity.service.js';
import {
  FederatedJwksService,
  FederatedStageError,
} from '../../../src/modules/federated-identity/services/federated-jwks.service.js';
import { FederatedMonitoringService } from '../../../src/modules/federated-identity/services/federated-monitoring.service.js';
import { FederatedProvidersService } from '../../../src/modules/federated-identity/services/federated-providers.service.js';
import { OAuthProviderRegistryService } from '../../../src/modules/federated-identity/services/oauth-provider-registry.service.js';
import { SamlSsoService } from '../../../src/modules/federated-identity/services/saml-sso.service.js';

interface TestCertPair {
  readonly privateKeyPem: string;
  readonly certPem: string;
}

function generateSelfSignedCertPair(commonName: string, days = 365): TestCertPair {
  const dir = mkdtempSync(join(tmpdir(), 'core-saml-test-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        String(days),
        '-subj',
        `/CN=${commonName}`,
      ],
      { stdio: 'pipe' },
    );
    return {
      privateKeyPem: readFileSync(keyPath, 'utf8'),
      certPem: readFileSync(certPath, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildSamlResponseXml(params: {
  readonly responseId?: string;
  readonly assertionId?: string;
  readonly issuer?: string;
  readonly destination?: string;
  readonly recipient?: string;
  readonly audience?: string;
  readonly inResponseTo?: string | null;
  readonly nameId?: string;
  readonly notBefore?: Date;
  readonly notOnOrAfter?: Date;
  readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
  readonly signAssertionWith?: TestCertPair | null;
  readonly signResponseWith?: TestCertPair | null;
  readonly embedUntrustedKeyInfo?: TestCertPair | null;
}): string {
  const responseId = params.responseId ?? `_resp_${Math.random().toString(16).slice(2, 10)}`;
  const assertionId = params.assertionId ?? `_assert_${Math.random().toString(16).slice(2, 10)}`;
  const issuer = params.issuer ?? 'https://idp.corp.test/entity';
  const destination =
    params.destination ?? 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs';
  const recipient = params.recipient ?? destination;
  const audience =
    params.audience ?? 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/metadata';
  const now = new Date();
  const notBefore = (params.notBefore ?? new Date(now.getTime() - 30_000)).toISOString();
  const notOnOrAfter = (params.notOnOrAfter ?? new Date(now.getTime() + 300_000)).toISOString();
  const nameId = params.nameId ?? 'alice.saml@corp.vn';

  const attrXml = Object.entries(
    params.attributes ?? { email: 'alice.saml@corp.vn', displayName: 'Alice SAML' },
  )
    .map(([name, val]) => {
      const vals = Array.isArray(val) ? val : [val];
      const valuesXml = vals.map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`).join('');
      return `<saml:Attribute Name="${name}">${valuesXml}</saml:Attribute>`;
    })
    .join('');

  const inRespAttr = params.inResponseTo ? ` InResponseTo="${params.inResponseTo}"` : '';

  let assertionXml = [
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">`,
    `<saml:Issuer>${issuer}</saml:Issuer>`,
    `<saml:Subject>`,
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID>`,
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">`,
    `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${recipient}"${inRespAttr}/>`,
    `</saml:SubjectConfirmation>`,
    `</saml:Subject>`,
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">`,
    `<saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction>`,
    `</saml:Conditions>`,
    `<saml:AttributeStatement>${attrXml}</saml:AttributeStatement>`,
    `</saml:Assertion>`,
  ].join('');

  if (params.signAssertionWith) {
    const keyInfoCert = params.embedUntrustedKeyInfo?.certPem ?? params.signAssertionWith.certPem;
    const signer = new SignedXml({
      privateKey: params.signAssertionWith.privateKeyPem,
      publicCert: keyInfoCert,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    signer.addReference({
      xpath: `//*[@ID='${assertionId}']`,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      uri: `#${assertionId}`,
    });
    signer.computeSignature(assertionXml, {
      prefix: 'ds',
      location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
    });
    assertionXml = signer.getSignedXml();
  }

  let responseXml = [
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${destination}"${inRespAttr}>`,
    `<saml:Issuer>${issuer}</saml:Issuer>`,
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`,
    assertionXml,
    `</samlp:Response>`,
  ].join('');

  if (params.signResponseWith) {
    const signer = new SignedXml({
      privateKey: params.signResponseWith.privateKeyPem,
      publicCert: params.signResponseWith.certPem,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    signer.addReference({
      xpath: `//*[@ID='${responseId}']`,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      uri: `#${responseId}`,
    });
    signer.computeSignature(responseXml, {
      prefix: 'ds',
      location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
    });
    responseXml = signer.getSignedXml();
  }

  return responseXml;
}

function buildIdpMetadataXml(params: {
  readonly entityId: string;
  readonly ssoUrl: string;
  readonly certsPem: readonly string[];
}): string {
  const keyDescriptors = params.certsPem
    .map(
      (pem) =>
        `<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${stripPemHeaders(pem)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`,
    )
    .join('');

  return [
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${params.entityId}">`,
    `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
    keyDescriptors,
    `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${params.ssoUrl}"/>`,
    `</md:IDPSSODescriptor>`,
    `</md:EntityDescriptor>`,
  ].join('');
}

let certA: TestCertPair;
let certB: TestCertPair;
let attackerCert: TestCertPair;
let spCertPrimary: TestCertPair;
let spCertNext: TestCertPair;

beforeAll(() => {
  certA = generateSelfSignedCertPair('idp-cert-a.corp.test');
  certB = generateSelfSignedCertPair('idp-cert-b.corp.test');
  attackerCert = generateSelfSignedCertPair('attacker.evil.test');
  spCertPrimary = generateSelfSignedCertPair('sp-primary.core.test');
  spCertNext = generateSelfSignedCertPair('sp-next.core.test');
});

function createSamlHarness(options: { samlFlagEnabled?: boolean } = {}) {
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
  featureFlagRegistry.setInstalledModules(['federated-identity']);
  featureFlagRegistry.upsertDefinition({
    id: 9002,
    key: FEDERATED_FEATURE_FLAGS.ENTERPRISE_SAML_SSO,
    module: 'federated-identity',
    name: 'Enterprise SAML SSO',
    description: 'Enterprise SAML 2.0 SSO test flag',
    isEnabled: options.samlFlagEnabled ?? true,
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
  const metrics = new MetricsRegistryService({ runtime: 'test-saml' });
  const auditLogService = new AuditLogService();
  const platformSecurity = new PlatformSecurityService();

  let providerSeq = 1;
  let identitySeq = 1;
  let txSeq = 1;
  let eventSeq = 1;
  let replaySeq = 1;
  let userSeq = 100;

  const providers = new Map<number, FederatedIdentityProviderEntity>();
  const identities = new Map<number, FederatedIdentityEntity>();
  const transactions = new Map<number, FederatedAuthTransactionEntity>();
  const replays = new Map<string, FederatedSamlAssertionReplayEntity>();
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
        (p) =>
          !p.deletedAt &&
          p.isEnabled &&
          p.status === 1 &&
          (p.driverCode === FEDERATED_DRIVER_CODE.SAML || Boolean(p.clientId?.trim())),
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
    findByNonceHash: async (nonceHash: string) =>
      [...transactions.values()].find((t) => t.nonceHash === nonceHash) ?? null,
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

  const replayRepo = {
    recordAssertionIfUnused: async (input: {
      providerCode: string;
      assertionIdHash: string;
      issuer?: string | null;
      expiresAt: Date;
      now?: Date;
    }) => {
      const key = `${input.providerCode.trim().toLowerCase()}::${input.assertionIdHash.trim()}`;
      const now = input.now ?? new Date();
      const existing = replays.get(key);
      if (existing && existing.expiresAt.getTime() > now.getTime()) {
        return false;
      }
      const entity = Object.assign(new FederatedSamlAssertionReplayEntity(), {
        id: existing?.id ?? replaySeq++,
        providerCode: input.providerCode.trim().toLowerCase(),
        assertionIdHash: input.assertionIdHash.trim(),
        issuer: input.issuer ?? null,
        expiresAt: input.expiresAt,
      });
      replays.set(key, entity);
      return true;
    },
  } as unknown as FederatedSamlAssertionReplayRepository;

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
    listPaginated: async () => ({
      data: events,
      meta: {
        page: 1,
        limit: 20,
        total: events.length,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    }),
    findEventsSince: async () => events,
  } as unknown as FederatedAuthEventRepository;

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
        lastName: input.lastName ?? 'SAML',
        fullName: input.fullName ?? 'SAML User',
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
    verifyStepUpToken: jest.fn(async () => true),
    completeExternalLogin: jest.fn(
      async (input: CompleteExternalLoginInput): Promise<LoginResponse> => {
        const u = users.get(Number(input.userId))!;
        return {
          mfaRequired: false,
          accessToken: `saml-access-${u.id}`,
          refreshToken: `saml-refresh-${u.id}`,
          sessionId: 888,
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
  } as unknown as IAuthPublicService;

  const sessionsPublicService: ISessionsPublicService = {
    recordAuthEvent: jest.fn(async () => undefined),
  } as unknown as ISessionsPublicService;

  const mockHttpClient = {
    forService: () => ({
      get: async () =>
        buildIdpMetadataXml({
          entityId: 'https://idp.corp.test/entity',
          ssoUrl: 'https://idp.corp.test/sso/saml',
          certsPem: [certA.certPem],
        }),
    }),
  } as unknown as HttpClientContract;

  const jwksService = new FederatedJwksService(mockHttpClient);
  const providerRegistry = new OAuthProviderRegistryService(
    new GoogleOAuthAdapter(mockHttpClient, jwksService),
    new MicrosoftOAuthAdapter(mockHttpClient, jwksService),
    new GenericOidcAdapter(mockHttpClient, jwksService),
    new SamlProviderAdapter(),
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
  );
  const authFlowService = new FederatedAuthFlowService(
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
    undefined,
    featureFlagRegistry,
  );
  const samlSsoService = new SamlSsoService(
    providerRepo,
    txRepo,
    replayRepo,
    providersService,
    authFlowService,
    monitoringService,
    settingRegistry,
    encryptionService,
    auditLogService,
    undefined,
    featureFlagRegistry,
    mockHttpClient,
  );
  const service = new FederatedIdentityService(
    providersService,
    authFlowService,
    monitoringService,
    samlSsoService,
  );

  return {
    service,
    samlSsoService,
    providersService,
    events,
    identities,
    users,
  };
}

describe('Section 14.2 — Enterprise SAML 2.0 SSO', () => {
  it('configures SP Entity ID & ACS URL, exports SP Metadata XML (including rotating SP certs) and imports IdP Metadata XML', async () => {
    const h = createSamlHarness();

    await h.providersService.upsertProvider('corp-saml', {
      driverCode: FEDERATED_DRIVER_CODE.SAML,
      displayName: 'Corp Okta SAML',
      isEnabled: true,
      samlConfig: {
        spEntityId: 'https://app.core.vn/saml/corp-saml/sp',
        acsUrl: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs',
        authnRequestsSigned: true,
        wantAssertionsSigned: true,
        spCertificates: [
          {
            label: 'Primary SP',
            pem: spCertPrimary.certPem,
            privateKey: spCertPrimary.privateKeyPem,
            status: SAML_CERT_STATUS.ACTIVE,
          },
          {
            label: 'Next SP',
            pem: spCertNext.certPem,
            status: SAML_CERT_STATUS.TRANSITIONING,
          },
        ],
      },
    });

    const spMetadataXml = await h.samlSsoService.getSpMetadataXml('corp-saml');
    expect(spMetadataXml).toContain('entityID="https://app.core.vn/saml/corp-saml/sp"');
    expect(spMetadataXml).toContain(
      'Location="http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs"',
    );
    expect(spMetadataXml).toContain(stripPemHeaders(spCertPrimary.certPem));
    expect(spMetadataXml).toContain(stripPemHeaders(spCertNext.certPem));

    const idpMetadataXml = buildIdpMetadataXml({
      entityId: 'https://idp.corp.test/entity',
      ssoUrl: 'https://idp.corp.test/sso/saml',
      certsPem: [certA.certPem],
    });
    const imported = await h.samlSsoService.importIdpMetadata('corp-saml', {
      metadataXml: idpMetadataXml,
    });
    expect(imported.idpEntityId).toBe('https://idp.corp.test/entity');
    expect(imported.idpSsoUrl).toBe('https://idp.corp.test/sso/saml');
    expect(imported.importedCertificatesCount).toBe(1);
    expect(imported.provider.isConfigured).toBe(true);
    // Private key must NEVER leak in provider view
    expect(
      (imported.provider.samlConfig?.spCertificates[0] as unknown as Record<string, unknown>)[
        'privateKeyEncrypted'
      ],
    ).toBeUndefined();
    expect(imported.provider.samlConfig?.spCertificates[0]?.hasPrivateKey).toBe(true);

    const publicProviders = await h.service.listPublicProviders();
    expect(publicProviders.map((p) => p.providerCode)).toContain('corp-saml');
  });

  it('rejects XXE DOCTYPE/ENTITY payloads during IdP Metadata import', async () => {
    const h = createSamlHarness();
    const maliciousXml = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x">&xxe;</md:EntityDescriptor>`;

    await expect(
      h.samlSsoService.importIdpMetadata('corp-saml', { metadataXml: maliciousXml }),
    ).rejects.toThrow(FederatedStageError);
  });

  it('completes SP-initiated SAML login via HTTP-POST hybrid redirect + single-use samlCode exchange and blocks samlCode replay', async () => {
    const h = createSamlHarness();
    await h.providersService.upsertProvider('corp-saml', {
      driverCode: FEDERATED_DRIVER_CODE.SAML,
      displayName: 'Corp SAML',
      isEnabled: true,
      samlConfig: {
        spEntityId: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/metadata',
        acsUrl: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs',
        idpEntityId: 'https://idp.corp.test/entity',
        idpSsoUrl: 'https://idp.corp.test/sso/saml',
        idpSsoBinding: SAML_BINDING.HTTP_REDIRECT,
        wantAssertionsSigned: true,
        idpCertificates: [{ pem: certA.certPem, status: SAML_CERT_STATUS.ACTIVE }],
      },
    });

    const authInit = await h.service.initiateLoginAuthorize('corp-saml', {
      redirectUri: 'http://localhost:5173/auth',
    });
    expect(authInit.driverCode).toBe('saml');
    expect(authInit.authorizationUrl).toContain('SAMLRequest=');
    expect(authInit.requestId).toBeTruthy();

    const responseXml = buildSamlResponseXml({
      inResponseTo: authInit.requestId ?? null,
      signAssertionWith: certA,
      attributes: {
        email: 'SamlUser@Corp.vn',
        firstName: 'Saml',
        lastName: 'User',
        displayName: 'Saml User',
      },
    });

    const acsOutcome = await h.samlSsoService.handleAcs(
      'corp-saml',
      {
        SAMLResponse: Buffer.from(responseXml, 'utf8').toString('base64'),
        RelayState: authInit.relayState,
      },
      { responseMode: 'redirect' },
    );

    expect(acsOutcome.mode).toBe('redirect');
    if (acsOutcome.mode !== 'redirect') throw new Error('Expected redirect');
    const redirectUrl = new URL(acsOutcome.redirectUrl);
    const samlCode = redirectUrl.searchParams.get('samlCode');
    expect(samlCode).toBeTruthy();

    const exchanged = await h.samlSsoService.exchangeSamlCode('corp-saml', {
      samlCode: samlCode!,
    });
    expect(exchanged.flowType).toBe('LOGIN');
    if (exchanged.flowType !== 'LOGIN') throw new Error('Expected LOGIN');
    expect(exchanged.isNewUser).toBe(true);
    expect(exchanged.identity.emailAtProvider).toBe('samluser@corp.vn');
    expect(exchanged.loginResult.accessToken).toContain('saml-access-');

    // Replaying samlCode must fail
    await expect(
      h.samlSsoService.exchangeSamlCode('corp-saml', { samlCode: samlCode! }),
    ).rejects.toThrow(UnauthorizedAppException);
  });

  it('rejects unsigned assertions, wrong signing certificates, embedded untrusted KeyInfo, tampered assertions and XSW attacks', async () => {
    const h = createSamlHarness();
    await h.providersService.upsertProvider('corp-saml', {
      driverCode: FEDERATED_DRIVER_CODE.SAML,
      isEnabled: true,
      samlConfig: {
        spEntityId: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/metadata',
        acsUrl: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs',
        idpEntityId: 'https://idp.corp.test/entity',
        idpSsoUrl: 'https://idp.corp.test/sso/saml',
        allowIdpInitiated: true,
        wantAssertionsSigned: true,
        idpCertificates: [{ pem: certA.certPem, status: SAML_CERT_STATUS.ACTIVE }],
      },
    });

    // 1. Unsigned assertion
    const unsignedXml = buildSamlResponseXml({ signAssertionWith: null });
    await expect(
      h.samlSsoService.handleAcs(
        'corp-saml',
        { SAMLResponse: Buffer.from(unsignedXml, 'utf8').toString('base64') },
        { responseMode: 'json' },
      ),
    ).rejects.toThrow(FederatedStageError);

    // 2. Signed by attacker cert (with attacker's cert embedded in KeyInfo!)
    const attackerXml = buildSamlResponseXml({
      signAssertionWith: attackerCert,
      embedUntrustedKeyInfo: attackerCert,
    });
    await expect(
      h.samlSsoService.handleAcs(
        'corp-saml',
        { SAMLResponse: Buffer.from(attackerXml, 'utf8').toString('base64') },
        { responseMode: 'json' },
      ),
    ).rejects.toThrow(FederatedStageError);

    // 3. Tampered email attribute after signing
    const signedXml = buildSamlResponseXml({
      signAssertionWith: certA,
      attributes: { email: 'legit@corp.vn' },
    });
    const tamperedXml = signedXml.replace('legit@corp.vn', 'admin@corp.vn');
    await expect(
      h.samlSsoService.handleAcs(
        'corp-saml',
        { SAMLResponse: Buffer.from(tamperedXml, 'utf8').toString('base64') },
        { responseMode: 'json' },
      ),
    ).rejects.toThrow(FederatedStageError);

    // 4. XSW: second unsigned Assertion injected with duplicate ID
    const xswXml = signedXml.replace(
      '</samlp:Response>',
      '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_evil"><saml:Issuer>https://idp.corp.test/entity</saml:Issuer></saml:Assertion></samlp:Response>',
    );
    await expect(
      h.samlSsoService.handleAcs(
        'corp-saml',
        { SAMLResponse: Buffer.from(xswXml, 'utf8').toString('base64') },
        { responseMode: 'json' },
      ),
    ).rejects.toThrow(FederatedStageError);
  });

  it('validates Audience, Issuer, Destination, NotBefore/NotOnOrAfter and prevents Assertion ID replay', async () => {
    const h = createSamlHarness();
    await h.providersService.upsertProvider('corp-saml', {
      driverCode: FEDERATED_DRIVER_CODE.SAML,
      isEnabled: true,
      samlConfig: {
        spEntityId: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/metadata',
        acsUrl: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs',
        idpEntityId: 'https://idp.corp.test/entity',
        idpSsoUrl: 'https://idp.corp.test/sso/saml',
        allowIdpInitiated: true,
        clockSkewSeconds: 30,
        idpCertificates: [{ pem: certA.certPem, status: SAML_CERT_STATUS.ACTIVE }],
      },
    });

    const badCases = [
      buildSamlResponseXml({ signAssertionWith: certA, audience: 'https://wrong-sp.example.com' }),
      buildSamlResponseXml({ signAssertionWith: certA, issuer: 'https://wrong-idp.example.com' }),
      buildSamlResponseXml({
        signAssertionWith: certA,
        destination: 'https://wrong.example.com/acs',
      }),
      buildSamlResponseXml({
        signAssertionWith: certA,
        notOnOrAfter: new Date(Date.now() - 120_000),
      }),
      buildSamlResponseXml({
        signAssertionWith: certA,
        notBefore: new Date(Date.now() + 120_000),
      }),
    ];

    for (const badXml of badCases) {
      await expect(
        h.samlSsoService.handleAcs(
          'corp-saml',
          { SAMLResponse: Buffer.from(badXml, 'utf8').toString('base64') },
          { responseMode: 'json' },
        ),
      ).rejects.toThrow(FederatedStageError);
    }

    // Valid assertion succeeds once, then replay with same Assertion ID is blocked
    const replayableXml = buildSamlResponseXml({
      assertionId: '_unique_assertion_12345',
      signAssertionWith: certA,
    });
    const b64 = Buffer.from(replayableXml, 'utf8').toString('base64');
    const first = await h.samlSsoService.handleAcs(
      'corp-saml',
      { SAMLResponse: b64 },
      { responseMode: 'json' },
    );
    expect(first.mode).toBe('json');

    await expect(
      h.samlSsoService.handleAcs('corp-saml', { SAMLResponse: b64 }, { responseMode: 'json' }),
    ).rejects.toMatchObject({ stageErrorCode: 'SAML_ASSERTION_REPLAY' });
  });

  it('validates mapped SAML attributes (email format & required attributes)', async () => {
    const h = createSamlHarness();
    await h.providersService.upsertProvider('corp-saml', {
      driverCode: FEDERATED_DRIVER_CODE.SAML,
      isEnabled: true,
      samlConfig: {
        spEntityId: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/metadata',
        acsUrl: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs',
        idpEntityId: 'https://idp.corp.test/entity',
        idpSsoUrl: 'https://idp.corp.test/sso/saml',
        allowIdpInitiated: true,
        idpCertificates: [{ pem: certA.certPem, status: SAML_CERT_STATUS.ACTIVE }],
        attributeMapping: {
          emailAttribute: 'workEmail',
          requireEmail: true,
          requiredAttributes: ['department'],
        },
      },
    });

    // Missing required 'department' attribute
    const missingDeptXml = buildSamlResponseXml({
      signAssertionWith: certA,
      attributes: { workEmail: 'dev@corp.vn' },
    });
    await expect(
      h.samlSsoService.handleAcs(
        'corp-saml',
        { SAMLResponse: Buffer.from(missingDeptXml, 'utf8').toString('base64') },
        { responseMode: 'json' },
      ),
    ).rejects.toMatchObject({ stageErrorCode: 'SAML_ATTRIBUTE_VALIDATION_FAILED' });

    // Invalid email format
    const invalidEmailXml = buildSamlResponseXml({
      signAssertionWith: certA,
      attributes: { workEmail: 'not-an-email', department: 'Engineering' },
    });
    await expect(
      h.samlSsoService.handleAcs(
        'corp-saml',
        { SAMLResponse: Buffer.from(invalidEmailXml, 'utf8').toString('base64') },
        { responseMode: 'json' },
      ),
    ).rejects.toMatchObject({ stageErrorCode: 'SAML_ATTRIBUTE_VALIDATION_FAILED' });
  });

  it('supports IdP Certificate Rotation with transition grace window and rejects revoked/expired-grace certs', async () => {
    const h = createSamlHarness();

    // Start with Cert A
    await h.samlSsoService.importIdpMetadata('corp-saml', {
      metadataXml: buildIdpMetadataXml({
        entityId: 'https://idp.corp.test/entity',
        ssoUrl: 'https://idp.corp.test/sso/saml',
        certsPem: [certA.certPem],
      }),
    });
    await h.providersService.upsertProvider('corp-saml', {
      driverCode: FEDERATED_DRIVER_CODE.SAML,
      isEnabled: true,
      samlConfig: {
        spEntityId: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/metadata',
        acsUrl: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs',
        allowIdpInitiated: true,
      },
    });

    // Rotate IdP metadata to Cert B while keeping Cert A in TRANSITIONING grace window
    const rotated = await h.samlSsoService.importIdpMetadata('corp-saml', {
      metadataXml: buildIdpMetadataXml({
        entityId: 'https://idp.corp.test/entity',
        ssoUrl: 'https://idp.corp.test/sso/saml',
        certsPem: [certB.certPem],
      }),
      mergeCertificates: true,
      transitionGraceDays: 7,
    });
    expect(rotated.transitionedCertificatesCount).toBe(1);
    expect(rotated.activeCertificatesCount).toBe(1);

    // Both Cert A (TRANSITIONING) and Cert B (ACTIVE) verify cleanly during grace period
    const signedByA = buildSamlResponseXml({
      signAssertionWith: certA,
      nameId: 'a@corp.vn',
      attributes: { email: 'a@corp.vn' },
    });
    const signedByB = buildSamlResponseXml({
      signAssertionWith: certB,
      nameId: 'b@corp.vn',
      attributes: { email: 'b@corp.vn' },
    });

    const resA = await h.samlSsoService.handleAcs(
      'corp-saml',
      { SAMLResponse: Buffer.from(signedByA, 'utf8').toString('base64') },
      { responseMode: 'json' },
    );
    const resB = await h.samlSsoService.handleAcs(
      'corp-saml',
      { SAMLResponse: Buffer.from(signedByB, 'utf8').toString('base64') },
      { responseMode: 'json' },
    );
    expect(resA.mode).toBe('json');
    expect(resB.mode).toBe('json');

    // After grace window passes, verifySamlXmlSignature rejects Cert A while still accepting Cert B
    const afterGraceNow = new Date(Date.now() + 8 * 86_400_000);
    const certs = rotated.provider.samlConfig!.idpCertificates;
    expect(() =>
      verifySamlXmlSignature({
        xml: signedByA,
        idpCertificates: certs,
        wantAssertionsSigned: true,
        now: afterGraceNow,
      }),
    ).toThrow(FederatedStageError);

    const verifiedB = verifySamlXmlSignature({
      xml: signedByB,
      idpCertificates: certs,
      wantAssertionsSigned: true,
      now: afterGraceNow,
    });
    expect(verifiedB.certStatus).toBe(SAML_CERT_STATUS.ACTIVE);
  });

  it('logs SAML errors safely without leaking raw Assertion XML or sensitive Signature/Cert payloads', async () => {
    const h = createSamlHarness();
    await h.providersService.upsertProvider('corp-saml', {
      driverCode: FEDERATED_DRIVER_CODE.SAML,
      isEnabled: true,
      samlConfig: {
        spEntityId: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/metadata',
        acsUrl: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs',
        idpEntityId: 'https://idp.corp.test/entity',
        idpSsoUrl: 'https://idp.corp.test/sso/saml',
        allowIdpInitiated: true,
        idpCertificates: [{ pem: certA.certPem, status: SAML_CERT_STATUS.ACTIVE }],
      },
    });

    const secretXml = buildSamlResponseXml({
      assertionId: '_sensitive_assert_id_999',
      signAssertionWith: attackerCert,
      attributes: { email: 'secret.ceo@corp.vn', ssn: 'SECRET_PII_TOKEN' },
    });

    await expect(
      h.samlSsoService.handleAcs(
        'corp-saml',
        { SAMLResponse: Buffer.from(secretXml, 'utf8').toString('base64') },
        { responseMode: 'json' },
      ),
    ).rejects.toThrow(FederatedStageError);

    expect(h.events.length).toBeGreaterThan(0);
    const serializedEvents = JSON.stringify(h.events);
    expect(serializedEvents).not.toContain('<saml:Assertion');
    expect(serializedEvents).not.toContain('SignatureValue');
    expect(serializedEvents).not.toContain('SECRET_PII_TOKEN');
    expect(serializedEvents).not.toContain('secret.ceo@corp.vn');
    expect(h.events[0]?.errorCode).toBe('SAML_INVALID_SIGNATURE');
  });

  it('blocks SAML SSO when enterprise_saml_sso feature flag is disabled (optional project gate)', async () => {
    const h = createSamlHarness({ samlFlagEnabled: false });
    await h.providersService.upsertProvider('corp-saml', {
      driverCode: FEDERATED_DRIVER_CODE.SAML,
      isEnabled: true,
      samlConfig: {
        spEntityId: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/metadata',
        acsUrl: 'http://localhost:3000/api/v1/federated-identity/saml/corp-saml/acs',
        idpEntityId: 'https://idp.corp.test/entity',
        idpSsoUrl: 'https://idp.corp.test/sso/saml',
        idpCertificates: [{ pem: certA.certPem, status: SAML_CERT_STATUS.ACTIVE }],
      },
    });

    await expect(
      h.service.initiateLoginAuthorize('corp-saml', {
        redirectUri: 'http://localhost:5173/auth',
      }),
    ).rejects.toThrow(ForbiddenAppException);
    expect(h.events[0]?.errorCode).toBe('ENTERPRISE_SAML_DISABLED');
  });
});
