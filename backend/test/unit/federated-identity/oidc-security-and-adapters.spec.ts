import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';
import { HttpStatusError, type HttpClientContract } from '@packages/http-client/index.js';
import { BadRequestAppException } from '@packages/kernel/index.js';
import { GoogleOAuthAdapter } from '../../../src/modules/federated-identity/adapters/google-oauth.adapter.js';
import { MicrosoftOAuthAdapter } from '../../../src/modules/federated-identity/adapters/microsoft-oauth.adapter.js';
import { FEDERATED_AUTH_STAGE } from '../../../src/modules/federated-identity/enum/federated-identity.enum.js';
import {
  type OidcJwk,
  type OidcJwksDocument,
  OidcTokenVerificationError,
  verifyOidcIdToken,
} from '../../../src/modules/federated-identity/helpers/oidc-jwt-verifier.helper.js';
import {
  assertRedirectUriAllowed,
  generatePkcePair,
  sha256Hex,
} from '../../../src/modules/federated-identity/helpers/pkce-and-state.helper.js';
import {
  FederatedJwksService,
  FederatedStageError,
} from '../../../src/modules/federated-identity/services/federated-jwks.service.js';
import type { OAuthAdapterResolvedConfig } from '../../../src/modules/federated-identity/types/federated-identity.types.js';

function signJwtWithPrivateKey(params: {
  readonly alg: 'RS256' | 'ES256' | 'none' | 'HS256';
  readonly kid?: string;
  readonly payload: Record<string, unknown>;
  readonly privateKeyPem?: string;
}): string {
  const header = {
    typ: 'JWT',
    alg: params.alg,
    ...(params.kid ? { kid: params.kid } : {}),
  };
  const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(params.payload), 'utf8').toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  if (params.alg === 'none') {
    return `${signingInput}.`;
  }
  if (params.alg === 'HS256') {
    const fakeSig = Buffer.from('hs256-signature', 'utf8').toString('base64url');
    return `${signingInput}.${fakeSig}`;
  }

  const sigBuf =
    params.alg === 'ES256'
      ? sign('sha256', Buffer.from(signingInput, 'ascii'), {
          key: params.privateKeyPem!,
          dsaEncoding: 'ieee-p1363',
        })
      : sign('RSA-SHA256', Buffer.from(signingInput, 'ascii'), params.privateKeyPem!);

  return `${signingInput}.${sigBuf.toString('base64url')}`;
}

function createRsaKey(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as OidcJwk;
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    kid,
    jwk: { ...jwk, kid, use: 'sig', alg: 'RS256' } as OidcJwk,
    privatePem,
  };
}

function createEcKey(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as OidcJwk;
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    kid,
    jwk: { ...jwk, kid, use: 'sig', alg: 'ES256' } as OidcJwk,
    privatePem,
  };
}

describe('OIDC Security Helpers & OAuth Provider Adapters', () => {
  describe('PKCE & Redirect URI Allowlist', () => {
    it('generates S256 PKCE codeVerifier and matching SHA-256 base64url challenge', () => {
      const pkce = generatePkcePair();
      expect(pkce.codeChallengeMethod).toBe('S256');
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);

      const expected = createHash('sha256').update(pkce.codeVerifier, 'ascii').digest('base64url');
      expect(pkce.codeChallenge).toBe(expected);
    });

    it('enforces exact redirectUri allowlist and rejects fragments or open redirects', () => {
      const globalList = ['http://localhost:5173/auth', 'https://app.example.com/oauth/callback'];
      expect(assertRedirectUriAllowed('http://localhost:5173/auth', [], globalList)).toBe(
        'http://localhost:5173/auth',
      );

      expect(() =>
        assertRedirectUriAllowed('https://evil.example.com/steal', [], globalList),
      ).toThrow(BadRequestAppException);
      expect(() =>
        assertRedirectUriAllowed('http://localhost:5173/auth#fragment', [], globalList),
      ).toThrow(BadRequestAppException);
      expect(() => assertRedirectUriAllowed('javascript:alert(1)', [], globalList)).toThrow(
        BadRequestAppException,
      );

      // Provider-specific allowlist overrides global allowlist when non-empty
      expect(
        assertRedirectUriAllowed(
          'https://tenant.example.com/cb',
          ['https://tenant.example.com/cb'],
          globalList,
        ),
      ).toBe('https://tenant.example.com/cb');
      expect(() =>
        assertRedirectUriAllowed(
          'http://localhost:5173/auth',
          ['https://tenant.example.com/cb'],
          globalList,
        ),
      ).toThrow(BadRequestAppException);
    });
  });

  describe('verifyOidcIdToken (JWKS RS256 / ES256 & Claims)', () => {
    const rsa1 = createRsaKey('rsa-key-1');
    const rsa2 = createRsaKey('rsa-key-2');
    const ec1 = createEcKey('ec-key-1');
    const jwks: OidcJwksDocument = { keys: [rsa1.jwk, ec1.jwk] };
    const nowSec = Math.floor(Date.now() / 1000);
    const nonce = 'nonce-value-12345';
    const expectedNonceHash = sha256Hex(nonce);

    it('verifies valid RS256 and ES256 ID tokens', async () => {
      const rsToken = signJwtWithPrivateKey({
        alg: 'RS256',
        kid: rsa1.kid,
        privateKeyPem: rsa1.privatePem,
        payload: {
          iss: 'https://accounts.google.com',
          aud: 'client-1',
          sub: 'google-sub-999',
          nonce,
          iat: nowSec,
          exp: nowSec + 300,
        },
      });
      const rsClaims = await verifyOidcIdToken({
        idToken: rsToken,
        initialJwks: jwks,
        expectedAudience: 'client-1',
        expectedNonceHash,
        validateIssuer: (iss) => iss === 'https://accounts.google.com',
      });
      expect(rsClaims['sub']).toBe('google-sub-999');

      const ecToken = signJwtWithPrivateKey({
        alg: 'ES256',
        kid: ec1.kid,
        privateKeyPem: ec1.privatePem,
        payload: {
          iss: 'https://accounts.google.com',
          aud: 'client-1',
          sub: 'ec-sub-123',
          nonce,
          iat: nowSec,
          exp: nowSec + 300,
        },
      });
      const ecClaims = await verifyOidcIdToken({
        idToken: ecToken,
        initialJwks: jwks,
        expectedAudience: 'client-1',
        expectedNonceHash,
        validateIssuer: (iss) => iss === 'https://accounts.google.com',
      });
      expect(ecClaims['sub']).toBe('ec-sub-123');
    });

    it('refreshes JWKS on key rotation when kid is not found initially', async () => {
      const rotatedToken = signJwtWithPrivateKey({
        alg: 'RS256',
        kid: rsa2.kid,
        privateKeyPem: rsa2.privatePem,
        payload: {
          iss: 'https://accounts.google.com',
          aud: 'client-1',
          sub: 'rotated-sub',
          nonce,
          exp: nowSec + 300,
        },
      });

      const refreshMock = jest.fn(async () => ({ keys: [rsa1.jwk, rsa2.jwk] }));
      const claims = await verifyOidcIdToken({
        idToken: rotatedToken,
        initialJwks: jwks,
        refreshJwks: refreshMock,
        expectedAudience: 'client-1',
        expectedNonceHash,
        validateIssuer: (iss) => iss === 'https://accounts.google.com',
      });
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(claims['sub']).toBe('rotated-sub');
    });

    it('rejects alg=none, alg=HS256, wrong signature, expired token, wrong aud/iss/nonce', async () => {
      const basePayload = {
        iss: 'https://accounts.google.com',
        aud: 'client-1',
        sub: 'user-1',
        nonce,
        exp: nowSec + 300,
      };

      const noneJwt = signJwtWithPrivateKey({ alg: 'none', kid: rsa1.kid, payload: basePayload });
      await expect(
        verifyOidcIdToken({
          idToken: noneJwt,
          initialJwks: jwks,
          expectedAudience: 'client-1',
          expectedNonceHash,
          validateIssuer: () => true,
        }),
      ).rejects.toThrow(OidcTokenVerificationError);

      const hsJwt = signJwtWithPrivateKey({ alg: 'HS256', kid: rsa1.kid, payload: basePayload });
      await expect(
        verifyOidcIdToken({
          idToken: hsJwt,
          initialJwks: jwks,
          expectedAudience: 'client-1',
          expectedNonceHash,
          validateIssuer: () => true,
        }),
      ).rejects.toThrow(OidcTokenVerificationError);

      // Signed by rsa2 but claims kid of rsa1
      const forgedJwt = signJwtWithPrivateKey({
        alg: 'RS256',
        kid: rsa1.kid,
        privateKeyPem: rsa2.privatePem,
        payload: basePayload,
      });
      await expect(
        verifyOidcIdToken({
          idToken: forgedJwt,
          initialJwks: jwks,
          expectedAudience: 'client-1',
          expectedNonceHash,
          validateIssuer: () => true,
        }),
      ).rejects.toThrow(OidcTokenVerificationError);

      // Expired
      const expiredJwt = signJwtWithPrivateKey({
        alg: 'RS256',
        kid: rsa1.kid,
        privateKeyPem: rsa1.privatePem,
        payload: { ...basePayload, exp: nowSec - 120 },
      });
      await expect(
        verifyOidcIdToken({
          idToken: expiredJwt,
          initialJwks: jwks,
          expectedAudience: 'client-1',
          expectedNonceHash,
          validateIssuer: () => true,
        }),
      ).rejects.toThrow(OidcTokenVerificationError);

      // Wrong nonce
      const wrongNonceJwt = signJwtWithPrivateKey({
        alg: 'RS256',
        kid: rsa1.kid,
        privateKeyPem: rsa1.privatePem,
        payload: { ...basePayload, nonce: 'attacker-nonce' },
      });
      await expect(
        verifyOidcIdToken({
          idToken: wrongNonceJwt,
          initialJwks: jwks,
          expectedAudience: 'client-1',
          expectedNonceHash,
          validateIssuer: () => true,
        }),
      ).rejects.toThrow('federated-identity.nonceMismatch');
    });
  });

  describe('Google & Microsoft OAuth Adapters', () => {
    const rsa = createRsaKey('provider-k1');
    const nowSec = Math.floor(Date.now() / 1000);
    const nonce = 'adapter-nonce-1';
    const expectedNonceHash = sha256Hex(nonce);

    it('GoogleOAuthAdapter exchanges PKCE code and maps verified Google profile', async () => {
      const idToken = signJwtWithPrivateKey({
        alg: 'RS256',
        kid: rsa.kid,
        privateKeyPem: rsa.privatePem,
        payload: {
          iss: 'accounts.google.com',
          aud: 'google-client-id',
          sub: '112233445566778899',
          nonce,
          email: 'Alice@Example.com',
          email_verified: true,
          given_name: 'Alice',
          family_name: 'Nguyen',
          name: 'Nguyen Alice',
          picture: 'https://lh3.googleusercontent.com/avatar.png',
          exp: nowSec + 300,
        },
      });

      const postMock = jest.fn(async () => ({ id_token: idToken, access_token: 'opaque' }));
      const getMock = jest.fn(async () => ({ keys: [rsa.jwk] }));
      const mockHttpClient = {
        forService: () => ({
          get: getMock,
          post: postMock,
        }),
      } as unknown as HttpClientContract;

      const jwksService = new FederatedJwksService(mockHttpClient);
      const adapter = new GoogleOAuthAdapter(mockHttpClient, jwksService);

      const config: OAuthAdapterResolvedConfig = {
        providerCode: 'google',
        driverCode: 'google',
        clientId: 'google-client-id',
        clientSecret: 'google-secret',
        tenantId: null,
        issuerUrl: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        jwksUri: null,
        userinfoEndpoint: null,
        scopes: [],
        extraConfig: {},
      };

      const authUrl = new URL(
        adapter.buildAuthorizationUrl({
          config,
          redirectUri: 'http://localhost:5173/auth',
          state: 'st-123',
          nonce,
          codeChallenge: 'chal-123',
        }),
      );
      expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authUrl.searchParams.get('nonce')).toBe(nonce);

      const profile = await adapter.exchangeCodeAndVerify({
        config,
        code: 'auth-code-abc',
        redirectUri: 'http://localhost:5173/auth',
        codeVerifier: 'verifier-xyz',
        expectedNonceHash,
        jwksCacheTtlSeconds: 600,
      });

      expect(profile.issuer).toBe('https://accounts.google.com');
      expect(profile.subject).toBe('112233445566778899');
      expect(profile.email).toBe('alice@example.com');
      expect(profile.emailVerified).toBe(true);
      expect(profile.firstName).toBe('Alice');
      expect(profile.lastName).toBe('Nguyen');
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it('GoogleOAuthAdapter maps HttpStatusError into FederatedStageError with providerError', async () => {
      const mockHttpClient = {
        forService: () => ({
          post: async () => {
            throw new HttpStatusError({
              service: 'oauth-google',
              method: 'POST',
              url: 'https://oauth2.googleapis.com/token',
              status: 400,
              retryable: false,
              durationMs: 42,
              attempts: 1,
              responseSnippet: JSON.stringify({
                error: 'invalid_grant',
                error_description: 'Code was already redeemed.',
              }),
            });
          },
        }),
      } as unknown as HttpClientContract;

      const adapter = new GoogleOAuthAdapter(
        mockHttpClient,
        new FederatedJwksService(mockHttpClient),
      );
      const config: OAuthAdapterResolvedConfig = {
        providerCode: 'google',
        driverCode: 'google',
        clientId: 'cid',
        clientSecret: 'csec',
        tenantId: null,
        issuerUrl: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        jwksUri: null,
        userinfoEndpoint: null,
        scopes: [],
        extraConfig: {},
      };

      await expect(
        adapter.exchangeCodeAndVerify({
          config,
          code: 'reused-code',
          redirectUri: 'http://localhost:5173/auth',
          codeVerifier: 'verifier',
          expectedNonceHash,
          jwksCacheTtlSeconds: 600,
        }),
      ).rejects.toMatchObject({
        stage: FEDERATED_AUTH_STAGE.TOKEN_EXCHANGE,
        httpStatus: 400,
        providerError: 'invalid_grant',
      } satisfies Partial<FederatedStageError>);
    });

    it('MicrosoftOAuthAdapter enforces tenant issuer rules in multi-tenant and single-tenant modes', async () => {
      const tid = '72f988bf-86f1-41af-91ab-2d7cd011db47';
      const msToken = signJwtWithPrivateKey({
        alg: 'RS256',
        kid: rsa.kid,
        privateKeyPem: rsa.privatePem,
        payload: {
          iss: `https://login.microsoftonline.com/${tid}/v2.0`,
          aud: 'ms-client-id',
          sub: 'pairwise-ms-sub-001',
          tid,
          nonce,
          preferred_username: 'Bob@Contoso.com',
          xms_edov: true,
          name: 'Bob Tran',
          exp: nowSec + 300,
        },
      });

      const mockHttpClient = {
        forService: () => ({
          post: async () => ({ id_token: msToken }),
          get: async () => ({ keys: [rsa.jwk] }),
        }),
      } as unknown as HttpClientContract;

      const adapter = new MicrosoftOAuthAdapter(
        mockHttpClient,
        new FederatedJwksService(mockHttpClient),
      );

      // Multi-tenant 'common' matches iss with tid
      const commonConfig: OAuthAdapterResolvedConfig = {
        providerCode: 'microsoft',
        driverCode: 'microsoft',
        clientId: 'ms-client-id',
        clientSecret: 'ms-secret',
        tenantId: 'common',
        issuerUrl: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        jwksUri: null,
        userinfoEndpoint: null,
        scopes: [],
        extraConfig: {},
      };

      const profile = await adapter.exchangeCodeAndVerify({
        config: commonConfig,
        code: 'ms-code',
        redirectUri: 'http://localhost:5173/auth',
        codeVerifier: 'verifier',
        expectedNonceHash,
        jwksCacheTtlSeconds: 600,
      });

      expect(profile.subject).toBe('pairwise-ms-sub-001');
      expect(profile.tenantId).toBe(tid);
      expect(profile.email).toBe('bob@contoso.com');
      expect(profile.emailVerified).toBe(true);

      // Single-tenant config rejects token from another tenant
      const wrongSingleTenantConfig: OAuthAdapterResolvedConfig = {
        ...commonConfig,
        tenantId: 'other-tenant-999',
      };
      await expect(
        adapter.exchangeCodeAndVerify({
          config: wrongSingleTenantConfig,
          code: 'ms-code',
          redirectUri: 'http://localhost:5173/auth',
          codeVerifier: 'verifier',
          expectedNonceHash,
          jwksCacheTtlSeconds: 600,
        }),
      ).rejects.toThrow(FederatedStageError);
    });
  });
});
