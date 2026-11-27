import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  type HttpClientContract,
} from '@packages/http-client/index.js';
import {
  FEDERATED_AUTH_STAGE,
  FEDERATED_DRIVER_CODE,
  GENERIC_OIDC_DEFAULTS,
} from '../enum/federated-identity.enum.js';
import {
  mapOidcClaimsWithConfig,
  normalizeIssuerUrl,
  parseFederatedExtraConfig,
} from '../helpers/oidc-claim-mapping.helper.js';
import { FederatedJwksService, FederatedStageError } from '../services/federated-jwks.service.js';
import { OidcDiscoveryService } from '../services/oidc-discovery.service.js';
import type {
  FederatedDriverMetadata,
  OAuthAdapterResolvedConfig,
  OidcResolvedEndpoints,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';
import { BaseOidcOAuthAdapter } from './base-oidc.adapter.js';

@Injectable()
export class GenericOidcAdapter extends BaseOidcOAuthAdapter {
  public readonly driverCode = FEDERATED_DRIVER_CODE.OIDC;
  private readonly discoveryService: OidcDiscoveryService;

  constructor(
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    httpClient?: HttpClientContract,
    @Optional() jwksService?: FederatedJwksService,
    @Optional() discoveryService?: OidcDiscoveryService,
  ) {
    const client = httpClient ?? new BaseHttpClientProvider();
    super(client, jwksService ?? new FederatedJwksService(client));
    this.discoveryService = discoveryService ?? new OidcDiscoveryService(client);
  }

  public getMetadata(): FederatedDriverMetadata {
    return {
      driverCode: this.driverCode,
      displayName: GENERIC_OIDC_DEFAULTS.DISPLAY_NAME,
      supportsTenantId: true,
      defaultTenantId: null,
      defaultScopes: [...GENERIC_OIDC_DEFAULTS.SCOPES],
      defaultAuthorizationEndpoint: '',
      defaultTokenEndpoint: '',
      defaultJwksUri: '',
      defaultUserinfoEndpoint: null,
      defaultIssuerUrl: '',
    };
  }

  public resolveEndpoints(config: OAuthAdapterResolvedConfig): OidcResolvedEndpoints {
    const issuerUrl = config.issuerUrl?.trim() ? normalizeIssuerUrl(config.issuerUrl) : '';
    const authorizationEndpoint = config.authorizationEndpoint?.trim() ?? '';
    const tokenEndpoint = config.tokenEndpoint?.trim() ?? '';
    const jwksUri = config.jwksUri?.trim() ?? '';
    const userinfoEndpoint = config.userinfoEndpoint?.trim() || null;

    if (!issuerUrl || !authorizationEndpoint || !tokenEndpoint || !jwksUri) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.oidcEndpointsMissing',
        stage: FEDERATED_AUTH_STAGE.DISCOVERY,
        stageErrorCode: 'OIDC_ENDPOINTS_MISSING',
        diagnosticMessage:
          'OIDC provider requires issuerUrl, authorizationEndpoint, tokenEndpoint and jwksUri (or discoveryEnabled with issuerUrl)',
      });
    }

    return {
      issuerUrl,
      authorizationEndpoint,
      tokenEndpoint,
      jwksUri,
      userinfoEndpoint,
      scopes: config.scopes.length > 0 ? config.scopes : [...GENERIC_OIDC_DEFAULTS.SCOPES],
      discovered: false,
    };
  }

  public override async resolveEndpointsAsync(
    config: OAuthAdapterResolvedConfig,
    options?: {
      readonly cacheTtlSeconds?: number | undefined;
      readonly forceRefresh?: boolean | undefined;
    },
  ): Promise<OidcResolvedEndpoints> {
    const extra = parseFederatedExtraConfig(config.extraConfig, this.driverCode);
    const rawIssuer = config.issuerUrl?.trim() ? normalizeIssuerUrl(config.issuerUrl) : '';
    const manualAuth = config.authorizationEndpoint?.trim() ?? '';
    const manualToken = config.tokenEndpoint?.trim() ?? '';
    const manualJwks = config.jwksUri?.trim() ?? '';
    const manualUserInfo = config.userinfoEndpoint?.trim() || null;

    const needsDiscovery =
      extra.oidcOptions.discoveryEnabled &&
      Boolean(rawIssuer) &&
      (Boolean(options?.forceRefresh) || !manualAuth || !manualToken || !manualJwks);

    if (!needsDiscovery) {
      return this.resolveEndpoints(config);
    }

    const doc = await this.discoveryService.getDiscoveryDocument({
      serviceName: `oauth-${this.driverCode}`,
      issuerUrl: rawIssuer,
      discoveryUrl: extra.oidcOptions.discoveryUrl,
      cacheTtlSeconds:
        options?.cacheTtlSeconds ?? GENERIC_OIDC_DEFAULTS.DISCOVERY_CACHE_TTL_SECONDS,
      forceRefresh: options?.forceRefresh,
    });

    const issuerUrl = normalizeIssuerUrl(doc.issuer || rawIssuer);
    const authorizationEndpoint = manualAuth || doc.authorization_endpoint.trim();
    const tokenEndpoint = manualToken || doc.token_endpoint.trim();
    const jwksUri = manualJwks || doc.jwks_uri.trim();
    const userinfoEndpoint = manualUserInfo || doc.userinfo_endpoint?.trim() || null;

    if (!issuerUrl || !authorizationEndpoint || !tokenEndpoint || !jwksUri) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.oidcEndpointsMissing',
        stage: FEDERATED_AUTH_STAGE.DISCOVERY,
        stageErrorCode: 'OIDC_ENDPOINTS_MISSING',
        diagnosticMessage: 'OIDC discovery did not yield all required endpoints',
      });
    }

    return {
      issuerUrl,
      authorizationEndpoint,
      tokenEndpoint,
      jwksUri,
      userinfoEndpoint,
      scopes: config.scopes.length > 0 ? config.scopes : [...GENERIC_OIDC_DEFAULTS.SCOPES],
      discovered: true,
    };
  }

  protected override getExtraAuthorizeParams(
    config?: OAuthAdapterResolvedConfig,
  ): Record<string, string> {
    if (!config) return {};
    const extra = parseFederatedExtraConfig(config.extraConfig, this.driverCode);
    return { ...extra.oidcOptions.extraAuthorizeParams };
  }

  protected validateIssuerClaim(
    issuer: string,
    _claims: Record<string, unknown>,
    config: OAuthAdapterResolvedConfig,
    resolvedIssuer: string,
  ): boolean {
    const normalizedActual = normalizeIssuerUrl(issuer);
    const normalizedExpected = normalizeIssuerUrl(resolvedIssuer);
    if (normalizedActual === normalizedExpected) {
      return true;
    }
    const extra = parseFederatedExtraConfig(config.extraConfig, this.driverCode);
    return extra.oidcOptions.allowedIssuers.some(
      (allowed) => normalizeIssuerUrl(allowed) === normalizedActual,
    );
  }

  protected mapVerifiedClaimsToProfile(params: {
    readonly claims: Record<string, unknown>;
    readonly userInfoClaims?: Record<string, unknown> | null | undefined;
    readonly config: OAuthAdapterResolvedConfig;
    readonly resolvedIssuer: string;
  }): VerifiedExternalProfile {
    const extra = parseFederatedExtraConfig(params.config.extraConfig, this.driverCode);
    return mapOidcClaimsWithConfig({
      claims: params.claims,
      userInfoClaims: params.userInfoClaims,
      config: params.config,
      driverCode: this.driverCode,
      resolvedIssuer: params.resolvedIssuer,
      claimMapping: extra.claimMapping,
    });
  }
}
