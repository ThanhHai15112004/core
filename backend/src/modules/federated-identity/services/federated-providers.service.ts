import { Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import {
  NotFoundAppException,
  PROVIDER_TYPE,
  ProviderRegistryService as KernelProviderRegistryService,
  SettingRegistryService,
  defaultProviderRegistry,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParseObject,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  defaultFieldEncryptionService,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  FEDERATED_AUDIT_META,
  FEDERATED_DRIVER_CODE,
  FEDERATED_PROVIDER_STATUS,
  FEDERATED_SETTING_KEYS,
} from '../enum/federated-identity.enum.js';
import type { FederatedIdentityProviderEntity } from '../entities/federated-identity-provider.entity.js';
import { resolveFederatedRuntimeConfig } from '../helpers/federated-config.helper.js';
import { sanitizeFederatedErrorMessage } from '../helpers/federated-redaction.helper.js';
import {
  mergeFederatedExtraConfig,
  parseFederatedExtraConfig,
} from '../helpers/oidc-claim-mapping.helper.js';
import {
  isSamlProviderConfigured,
  mergeSamlConfig,
  parseSamlConfig,
} from '../helpers/saml-config.helper.js';
import { FederatedIdentityProviderRepository } from '../repositories/federated-identity-provider.repository.js';
import type { UpsertFederatedProviderRequest } from '../requests/federated-identity.requests.js';
import { FederatedIdentityResponseMapper } from '../responses/federated-identity.response.js';
import type {
  FederatedDriverMetadata,
  FederatedPolicyView,
  FederatedProviderView,
  OAuthAdapterResolvedConfig,
  OidcDiscoveryTestResult,
  PublicFederatedProviderView,
  TestProviderConnectionResult,
} from '../types/federated-identity.types.js';
import { FederatedStageError } from './federated-jwks.service.js';
import { OAuthProviderRegistryService } from './oauth-provider-registry.service.js';
import { OidcDiscoveryService } from './oidc-discovery.service.js';

function buildSecretHint(secret: string): string {
  const clean = secret.trim();
  if (!clean) return '****';
  if (clean.length <= 4) return '****';
  return `****${clean.slice(-4)}`;
}

@Injectable()
export class FederatedProvidersService implements OnModuleDestroy {
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;
  private readonly kernelProviderRegistry: KernelProviderRegistryService;
  private unregisterProbe: (() => void) | null = null;

  constructor(
    private readonly providerRepo: FederatedIdentityProviderRepository,
    private readonly providerRegistry: OAuthProviderRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() kernelProviderRegistry?: KernelProviderRegistryService,
    @Optional() private readonly discoveryService?: OidcDiscoveryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
    this.kernelProviderRegistry = kernelProviderRegistry ?? defaultProviderRegistry;
    this.registerHealthProbe();
  }

  public onModuleDestroy(): void {
    this.unregisterProbe?.();
    this.unregisterProbe = null;
  }

  private registerHealthProbe(): void {
    this.unregisterProbe = this.kernelProviderRegistry.registerHealthProbe(
      PROVIDER_TYPE.IDENTITY,
      '*',
      async (input) => {
        const refCode = (input.domainRefCode ?? input.providerCode).trim().toLowerCase();
        const res = await this.testProviderConnection(refCode);
        return {
          status: res.ok ? 'HEALTHY' : res.configured ? 'DOWN' : 'DEGRADED',
          latencyMs: res.durationMs,
          errorCode: res.errorCode,
          errorMessage: res.errorMessage,
          details: {
            providerCode: res.providerCode,
            driverCode: res.driverCode,
            jwksUri: res.jwksUri,
            keyCount: res.keyCount,
          },
        };
      },
    );
  }

  public listDrivers(): FederatedDriverMetadata[] {
    return this.providerRegistry.listDrivers();
  }

  public getPolicy(): FederatedPolicyView {
    return {
      runtimeConfig: resolveFederatedRuntimeConfig(this.settingRegistry),
      settingKeys: {
        autoLinkVerifiedEmail: FEDERATED_SETTING_KEYS.AUTO_LINK_VERIFIED_EMAIL,
        allowAutoRegister: FEDERATED_SETTING_KEYS.ALLOW_AUTO_REGISTER,
        requireVerifiedEmailForRegister: FEDERATED_SETTING_KEYS.REQUIRE_VERIFIED_EMAIL_FOR_REGISTER,
        transactionTtlSeconds: FEDERATED_SETTING_KEYS.TRANSACTION_TTL_SECONDS,
        jwksCacheTtlSeconds: FEDERATED_SETTING_KEYS.JWKS_CACHE_TTL_SECONDS,
        requireStepUpForUnlink: FEDERATED_SETTING_KEYS.REQUIRE_STEP_UP_FOR_UNLINK,
        allowedRedirectUris: FEDERATED_SETTING_KEYS.ALLOWED_REDIRECT_URIS,
      },
    };
  }

  public async listPublicProviders(): Promise<PublicFederatedProviderView[]> {
    const enabled = await this.providerRepo.findEnabledPublicProviders();
    return enabled
      .filter((item) => {
        if (item.driverCode === FEDERATED_DRIVER_CODE.SAML) {
          return isSamlProviderConfigured(
            parseSamlConfig(item.extraConfigJson, item.providerCode),
          );
        }
        if (!item.clientSecretEncrypted?.trim()) return false;
        if (item.driverCode === FEDERATED_DRIVER_CODE.OIDC) {
          const hasIssuer = Boolean(item.issuerUrl?.trim());
          const hasManualEndpoints = Boolean(
            item.authorizationEndpoint?.trim() &&
              item.tokenEndpoint?.trim() &&
              item.jwksUri?.trim(),
          );
          return hasIssuer || hasManualEndpoints;
        }
        return true;
      })
      .map((item) => FederatedIdentityResponseMapper.toPublicProviderView(item));
  }

  public async findByCodeOrNull(
    providerCode: string,
  ): Promise<FederatedIdentityProviderEntity | null> {
    return this.providerRepo.findByCode(providerCode.trim().toLowerCase());
  }

  public async listProviders(): Promise<FederatedProviderView[]> {
    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    const items = await this.providerRepo.listAll();
    return items.map((item) => FederatedIdentityResponseMapper.toProviderView(item, runtimeConfig));
  }

  public async getProviderByCode(providerCode: string): Promise<FederatedProviderView> {
    const entity = await this.getProviderEntityOrThrow(providerCode);
    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    return FederatedIdentityResponseMapper.toProviderView(entity, runtimeConfig);
  }

  public async getProviderEntityOrThrow(
    providerCode: string,
  ): Promise<FederatedIdentityProviderEntity> {
    const entity = await this.providerRepo.findByCode(providerCode.trim().toLowerCase());
    if (!entity) {
      throw new NotFoundAppException('federated-identity.providerNotFound', {
        providerCode: providerCode.trim().toLowerCase(),
      });
    }
    return entity;
  }

  public resolveAdapterConfig(entity: FederatedIdentityProviderEntity): OAuthAdapterResolvedConfig {
    const clientSecret = entity.clientSecretEncrypted
      ? this.encryptionService.decrypt(entity.clientSecretEncrypted)
      : '';
    return {
      providerCode: entity.providerCode,
      driverCode: entity.driverCode,
      clientId: entity.clientId?.trim() ?? '',
      clientSecret,
      tenantId: entity.tenantId ?? null,
      issuerUrl: entity.issuerUrl ?? null,
      authorizationEndpoint: entity.authorizationEndpoint ?? null,
      tokenEndpoint: entity.tokenEndpoint ?? null,
      jwksUri: entity.jwksUri ?? null,
      userinfoEndpoint: entity.userinfoEndpoint ?? null,
      scopes: safeJsonParseStringArray(entity.scopesJson),
      extraConfig: safeJsonParseObject<Record<string, unknown>>(entity.extraConfigJson, {}),
    };
  }

  public async upsertProvider(
    rawProviderCode: string,
    input: UpsertFederatedProviderRequest,
    actor?: UserIdentity,
  ): Promise<FederatedProviderView> {
    const providerCode = rawProviderCode.trim().toLowerCase();
    const existing = await this.providerRepo.findByCode(providerCode, true);

    const driverCode = (
      input.driverCode ??
      existing?.driverCode ??
      (this.providerRegistry.has(providerCode) ? providerCode : '')
    )
      .trim()
      .toLowerCase();

    const adapter = this.providerRegistry.get(driverCode);
    const driverMeta = adapter.getMetadata();
    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);

    const actorUserId = actor ? parseNumericUserId(actor.id) : null;
    const beforeData = existing
      ? FederatedIdentityResponseMapper.toProviderView(existing, runtimeConfig)
      : null;

    let nextSecretEncrypted = existing?.clientSecretEncrypted ?? null;
    let nextSecretHint = existing?.clientSecretHint ?? null;
    if (input.clientSecret !== undefined) {
      if (input.clientSecret && input.clientSecret.trim().length > 0) {
        const cleanSecret = input.clientSecret.trim();
        nextSecretEncrypted = this.encryptionService.encrypt(cleanSecret);
        nextSecretHint = buildSecretHint(cleanSecret);
      } else {
        nextSecretEncrypted = null;
        nextSecretHint = null;
      }
    }

    const nextEnabled =
      input.isEnabled !== undefined ? Boolean(input.isEnabled) : (existing?.isEnabled ?? false);
    const nextStatus =
      input.status ??
      (input.isEnabled !== undefined
        ? input.isEnabled
          ? FEDERATED_PROVIDER_STATUS.ACTIVE
          : FEDERATED_PROVIDER_STATUS.INACTIVE
        : (existing?.status ?? FEDERATED_PROVIDER_STATUS.INACTIVE));

    const nextScopes =
      input.scopes !== undefined
        ? input.scopes
        : existing?.scopesJson
          ? safeJsonParseStringArray(existing.scopesJson)
          : [...driverMeta.defaultScopes];

    const nextAllowedRedirectUris =
      input.allowedRedirectUris !== undefined
        ? input.allowedRedirectUris
        : existing?.allowedRedirectUrisJson
          ? safeJsonParseStringArray(existing.allowedRedirectUrisJson)
          : [];

    const existingExtra = parseFederatedExtraConfig(existing?.extraConfigJson, driverMeta.driverCode);
    const existingSaml =
      driverMeta.driverCode === FEDERATED_DRIVER_CODE.SAML
        ? parseSamlConfig(existing?.extraConfigJson, providerCode)
        : existingExtra.samlConfig;
    const nextSaml =
      driverMeta.driverCode === FEDERATED_DRIVER_CODE.SAML || input.samlConfig
        ? mergeSamlConfig(existingSaml, input.samlConfig, providerCode, this.encryptionService)
        : undefined;

    const mergedExtra = mergeFederatedExtraConfig(
      existingExtra,
      {
        ...(nextSaml ? { samlConfig: nextSaml } : {}),
        oidcOptions: input.oidcOptions
          ? {
              ...(input.oidcOptions.discoveryEnabled !== undefined
                ? { discoveryEnabled: input.oidcOptions.discoveryEnabled }
                : {}),
              ...(input.oidcOptions.discoveryUrl !== undefined
                ? { discoveryUrl: input.oidcOptions.discoveryUrl }
                : {}),
              ...(input.oidcOptions.allowedIssuers !== undefined
                ? { allowedIssuers: input.oidcOptions.allowedIssuers }
                : {}),
              ...(input.oidcOptions.fetchUserInfo !== undefined
                ? { fetchUserInfo: input.oidcOptions.fetchUserInfo }
                : {}),
              ...(input.oidcOptions.allowedEmailDomains !== undefined
                ? { allowedEmailDomains: input.oidcOptions.allowedEmailDomains }
                : {}),
              ...(input.oidcOptions.extraAuthorizeParams !== undefined
                ? { extraAuthorizeParams: input.oidcOptions.extraAuthorizeParams }
                : {}),
            }
          : undefined,
        claimMapping: input.claimMapping
          ? {
              ...(input.claimMapping.emailClaim !== undefined
                ? { emailClaim: input.claimMapping.emailClaim }
                : {}),
              ...(input.claimMapping.emailVerifiedClaim !== undefined
                ? { emailVerifiedClaim: input.claimMapping.emailVerifiedClaim }
                : {}),
              ...(input.claimMapping.nameClaim !== undefined
                ? { nameClaim: input.claimMapping.nameClaim }
                : {}),
              ...(input.claimMapping.firstNameClaim !== undefined
                ? { firstNameClaim: input.claimMapping.firstNameClaim }
                : {}),
              ...(input.claimMapping.lastNameClaim !== undefined
                ? { lastNameClaim: input.claimMapping.lastNameClaim }
                : {}),
              ...(input.claimMapping.avatarClaim !== undefined
                ? { avatarClaim: input.claimMapping.avatarClaim }
                : {}),
              ...(input.claimMapping.groupsClaim !== undefined
                ? { groupsClaim: input.claimMapping.groupsClaim }
                : {}),
              ...(input.claimMapping.tenantIdClaim !== undefined
                ? { tenantIdClaim: input.claimMapping.tenantIdClaim }
                : {}),
              ...(input.claimMapping.extraAttributeClaims !== undefined
                ? { extraAttributeClaims: input.claimMapping.extraAttributeClaims }
                : {}),
            }
          : undefined,
        roleSyncPolicy: input.roleSyncPolicy
          ? {
              ...(input.roleSyncPolicy.enabled !== undefined
                ? { enabled: input.roleSyncPolicy.enabled }
                : {}),
              ...(input.roleSyncPolicy.mode !== undefined
                ? { mode: input.roleSyncPolicy.mode }
                : {}),
              ...(input.roleSyncPolicy.allowedRoleCodes !== undefined
                ? { allowedRoleCodes: input.roleSyncPolicy.allowedRoleCodes }
                : {}),
              ...(input.roleSyncPolicy.deniedRoleCodes !== undefined
                ? { deniedRoleCodes: input.roleSyncPolicy.deniedRoleCodes }
                : {}),
              ...(input.roleSyncPolicy.defaultRoleCodes !== undefined
                ? { defaultRoleCodes: input.roleSyncPolicy.defaultRoleCodes }
                : {}),
              ...(input.roleSyncPolicy.groupRoleMappings !== undefined
                ? { groupRoleMappings: input.roleSyncPolicy.groupRoleMappings }
                : {}),
              ...(input.roleSyncPolicy.requireMatchedGroup !== undefined
                ? { requireMatchedGroup: input.roleSyncPolicy.requireMatchedGroup }
                : {}),
            }
          : undefined,
      },
      driverMeta.driverCode,
    );

    const payload: Partial<FederatedIdentityProviderEntity> = {
      ...(existing ? { id: existing.id, deletedAt: null } : {}),
      providerCode,
      driverCode: driverMeta.driverCode,
      displayName: input.displayName?.trim() || existing?.displayName || driverMeta.displayName,
      description:
        input.description !== undefined ? input.description : (existing?.description ?? null),
      status: nextStatus,
      isEnabled: nextEnabled,
      clientId:
        input.clientId !== undefined
          ? input.clientId?.trim() || null
          : (existing?.clientId ?? null),
      clientSecretEncrypted: nextSecretEncrypted,
      clientSecretHint: nextSecretHint,
      tenantId:
        input.tenantId !== undefined
          ? input.tenantId?.trim() || null
          : (existing?.tenantId ?? driverMeta.defaultTenantId),
      issuerUrl:
        input.issuerUrl !== undefined
          ? input.issuerUrl?.trim() || null
          : (nextSaml?.idpEntityId ?? existing?.issuerUrl ?? null),
      authorizationEndpoint:
        input.authorizationEndpoint !== undefined
          ? input.authorizationEndpoint?.trim() || null
          : (existing?.authorizationEndpoint ?? null),
      tokenEndpoint:
        input.tokenEndpoint !== undefined
          ? input.tokenEndpoint?.trim() || null
          : (existing?.tokenEndpoint ?? null),
      jwksUri:
        input.jwksUri !== undefined ? input.jwksUri?.trim() || null : (existing?.jwksUri ?? null),
      userinfoEndpoint:
        input.userinfoEndpoint !== undefined
          ? input.userinfoEndpoint?.trim() || null
          : (existing?.userinfoEndpoint ?? null),
      scopesJson: JSON.stringify(nextScopes),
      allowedRedirectUrisJson: JSON.stringify(nextAllowedRedirectUris),
      allowAutoRegisterOverride:
        input.allowAutoRegisterOverride !== undefined
          ? input.allowAutoRegisterOverride
          : (existing?.allowAutoRegisterOverride ?? null),
      autoLinkVerifiedEmailOverride:
        input.autoLinkVerifiedEmailOverride !== undefined
          ? input.autoLinkVerifiedEmailOverride
          : (existing?.autoLinkVerifiedEmailOverride ?? null),
      extraConfigJson: JSON.stringify(mergedExtra),
      createdBy: existing?.createdBy ?? actorUserId,
      updatedBy: actorUserId,
    };

    const saved = await this.providerRepo.saveEntity(payload);
    const view = FederatedIdentityResponseMapper.toProviderView(saved, runtimeConfig);

    await this.auditLogService
      ?.record({
        actor,
        module: FEDERATED_AUDIT_META.MODULE,
        feature: FEDERATED_AUDIT_META.FEATURE_PROVIDER,
        action: existing ? 'UPDATE' : 'CREATE',
        resourceType: 'federated_identity_provider',
        resourceId: saved.providerCode,
        beforeData,
        afterData: view,
      })
      .catch(() => undefined);

    return view;
  }

  public async deleteProvider(
    rawProviderCode: string,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly providerCode: string }> {
    const providerCode = rawProviderCode.trim().toLowerCase();
    const existing = await this.getProviderEntityOrThrow(providerCode);
    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    const beforeData = FederatedIdentityResponseMapper.toProviderView(existing, runtimeConfig);

    existing.isEnabled = false;
    existing.status = FEDERATED_PROVIDER_STATUS.INACTIVE;
    existing.updatedBy = actor ? parseNumericUserId(actor.id) : null;
    await this.providerRepo.saveEntity(existing);
    await this.providerRepo.repository.softDelete({ id: existing.id });

    await this.auditLogService
      ?.record({
        actor,
        module: FEDERATED_AUDIT_META.MODULE,
        feature: FEDERATED_AUDIT_META.FEATURE_PROVIDER,
        action: 'DELETE',
        resourceType: 'federated_identity_provider',
        resourceId: existing.providerCode,
        beforeData,
      })
      .catch(() => undefined);

    return { deleted: true, providerCode: existing.providerCode };
  }

  public async testProviderConnection(
    rawProviderCode: string,
  ): Promise<TestProviderConnectionResult> {
    const entity = await this.getProviderEntityOrThrow(rawProviderCode);
    const adapter = this.providerRegistry.get(entity.driverCode);
    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    const resolvedConfig = this.resolveAdapterConfig(entity);
    return adapter.testConnection({
      config: resolvedConfig,
      jwksCacheTtlSeconds: runtimeConfig.jwksCacheTtlSeconds,
    });
  }

  public async discoverProviderConfiguration(
    rawProviderCode: string,
  ): Promise<OidcDiscoveryTestResult> {
    const startMs = Date.now();
    const entity = await this.getProviderEntityOrThrow(rawProviderCode);
    const resolvedConfig = this.resolveAdapterConfig(entity);
    const extra = parseFederatedExtraConfig(resolvedConfig.extraConfig, entity.driverCode);
    const issuerUrl = resolvedConfig.issuerUrl?.trim() ?? '';
    const discovery = this.discoveryService ?? new OidcDiscoveryService();

    let discoveryUrl = extra.oidcOptions.discoveryUrl ?? '';
    if (!issuerUrl) {
      return {
        providerCode: entity.providerCode,
        issuerUrl,
        discoveryUrl,
        ok: false,
        discovered: false,
        authorizationEndpoint: entity.authorizationEndpoint ?? null,
        tokenEndpoint: entity.tokenEndpoint ?? null,
        jwksUri: entity.jwksUri ?? null,
        userinfoEndpoint: entity.userinfoEndpoint ?? null,
        durationMs: Date.now() - startMs,
        errorCode: 'MISSING_ISSUER_URL',
        errorMessage: 'Provider issuerUrl is required for OIDC discovery',
      };
    }

    try {
      discoveryUrl = discovery.buildDiscoveryUrl(issuerUrl, extra.oidcOptions.discoveryUrl);
      const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
      const doc = await discovery.getDiscoveryDocument({
        serviceName: `oauth-${entity.driverCode}`,
        issuerUrl,
        discoveryUrl: extra.oidcOptions.discoveryUrl,
        cacheTtlSeconds: runtimeConfig.jwksCacheTtlSeconds,
        forceRefresh: true,
      });
      return {
        providerCode: entity.providerCode,
        issuerUrl: doc.issuer,
        discoveryUrl,
        ok: true,
        discovered: true,
        authorizationEndpoint: doc.authorization_endpoint,
        tokenEndpoint: doc.token_endpoint,
        jwksUri: doc.jwks_uri,
        userinfoEndpoint: doc.userinfo_endpoint ?? null,
        durationMs: Date.now() - startMs,
        errorCode: null,
        errorMessage: null,
      };
    } catch (err) {
      const errorCode =
        err instanceof FederatedStageError ? err.stageErrorCode : 'DISCOVERY_FETCH_FAILED';
      const errorMessage =
        err instanceof FederatedStageError
          ? err.diagnosticMessage
          : sanitizeFederatedErrorMessage(err instanceof Error ? err.message : String(err));
      return {
        providerCode: entity.providerCode,
        issuerUrl,
        discoveryUrl,
        ok: false,
        discovered: false,
        authorizationEndpoint: entity.authorizationEndpoint ?? null,
        tokenEndpoint: entity.tokenEndpoint ?? null,
        jwksUri: entity.jwksUri ?? null,
        userinfoEndpoint: entity.userinfoEndpoint ?? null,
        durationMs: Date.now() - startMs,
        errorCode,
        errorMessage,
      };
    }
  }
}
