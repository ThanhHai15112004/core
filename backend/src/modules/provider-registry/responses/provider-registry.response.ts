import {
  getProviderHealthStatusName,
  getProviderStatusName,
  safeJsonParseObject,
  safeJsonParseStringArray,
  type RegisteredProviderSnapshot,
} from '@packages/kernel/index.js';
import type { ProviderConfigHistoryEntity } from '../entities/provider-config-history.entity.js';
import type { ProviderHealthCheckEntity } from '../entities/provider-health-check.entity.js';
import type { ProviderRegistryEntryEntity } from '../entities/provider-registry-entry.entity.js';
import type { ProviderUnitAssignmentEntity } from '../entities/provider-unit-assignment.entity.js';
import { redactProviderConfigObject } from '../helpers/provider-redaction.helper.js';
import type {
  ProviderConfigHistoryView,
  ProviderHealthCheckView,
  ProviderRegistryEntryView,
  ProviderUnitAssignmentView,
} from '../types/provider-registry.types.js';

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export class ProviderRegistryResponseMapper {
  public static toEntryView(
    entity: ProviderRegistryEntryEntity,
    configuredSecretKeys: readonly string[] = [],
  ): ProviderRegistryEntryView {
    const rawConfig = safeJsonParseObject<Record<string, unknown>>(entity.configJson, {});
    return {
      id: Number(entity.id),
      providerCode: entity.providerCode,
      providerType: entity.providerType,
      driverCode: entity.driverCode,
      displayName: entity.displayName,
      description: entity.description ?? null,
      domainRefCode: entity.domainRefCode ?? null,
      httpServiceName: entity.httpServiceName ?? null,
      role: entity.role,
      priority: Number(entity.priority ?? 100),
      isPrimary: Boolean(entity.isPrimary),
      fallbackAllowed: Boolean(entity.fallbackAllowed),
      status: entity.status,
      statusName: getProviderStatusName(entity.status),
      pausedAt: toIsoOrNull(entity.pausedAt),
      pausedBy:
        entity.pausedBy !== null && entity.pausedBy !== undefined ? Number(entity.pausedBy) : null,
      pausedReason: entity.pausedReason ?? null,
      secretRef: entity.secretRef ?? null,
      hasEncryptedSecrets: Boolean(entity.secretsEncrypted),
      secretHint: entity.secretHint ?? null,
      configuredSecretKeys,
      config: redactProviderConfigObject(rawConfig),
      healthStatus: entity.healthStatus,
      healthStatusName: getProviderHealthStatusName(entity.healthStatus),
      lastHealthCheckAt: toIsoOrNull(entity.lastHealthCheckAt),
      lastHealthLatencyMs:
        entity.lastHealthLatencyMs !== null && entity.lastHealthLatencyMs !== undefined
          ? Number(entity.lastHealthLatencyMs)
          : null,
      lastHealthErrorCode: entity.lastHealthErrorCode ?? null,
      lastHealthErrorMessage: entity.lastHealthErrorMessage ?? null,
      consecutiveFailures: Number(entity.consecutiveFailures ?? 0),
      createdBy:
        entity.createdBy !== null && entity.createdBy !== undefined
          ? Number(entity.createdBy)
          : null,
      updatedBy:
        entity.updatedBy !== null && entity.updatedBy !== undefined
          ? Number(entity.updatedBy)
          : null,
      version: Number(entity.version ?? 1),
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
    };
  }

  public static toKernelSnapshot(entity: ProviderRegistryEntryEntity): RegisteredProviderSnapshot {
    const rawConfig = safeJsonParseObject<Record<string, unknown>>(entity.configJson, {});
    return {
      id: Number(entity.id),
      providerCode: entity.providerCode,
      providerType: entity.providerType,
      driverCode: entity.driverCode,
      displayName: entity.displayName,
      domainRefCode: entity.domainRefCode ?? null,
      httpServiceName: entity.httpServiceName ?? null,
      role: entity.role,
      priority: Number(entity.priority ?? 100),
      isPrimary: Boolean(entity.isPrimary),
      fallbackAllowed: Boolean(entity.fallbackAllowed),
      status: entity.status,
      statusName: getProviderStatusName(entity.status),
      pausedAt: toIsoOrNull(entity.pausedAt),
      pausedReason: entity.pausedReason ?? null,
      secretRef: entity.secretRef ?? null,
      hasEncryptedSecrets: Boolean(entity.secretsEncrypted),
      config: redactProviderConfigObject(rawConfig),
      healthStatus: entity.healthStatus,
      healthStatusName: getProviderHealthStatusName(entity.healthStatus),
      lastHealthCheckAt: toIsoOrNull(entity.lastHealthCheckAt),
      lastHealthLatencyMs:
        entity.lastHealthLatencyMs !== null && entity.lastHealthLatencyMs !== undefined
          ? Number(entity.lastHealthLatencyMs)
          : null,
      lastHealthErrorCode: entity.lastHealthErrorCode ?? null,
    };
  }

  public static toUnitAssignmentView(
    entity: ProviderUnitAssignmentEntity,
    providerLookup: ReadonlyMap<number, ProviderRegistryEntryEntity>,
  ): ProviderUnitAssignmentView {
    const primary = providerLookup.get(Number(entity.primaryProviderId));
    const fallback =
      entity.fallbackProviderId !== null && entity.fallbackProviderId !== undefined
        ? providerLookup.get(Number(entity.fallbackProviderId))
        : undefined;

    return {
      id: Number(entity.id),
      providerType: entity.providerType,
      organizationUnitId: Number(entity.organizationUnitId),
      primaryProviderId: Number(entity.primaryProviderId),
      primaryProviderCode: primary?.providerCode ?? null,
      primaryProviderName: primary?.displayName ?? null,
      fallbackProviderId:
        entity.fallbackProviderId !== null && entity.fallbackProviderId !== undefined
          ? Number(entity.fallbackProviderId)
          : null,
      fallbackProviderCode: fallback?.providerCode ?? null,
      fallbackProviderName: fallback?.displayName ?? null,
      allowFallbackOverride:
        entity.allowFallbackOverride === null || entity.allowFallbackOverride === undefined
          ? null
          : Boolean(entity.allowFallbackOverride),
      isEnabled: Boolean(entity.isEnabled),
      notes: entity.notes ?? null,
      createdBy:
        entity.createdBy !== null && entity.createdBy !== undefined
          ? Number(entity.createdBy)
          : null,
      updatedBy:
        entity.updatedBy !== null && entity.updatedBy !== undefined
          ? Number(entity.updatedBy)
          : null,
      version: Number(entity.version ?? 1),
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
    };
  }

  public static toHealthCheckView(entity: ProviderHealthCheckEntity): ProviderHealthCheckView {
    return {
      id: Number(entity.id),
      providerId: Number(entity.providerId),
      providerType: entity.providerType,
      providerCode: entity.providerCode,
      healthStatus: entity.healthStatus,
      healthStatusName: getProviderHealthStatusName(entity.healthStatus),
      latencyMs:
        entity.latencyMs !== null && entity.latencyMs !== undefined
          ? Number(entity.latencyMs)
          : null,
      httpStatus:
        entity.httpStatus !== null && entity.httpStatus !== undefined
          ? Number(entity.httpStatus)
          : null,
      errorCode: entity.errorCode ?? null,
      errorMessage: entity.errorMessage ?? null,
      checkSource: entity.checkSource,
      details: entity.detailsJson
        ? redactProviderConfigObject(
            safeJsonParseObject<Record<string, unknown>>(entity.detailsJson, {}),
          )
        : null,
      checkedBy:
        entity.checkedBy !== null && entity.checkedBy !== undefined
          ? Number(entity.checkedBy)
          : null,
      checkedAt: toIsoOrNull(entity.checkedAt) ?? new Date().toISOString(),
    };
  }

  public static toHistoryView(entity: ProviderConfigHistoryEntity): ProviderConfigHistoryView {
    return {
      id: Number(entity.id),
      providerId:
        entity.providerId !== null && entity.providerId !== undefined
          ? Number(entity.providerId)
          : null,
      providerType: entity.providerType,
      providerCode: entity.providerCode,
      action: entity.action,
      beforeState: entity.beforeStateJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.beforeStateJson, {})
        : null,
      afterState: entity.afterStateJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.afterStateJson, {})
        : null,
      changedFields: safeJsonParseStringArray(entity.changedFieldsJson),
      reason: entity.reason ?? null,
      actorUserId:
        entity.actorUserId !== null && entity.actorUserId !== undefined
          ? Number(entity.actorUserId)
          : null,
      actorIdentifier: entity.actorIdentifier ?? null,
      ipAddress: entity.ipAddress ?? null,
      userAgent: entity.userAgent ?? null,
      requestId: entity.requestId ?? null,
      correlationId: entity.correlationId ?? null,
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
    };
  }
}
