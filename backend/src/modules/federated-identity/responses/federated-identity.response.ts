import { safeJsonParseStringArray } from '@packages/kernel/index.js';
import { getFederatedProviderStatusName } from '../enum/federated-identity.enum.js';
import { resolveEffectiveProviderPolicy } from '../helpers/federated-config.helper.js';
import type { FederatedAuthEventEntity } from '../entities/federated-auth-event.entity.js';
import type { FederatedIdentityEntity } from '../entities/federated-identity.entity.js';
import type { FederatedIdentityProviderEntity } from '../entities/federated-identity-provider.entity.js';
import type {
  FederatedAuthEventView,
  FederatedIdentityView,
  FederatedProviderView,
  FederatedRuntimeConfig,
  PublicFederatedProviderView,
} from '../types/federated-identity.types.js';
import { safeJsonParseObject } from '@packages/kernel/index.js';

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export class FederatedIdentityResponseMapper {
  public static toPublicProviderView(
    entity: FederatedIdentityProviderEntity,
  ): PublicFederatedProviderView {
    return {
      providerCode: entity.providerCode,
      driverCode: entity.driverCode,
      displayName: entity.displayName,
      description: entity.description ?? null,
      tenantId: entity.tenantId ?? null,
    };
  }

  public static toProviderView(
    entity: FederatedIdentityProviderEntity,
    runtimeConfig: FederatedRuntimeConfig,
  ): FederatedProviderView {
    const hasSecret = Boolean(entity.clientSecretEncrypted?.trim());
    const hasClientId = Boolean(entity.clientId?.trim());
    return {
      id: Number(entity.id),
      providerCode: entity.providerCode,
      driverCode: entity.driverCode,
      displayName: entity.displayName,
      description: entity.description ?? null,
      status: entity.status,
      statusName: getFederatedProviderStatusName(entity.status),
      isEnabled: Boolean(entity.isEnabled),
      isConfigured: hasClientId && hasSecret,
      clientId: entity.clientId ?? null,
      hasClientSecret: hasSecret,
      clientSecretHint: entity.clientSecretHint ?? null,
      tenantId: entity.tenantId ?? null,
      issuerUrl: entity.issuerUrl ?? null,
      authorizationEndpoint: entity.authorizationEndpoint ?? null,
      tokenEndpoint: entity.tokenEndpoint ?? null,
      jwksUri: entity.jwksUri ?? null,
      userinfoEndpoint: entity.userinfoEndpoint ?? null,
      scopes: safeJsonParseStringArray(entity.scopesJson),
      allowedRedirectUris: safeJsonParseStringArray(entity.allowedRedirectUrisJson),
      allowAutoRegisterOverride:
        entity.allowAutoRegisterOverride !== null && entity.allowAutoRegisterOverride !== undefined
          ? Boolean(entity.allowAutoRegisterOverride)
          : null,
      autoLinkVerifiedEmailOverride:
        entity.autoLinkVerifiedEmailOverride !== null &&
        entity.autoLinkVerifiedEmailOverride !== undefined
          ? Boolean(entity.autoLinkVerifiedEmailOverride)
          : null,
      effectivePolicy: resolveEffectiveProviderPolicy(entity, runtimeConfig),
      lastSuccessAt: toIsoOrNull(entity.lastSuccessAt),
      lastErrorAt: toIsoOrNull(entity.lastErrorAt),
      lastErrorCode: entity.lastErrorCode ?? null,
      version: Number(entity.version ?? 1),
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
    };
  }

  public static toIdentityView(entity: FederatedIdentityEntity): FederatedIdentityView {
    return {
      id: Number(entity.id),
      userId: Number(entity.userId),
      providerId: Number(entity.providerId),
      providerCode: entity.providerCode,
      issuerUrl: entity.issuerUrl,
      providerSubject: entity.providerSubject,
      providerTenantId: entity.providerTenantId ?? null,
      emailAtProvider: entity.emailAtProvider ?? null,
      emailVerified: Boolean(entity.emailVerified),
      displayName: entity.displayName ?? null,
      avatarUrl: entity.avatarUrl ?? null,
      linkedAt:
        toIsoOrNull(entity.linkedAt) ?? toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      lastLoginAt: toIsoOrNull(entity.lastLoginAt),
    };
  }

  public static toAuthEventView(entity: FederatedAuthEventEntity): FederatedAuthEventView {
    return {
      id: Number(entity.id),
      eventUid: entity.eventUid,
      providerCode: entity.providerCode,
      flowType: entity.flowType,
      stage: entity.stage,
      outcome: entity.outcome,
      errorCode: entity.errorCode ?? null,
      providerError: entity.providerError ?? null,
      errorMessage: entity.errorMessage ?? null,
      httpStatus:
        entity.httpStatus !== null && entity.httpStatus !== undefined
          ? Number(entity.httpStatus)
          : null,
      durationMs: Number(entity.durationMs ?? 0),
      userId: entity.userId !== null && entity.userId !== undefined ? Number(entity.userId) : null,
      identityId:
        entity.identityId !== null && entity.identityId !== undefined
          ? Number(entity.identityId)
          : null,
      requestId: entity.requestId ?? null,
      correlationId: entity.correlationId ?? null,
      sourceIpMasked: entity.sourceIpMasked ?? null,
      metadata: safeJsonParseObject<Record<string, unknown>>(entity.metadataRedactedJson, {}),
      occurredAt:
        toIsoOrNull(entity.occurredAt) ?? toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
    };
  }
}
