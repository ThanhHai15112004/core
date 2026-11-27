import { Injectable } from '@nestjs/common';
import {
  FEDERATED_AUTH_STAGE,
  FEDERATED_DRIVER_CODE,
  SAML_DEFAULTS,
} from '../enum/federated-identity.enum.js';
import type { IOAuthProviderAdapter } from '../contracts/index.js';
import { evaluateCertificatesHealth } from '../helpers/saml-certificate.helper.js';
import { isSamlProviderConfigured, parseSamlConfig } from '../helpers/saml-config.helper.js';
import { FederatedStageError } from '../services/federated-jwks.service.js';
import type {
  FederatedDriverMetadata,
  OAuthAdapterResolvedConfig,
  OidcResolvedEndpoints,
  TestProviderConnectionResult,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';

@Injectable()
export class SamlProviderAdapter implements IOAuthProviderAdapter {
  public readonly driverCode = FEDERATED_DRIVER_CODE.SAML;

  public getMetadata(): FederatedDriverMetadata {
    return {
      driverCode: this.driverCode,
      displayName: SAML_DEFAULTS.DISPLAY_NAME,
      supportsTenantId: false,
      defaultTenantId: null,
      defaultScopes: [],
      defaultAuthorizationEndpoint: '',
      defaultTokenEndpoint: '',
      defaultJwksUri: '',
      defaultUserinfoEndpoint: null,
      defaultIssuerUrl: '',
    };
  }

  public resolveEndpoints(config: OAuthAdapterResolvedConfig): OidcResolvedEndpoints {
    const samlConfig = parseSamlConfig(config.extraConfig, config.providerCode);
    return {
      issuerUrl: samlConfig.idpEntityId ?? '',
      authorizationEndpoint: samlConfig.idpSsoUrl ?? '',
      tokenEndpoint: samlConfig.acsUrl,
      jwksUri: samlConfig.spEntityId,
      userinfoEndpoint: null,
      scopes: [],
    };
  }

  public buildAuthorizationUrl(): string {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.unsupportedDriver',
      stage: FEDERATED_AUTH_STAGE.SAML_AUTHN_REQUEST,
      stageErrorCode: 'SAML_USE_SAML_SERVICE',
      diagnosticMessage: 'SAML driver builds AuthnRequest via SamlSsoService',
    });
  }

  public async exchangeCodeAndVerify(): Promise<VerifiedExternalProfile> {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.unsupportedDriver',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_USE_ACS_ENDPOINT',
      diagnosticMessage: 'SAML driver verifies assertions via ACS endpoint in SamlSsoService',
    });
  }

  public async testConnection(params: {
    readonly config: OAuthAdapterResolvedConfig;
    readonly jwksCacheTtlSeconds: number;
  }): Promise<TestProviderConnectionResult> {
    const startedAt = Date.now();
    const samlConfig = parseSamlConfig(params.config.extraConfig, params.config.providerCode);
    const configured = isSamlProviderConfigured(samlConfig);
    const health = evaluateCertificatesHealth(
      samlConfig.idpCertificates,
      new Date(),
      samlConfig.clockSkewSeconds,
    );

    if (!configured) {
      return {
        providerCode: params.config.providerCode,
        driverCode: this.driverCode,
        ok: false,
        configured: false,
        issuerUrl: samlConfig.idpEntityId,
        discovered: false,
        jwksUri: samlConfig.spEntityId,
        keyCount: health.eligibleCount,
        durationMs: Date.now() - startedAt,
        errorCode: 'SAML_NOT_CONFIGURED',
        errorMessage:
          'Missing SP Entity ID, ACS URL, IdP Entity ID, IdP SSO URL, or IdP Certificate',
      };
    }

    if (health.eligibleCount === 0) {
      return {
        providerCode: params.config.providerCode,
        driverCode: this.driverCode,
        ok: false,
        configured: true,
        issuerUrl: samlConfig.idpEntityId,
        discovered: false,
        jwksUri: samlConfig.spEntityId,
        keyCount: 0,
        durationMs: Date.now() - startedAt,
        errorCode: 'SAML_NO_ELIGIBLE_CERTIFICATE',
        errorMessage: health.warnings.join('; ') || 'All IdP certificates are expired or revoked',
      };
    }

    return {
      providerCode: params.config.providerCode,
      driverCode: this.driverCode,
      ok: true,
      configured: true,
      issuerUrl: samlConfig.idpEntityId,
      discovered: false,
      jwksUri: samlConfig.spEntityId,
      keyCount: health.eligibleCount,
      durationMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: health.warnings.length > 0 ? health.warnings.join('; ') : null,
    };
  }
}
