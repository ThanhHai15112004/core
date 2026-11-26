import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  type HttpClientContract,
} from '@packages/http-client/index.js';
import { FEDERATED_DRIVER_CODE, MICROSOFT_OIDC_DEFAULTS } from '../enum/federated-identity.enum.js';
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
export class MicrosoftOAuthAdapter extends BaseOidcOAuthAdapter {
  public readonly driverCode = FEDERATED_DRIVER_CODE.MICROSOFT;

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
    const tenant = MICROSOFT_OIDC_DEFAULTS.DEFAULT_TENANT_ID;
    return {
      driverCode: this.driverCode,
      displayName: MICROSOFT_OIDC_DEFAULTS.DISPLAY_NAME,
      supportsTenantId: true,
      defaultTenantId: tenant,
      defaultScopes: [...MICROSOFT_OIDC_DEFAULTS.SCOPES],
      defaultAuthorizationEndpoint: MICROSOFT_OIDC_DEFAULTS.buildAuthorizationEndpoint(tenant),
      defaultTokenEndpoint: MICROSOFT_OIDC_DEFAULTS.buildTokenEndpoint(tenant),
      defaultJwksUri: MICROSOFT_OIDC_DEFAULTS.buildJwksUri(tenant),
      defaultUserinfoEndpoint: null,
      defaultIssuerUrl: MICROSOFT_OIDC_DEFAULTS.buildIssuerUrl(tenant),
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
    const tenantId = config.tenantId?.trim() || MICROSOFT_OIDC_DEFAULTS.DEFAULT_TENANT_ID;
    return {
      issuerUrl: config.issuerUrl?.trim() || MICROSOFT_OIDC_DEFAULTS.buildIssuerUrl(tenantId),
      authorizationEndpoint:
        config.authorizationEndpoint?.trim() ||
        MICROSOFT_OIDC_DEFAULTS.buildAuthorizationEndpoint(tenantId),
      tokenEndpoint:
        config.tokenEndpoint?.trim() || MICROSOFT_OIDC_DEFAULTS.buildTokenEndpoint(tenantId),
      jwksUri: config.jwksUri?.trim() || MICROSOFT_OIDC_DEFAULTS.buildJwksUri(tenantId),
      userinfoEndpoint: config.userinfoEndpoint?.trim() || null,
      scopes: config.scopes.length > 0 ? config.scopes : [...MICROSOFT_OIDC_DEFAULTS.SCOPES],
    };
  }

  protected override getExtraAuthorizeParams(): Record<string, string> {
    return {
      response_mode: 'query',
      prompt: 'select_account',
    };
  }

  protected validateIssuerClaim(
    issuer: string,
    claims: Record<string, unknown>,
    config: OAuthAdapterResolvedConfig,
    resolvedIssuer: string,
  ): boolean {
    if (config.issuerUrl?.trim()) {
      return issuer === resolvedIssuer;
    }

    const configuredTenant =
      config.tenantId?.trim().toLowerCase() || MICROSOFT_OIDC_DEFAULTS.DEFAULT_TENANT_ID;

    if (MICROSOFT_OIDC_DEFAULTS.MULTI_TENANT_MODES.includes(configuredTenant)) {
      const tid = typeof claims['tid'] === 'string' ? claims['tid'].trim() : '';
      if (!tid) return false;
      const expectedDynamicIssuer = MICROSOFT_OIDC_DEFAULTS.buildIssuerUrl(tid);
      return issuer === expectedDynamicIssuer;
    }

    return issuer === resolvedIssuer;
  }

  protected mapVerifiedClaimsToProfile(params: {
    readonly claims: Record<string, unknown>;
    readonly userInfoClaims?: Record<string, unknown> | null | undefined;
    readonly config: OAuthAdapterResolvedConfig;
    readonly resolvedIssuer: string;
  }): VerifiedExternalProfile {
    const { claims, userInfoClaims, config, resolvedIssuer } = params;
    const rawEmail =
      typeof claims['email'] === 'string' && claims['email'].trim()
        ? claims['email'].trim().toLowerCase()
        : typeof claims['preferred_username'] === 'string' &&
            claims['preferred_username'].includes('@')
          ? claims['preferred_username'].trim().toLowerCase()
          : null;

    const emailVerified =
      claims['email_verified'] === true || claims['xms_edov'] === true || claims['xms_edov'] === 1;

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
        : [lastName, firstName].filter(Boolean).join(' ') || rawEmail;

    const tid =
      typeof claims['tid'] === 'string' && claims['tid'].trim()
        ? claims['tid'].trim()
        : config.tenantId?.trim() || null;

    const issuerToPersist =
      typeof claims['iss'] === 'string' && claims['iss'].trim()
        ? claims['iss'].trim()
        : resolvedIssuer;
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
      issuer: issuerToPersist,
      subject: String(claims['sub']).trim(),
      tenantId: tid,
      email: rawEmail,
      emailVerified,
      displayName,
      firstName,
      lastName,
      avatarUrl: null,
      ...(groups.length > 0 ? { groups } : {}),
      rawClaimsSummary: {
        issuer: issuerToPersist,
        emailVerified,
        ...(groups.length > 0 ? { groupsCount: groups.length } : {}),
        ...(tid ? { tenantId: tid } : {}),
        ...(typeof claims['oid'] === 'string' ? { oid: claims['oid'] } : {}),
      },
    };
  }
}
