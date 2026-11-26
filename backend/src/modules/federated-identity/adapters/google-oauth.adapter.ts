import { Injectable, Optional, Inject } from '@nestjs/common';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  type HttpClientContract,
} from '@packages/http-client/index.js';
import { FEDERATED_DRIVER_CODE, GOOGLE_OIDC_DEFAULTS } from '../enum/federated-identity.enum.js';
import {
  extractGroupsFromClaimValue,
  getClaimByPath,
  parseFederatedExtraConfig,
} from '../helpers/oidc-claim-mapping.helper.js';
import { FederatedJwksService } from '../services/federated-jwks.service.js';
import type {
  FederatedDriverMetadata,
  OAuthAdapterResolvedConfig,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';
import { BaseOidcOAuthAdapter } from './base-oidc.adapter.js';

@Injectable()
export class GoogleOAuthAdapter extends BaseOidcOAuthAdapter {
  public readonly driverCode = FEDERATED_DRIVER_CODE.GOOGLE;

  constructor(
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    httpClient?: HttpClientContract,
    @Optional() jwksService?: FederatedJwksService,
  ) {
    const client = httpClient ?? new BaseHttpClientProvider();
    super(client, jwksService ?? new FederatedJwksService(client));
  }

  public getMetadata(): FederatedDriverMetadata {
    return {
      driverCode: this.driverCode,
      displayName: GOOGLE_OIDC_DEFAULTS.DISPLAY_NAME,
      supportsTenantId: false,
      defaultTenantId: null,
      defaultScopes: [...GOOGLE_OIDC_DEFAULTS.SCOPES],
      defaultAuthorizationEndpoint: GOOGLE_OIDC_DEFAULTS.AUTHORIZATION_ENDPOINT,
      defaultTokenEndpoint: GOOGLE_OIDC_DEFAULTS.TOKEN_ENDPOINT,
      defaultJwksUri: GOOGLE_OIDC_DEFAULTS.JWKS_URI,
      defaultUserinfoEndpoint: GOOGLE_OIDC_DEFAULTS.USERINFO_ENDPOINT,
      defaultIssuerUrl: GOOGLE_OIDC_DEFAULTS.ISSUER_URL,
    };
  }

  public resolveEndpoints(config: OAuthAdapterResolvedConfig): {
    readonly issuerUrl: string;
    readonly authorizationEndpoint: string;
    readonly tokenEndpoint: string;
    readonly jwksUri: string;
    readonly userinfoEndpoint: string | null;
    readonly scopes: readonly string[];
  } {
    return {
      issuerUrl: config.issuerUrl?.trim() || GOOGLE_OIDC_DEFAULTS.ISSUER_URL,
      authorizationEndpoint:
        config.authorizationEndpoint?.trim() || GOOGLE_OIDC_DEFAULTS.AUTHORIZATION_ENDPOINT,
      tokenEndpoint: config.tokenEndpoint?.trim() || GOOGLE_OIDC_DEFAULTS.TOKEN_ENDPOINT,
      jwksUri: config.jwksUri?.trim() || GOOGLE_OIDC_DEFAULTS.JWKS_URI,
      userinfoEndpoint: config.userinfoEndpoint?.trim() || GOOGLE_OIDC_DEFAULTS.USERINFO_ENDPOINT,
      scopes: config.scopes.length > 0 ? config.scopes : [...GOOGLE_OIDC_DEFAULTS.SCOPES],
    };
  }

  protected override getExtraAuthorizeParams(): Record<string, string> {
    return {
      prompt: 'select_account',
    };
  }

  protected validateIssuerClaim(
    issuer: string,
    _claims: Record<string, unknown>,
    config: OAuthAdapterResolvedConfig,
    resolvedIssuer: string,
  ): boolean {
    if (config.issuerUrl?.trim()) {
      return issuer === resolvedIssuer;
    }
    return GOOGLE_OIDC_DEFAULTS.ACCEPTED_ISSUERS.includes(issuer);
  }

  protected mapVerifiedClaimsToProfile(params: {
    readonly claims: Record<string, unknown>;
    readonly userInfoClaims?: Record<string, unknown> | null | undefined;
    readonly config: OAuthAdapterResolvedConfig;
    readonly resolvedIssuer: string;
  }): VerifiedExternalProfile {
    const { claims, userInfoClaims, config, resolvedIssuer } = params;
    const email =
      typeof claims['email'] === 'string' && claims['email'].trim()
        ? claims['email'].trim().toLowerCase()
        : null;
    const emailVerified = claims['email_verified'] === true;
    const firstName =
      typeof claims['given_name'] === 'string' && claims['given_name'].trim()
        ? claims['given_name'].trim()
        : null;
    const lastName =
      typeof claims['family_name'] === 'string' && claims['family_name'].trim()
        ? claims['family_name'].trim()
        : null;
    const displayName =
      typeof claims['name'] === 'string' && claims['name'].trim()
        ? claims['name'].trim()
        : [lastName, firstName].filter(Boolean).join(' ') || email;
    const avatarUrl =
      typeof claims['picture'] === 'string' && claims['picture'].trim()
        ? claims['picture'].trim()
        : null;
    const hd = typeof claims['hd'] === 'string' && claims['hd'].trim() ? claims['hd'].trim() : null;
    const extra = parseFederatedExtraConfig(config.extraConfig, this.driverCode);
    const groups = Array.from(
      new Set([
        ...extractGroupsFromClaimValue(getClaimByPath(claims, extra.claimMapping.groupsClaim)),
        ...(userInfoClaims
          ? extractGroupsFromClaimValue(
              getClaimByPath(userInfoClaims, extra.claimMapping.groupsClaim),
            )
          : []),
      ]),
    );

    return {
      providerCode: config.providerCode,
      driverCode: this.driverCode,
      issuer: resolvedIssuer,
      subject: String(claims['sub']).trim(),
      tenantId: hd,
      email,
      emailVerified,
      displayName,
      firstName,
      lastName,
      avatarUrl,
      ...(groups.length > 0 ? { groups } : {}),
      rawClaimsSummary: {
        issuer: String(claims['iss'] ?? resolvedIssuer),
        emailVerified,
        ...(groups.length > 0 ? { groupsCount: groups.length } : {}),
        ...(hd ? { hostedDomain: hd } : {}),
      },
    };
  }
}
