import {
  BaseHttpClientProvider,
  type HttpClientContract,
  HttpClientError,
} from '@packages/http-client/index.js';
import { safeJsonParseObject } from '@packages/kernel/index.js';
import type { IOAuthProviderAdapter } from '../contracts/index.js';
import { FEDERATED_AUTH_STAGE } from '../enum/federated-identity.enum.js';
import {
  OidcTokenVerificationError,
  verifyOidcIdToken,
} from '../helpers/oidc-jwt-verifier.helper.js';
import { sanitizeFederatedErrorMessage } from '../helpers/federated-redaction.helper.js';
import { FederatedJwksService, FederatedStageError } from '../services/federated-jwks.service.js';
import type {
  FederatedDriverMetadata,
  OAuthAdapterResolvedConfig,
  TestProviderConnectionResult,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';

export interface OidcTokenResponse {
  readonly id_token?: string | undefined;
  readonly access_token?: string | undefined;
  readonly token_type?: string | undefined;
  readonly expires_in?: number | undefined;
  readonly error?: string | undefined;
  readonly error_description?: string | undefined;
}

export abstract class BaseOidcOAuthAdapter implements IOAuthProviderAdapter {
  public abstract readonly driverCode: string;

  protected constructor(
    protected readonly httpClient: HttpClientContract = new BaseHttpClientProvider(),
    protected readonly jwksService: FederatedJwksService = new FederatedJwksService(httpClient),
  ) {}

  public abstract getMetadata(): FederatedDriverMetadata;

  public abstract resolveEndpoints(config: OAuthAdapterResolvedConfig): {
    readonly issuerUrl: string;
    readonly authorizationEndpoint: string;
    readonly tokenEndpoint: string;
    readonly jwksUri: string;
    readonly userinfoEndpoint: string | null;
    readonly scopes: readonly string[];
  };

  protected getExtraAuthorizeParams(): Record<string, string> {
    return {};
  }

  protected abstract validateIssuerClaim(
    issuer: string,
    claims: Record<string, unknown>,
    config: OAuthAdapterResolvedConfig,
    resolvedIssuer: string,
  ): boolean;

  protected abstract mapVerifiedClaimsToProfile(params: {
    readonly claims: Record<string, unknown>;
    readonly config: OAuthAdapterResolvedConfig;
    readonly resolvedIssuer: string;
  }): VerifiedExternalProfile;

  public buildAuthorizationUrl(params: {
    readonly config: OAuthAdapterResolvedConfig;
    readonly redirectUri: string;
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
    readonly loginHint?: string | undefined;
  }): string {
    const endpoints = this.resolveEndpoints(params.config);
    const url = new URL(endpoints.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.config.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', endpoints.scopes.join(' '));
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (params.loginHint?.trim()) {
      url.searchParams.set('login_hint', params.loginHint.trim());
    }
    for (const [k, v] of Object.entries(this.getExtraAuthorizeParams())) {
      url.searchParams.set(k, v);
    }
    return url.toString();
  }

  public async exchangeCodeAndVerify(params: {
    readonly config: OAuthAdapterResolvedConfig;
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
    readonly expectedNonceHash: string;
    readonly jwksCacheTtlSeconds: number;
  }): Promise<VerifiedExternalProfile> {
    const { config } = params;
    const endpoints = this.resolveEndpoints(config);
    const serviceName = `oauth-${this.driverCode}`;

    const formBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: params.codeVerifier,
    });

    let tokenResponse: OidcTokenResponse;
    try {
      tokenResponse = await this.httpClient
        .forService(serviceName)
        .post<OidcTokenResponse, URLSearchParams>(endpoints.tokenEndpoint, formBody, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        });
    } catch (err) {
      if (err instanceof FederatedStageError) throw err;
      const httpStatus = err instanceof HttpClientError ? err.status : null;
      const snippetObj =
        err instanceof HttpClientError && err.responseSnippet
          ? safeJsonParseObject<{ error?: string; error_description?: string }>(
              err.responseSnippet,
              {},
            )
          : {};
      throw new FederatedStageError({
        i18nKey: 'federated-identity.tokenExchangeFailed',
        stage: FEDERATED_AUTH_STAGE.TOKEN_EXCHANGE,
        stageErrorCode: err instanceof HttpClientError ? err.code : 'TOKEN_EXCHANGE_FAILED',
        providerError: typeof snippetObj.error === 'string' ? snippetObj.error : null,
        httpStatus,
        diagnosticMessage:
          typeof snippetObj.error_description === 'string'
            ? snippetObj.error_description
            : err instanceof Error
              ? err.message
              : String(err),
      });
    }

    if (!tokenResponse || tokenResponse.error || !tokenResponse.id_token) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.tokenExchangeFailed',
        stage: FEDERATED_AUTH_STAGE.TOKEN_EXCHANGE,
        stageErrorCode: tokenResponse?.error ? 'PROVIDER_TOKEN_ERROR' : 'MISSING_ID_TOKEN',
        providerError: tokenResponse?.error ?? null,
        diagnosticMessage:
          tokenResponse?.error_description ??
          (tokenResponse?.error
            ? `Provider returned error: ${tokenResponse.error}`
            : 'Token endpoint response did not contain id_token'),
      });
    }

    const initialJwks = await this.jwksService.getJwks(
      serviceName,
      endpoints.jwksUri,
      params.jwksCacheTtlSeconds,
      false,
    );

    let claims: Record<string, unknown>;
    try {
      claims = await verifyOidcIdToken({
        idToken: tokenResponse.id_token,
        initialJwks,
        refreshJwks: () =>
          this.jwksService.getJwks(
            serviceName,
            endpoints.jwksUri,
            params.jwksCacheTtlSeconds,
            true,
          ),
        expectedAudience: config.clientId,
        expectedNonceHash: params.expectedNonceHash,
        validateIssuer: (iss, payload) =>
          this.validateIssuerClaim(iss, payload, config, endpoints.issuerUrl),
      });
    } catch (err) {
      if (err instanceof FederatedStageError) throw err;
      if (err instanceof OidcTokenVerificationError) {
        const i18nKey =
          err.reasonCode === 'nonce_mismatch' || err.reasonCode === 'missing_nonce'
            ? 'federated-identity.nonceMismatch'
            : err.reasonCode === 'missing_subject'
              ? 'federated-identity.missingSubject'
              : 'federated-identity.invalidIdToken';
        throw new FederatedStageError({
          i18nKey,
          stage: FEDERATED_AUTH_STAGE.ID_TOKEN_VERIFY,
          stageErrorCode: err.reasonCode.toUpperCase(),
          diagnosticMessage: err.reasonCode,
        });
      }
      throw new FederatedStageError({
        i18nKey: 'federated-identity.invalidIdToken',
        stage: FEDERATED_AUTH_STAGE.ID_TOKEN_VERIFY,
        stageErrorCode: 'ID_TOKEN_VERIFY_FAILED',
        diagnosticMessage: err instanceof Error ? err.message : String(err),
      });
    }

    return this.mapVerifiedClaimsToProfile({
      claims,
      config,
      resolvedIssuer: endpoints.issuerUrl,
    });
  }

  public async testConnection(params: {
    readonly config: OAuthAdapterResolvedConfig;
    readonly jwksCacheTtlSeconds: number;
  }): Promise<TestProviderConnectionResult> {
    const startMs = Date.now();
    const endpoints = this.resolveEndpoints(params.config);
    const configured = Boolean(params.config.clientId.trim() && params.config.clientSecret.trim());
    const serviceName = `oauth-${this.driverCode}`;

    try {
      const doc = await this.jwksService.getJwks(
        serviceName,
        endpoints.jwksUri,
        params.jwksCacheTtlSeconds,
        true,
      );
      return {
        providerCode: params.config.providerCode,
        driverCode: this.driverCode,
        ok: configured,
        configured,
        jwksUri: endpoints.jwksUri,
        keyCount: doc.keys.length,
        durationMs: Date.now() - startMs,
        errorCode: configured ? null : 'MISSING_CLIENT_CREDENTIALS',
        errorMessage: configured ? null : 'Client ID or Client Secret is not configured',
      };
    } catch (err) {
      const errorCode =
        err instanceof FederatedStageError ? err.stageErrorCode : 'CONNECTION_TEST_FAILED';
      const errorMessage =
        err instanceof FederatedStageError
          ? err.diagnosticMessage
          : sanitizeFederatedErrorMessage(err instanceof Error ? err.message : String(err));
      return {
        providerCode: params.config.providerCode,
        driverCode: this.driverCode,
        ok: false,
        configured,
        jwksUri: endpoints.jwksUri,
        keyCount: 0,
        durationMs: Date.now() - startMs,
        errorCode,
        errorMessage,
      };
    }
  }
}
