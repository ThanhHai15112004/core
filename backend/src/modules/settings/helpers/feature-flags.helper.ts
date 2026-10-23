import {
  FEATURE_FLAG_STATUS,
  type FeatureFlagEvaluationContext,
  type FeatureFlagEvaluationResult,
  type FeatureFlagManifestItem,
  type FeatureFlagRegistryService,
  type RegisteredFeatureFlagDefinition,
  discoverInstalledModules,
  discoverManifestFeatureFlags,
  parseNumericUserId,
  safeJsonParseObject,
  safeJsonParseStringArray,
  validateFeatureFlagRules,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  FeatureFlagHistoryRecord,
  FeatureFlagSummary,
  SyncFeatureFlagsResult,
} from '../contracts/index.js';
import type { FeatureFlagHistoryEntity } from '../entities/feature-flag-history.entity.js';
import type { FeatureFlagEntity } from '../entities/feature-flag.entity.js';
import {
  type FeatureFlagHistoryActionType,
  MAX_IN_MEMORY_SETTING_HISTORY,
  SETTINGS_AUDIT_META,
} from '../enum/settings.enum.js';
import type {
  RecordFeatureFlagHistoryParams,
  SyncManifestFeatureFlagsParams,
} from '../types/settings.types.js';

export function mapFeatureFlagEntityToDefinition(
  entity: FeatureFlagEntity,
): RegisteredFeatureFlagDefinition {
  return {
    id: entity.id,
    key: entity.flagKey.trim().toLowerCase(),
    module: entity.module.trim().toLowerCase(),
    name: entity.name,
    description: entity.description,
    isEnabled: Boolean(entity.isEnabled),
    rolloutPercentage: Number(entity.rolloutPercentage ?? 100),
    targetUserIds: safeJsonParseStringArray(entity.targetUserIdsJson),
    targetRoles: safeJsonParseStringArray(entity.targetRolesJson).map((r) => r.toUpperCase()),
    targetOrganizationUnitIds: safeJsonParseStringArray(entity.targetOrgUnitIdsJson),
    startsAt: entity.startsAt ? new Date(entity.startsAt).toISOString() : null,
    endsAt: entity.endsAt ? new Date(entity.endsAt).toISOString() : null,
    metadata: safeJsonParseObject(entity.metadataJson, null),
    isSystem: Boolean(entity.isSystem),
    status:
      entity.status === FEATURE_FLAG_STATUS.ARCHIVED
        ? FEATURE_FLAG_STATUS.ARCHIVED
        : FEATURE_FLAG_STATUS.ACTIVE,
    updatedBy: entity.updatedBy ?? null,
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : new Date().toISOString(),
  };
}

export function mapFeatureFlagDefinitionToSummary(
  def: RegisteredFeatureFlagDefinition,
  registry: FeatureFlagRegistryService,
): FeatureFlagSummary {
  const nowMs = Date.now();
  const startsAtMs = def.startsAt ? Date.parse(def.startsAt) : null;
  const endsAtMs = def.endsAt ? Date.parse(def.endsAt) : null;
  const isExpired = endsAtMs !== null && !Number.isNaN(endsAtMs) && nowMs > endsAtMs;
  const isBeforeStart = startsAtMs !== null && !Number.isNaN(startsAtMs) && nowMs < startsAtMs;
  const isCurrentlyInWindow = !isBeforeStart && !isExpired;

  return {
    id: def.id ?? 0,
    key: def.key,
    module: def.module,
    isModuleInstalled: registry.isModuleInstalled(def.module),
    name: def.name,
    description: def.description,
    isEnabled: def.isEnabled,
    rolloutPercentage: def.rolloutPercentage,
    targetUserIds: [...def.targetUserIds],
    targetRoles: [...def.targetRoles],
    targetOrganizationUnitIds: [...def.targetOrganizationUnitIds],
    startsAt: def.startsAt,
    endsAt: def.endsAt,
    isCurrentlyInWindow,
    isExpired,
    metadata: def.metadata,
    isSystem: def.isSystem,
    status: def.status,
    statusName: def.status === FEATURE_FLAG_STATUS.ARCHIVED ? 'ARCHIVED' : 'ACTIVE',
    updatedBy: def.updatedBy ?? null,
    updatedAt: def.updatedAt ?? new Date().toISOString(),
  };
}

export function buildFeatureFlagSnapshot(summary: FeatureFlagSummary): Record<string, unknown> {
  return {
    key: summary.key,
    module: summary.module,
    name: summary.name,
    description: summary.description,
    isEnabled: summary.isEnabled,
    rolloutPercentage: summary.rolloutPercentage,
    targetUserIds: summary.targetUserIds,
    targetRoles: summary.targetRoles,
    targetOrganizationUnitIds: summary.targetOrganizationUnitIds,
    startsAt: summary.startsAt,
    endsAt: summary.endsAt,
    status: summary.status,
    statusName: summary.statusName,
  };
}

export function mapFeatureFlagHistoryEntityToRecord(
  entity: FeatureFlagHistoryEntity,
): FeatureFlagHistoryRecord {
  const actionUpper = entity.action.toUpperCase();
  const action: FeatureFlagHistoryActionType =
    actionUpper === 'CREATE' || actionUpper === 'TOGGLE' || actionUpper === 'ARCHIVE'
      ? actionUpper
      : 'UPDATE';

  return {
    id: entity.id,
    flagId: entity.flagId,
    flagKey: entity.flagKey,
    action,
    oldState: safeJsonParseObject(entity.oldStateJson, null),
    newState: safeJsonParseObject(entity.newStateJson, null) ?? {},
    actorUserId: entity.actorUserId ?? null,
    actorIdentifier: entity.actorIdentifier ?? null,
    reason: entity.reason ?? null,
    ipAddress: entity.ipAddress ?? null,
    userAgent: entity.userAgent ?? null,
    requestId: entity.requestId ?? null,
    correlationId: entity.correlationId ?? null,
    createdAt: entity.createdAt ? entity.createdAt.toISOString() : new Date().toISOString(),
  };
}

export async function recordFeatureFlagHistoryAndAudit(
  params: RecordFeatureFlagHistoryParams,
): Promise<void> {
  const reqCtx = RequestContextService.current();
  const resolvedActor = params.actor ?? (reqCtx?.actor as UserIdentity | undefined) ?? null;
  const actorUserId = parseNumericUserId(resolvedActor?.id ?? reqCtx?.userId);
  const actorIdentifier =
    resolvedActor?.email ??
    resolvedActor?.username ??
    (actorUserId !== null ? `user:${actorUserId}` : 'system');
  const ipAddress = reqCtx?.ipAddress ?? '127.0.0.1';
  const userAgent = reqCtx?.userAgent ?? null;
  const requestId = reqCtx?.requestId ?? reqCtx?.correlationId ?? null;
  const correlationId = reqCtx?.correlationId ?? null;
  const nowIso = new Date().toISOString();

  let historyId = params.nextHistoryId();

  if (params.historyRepository) {
    try {
      const saved = await params.historyRepository.saveEntity({
        flagId: params.flagId,
        flagKey: params.flagKey,
        action: params.action,
        oldStateJson: params.oldState ? JSON.stringify(params.oldState) : null,
        newStateJson: JSON.stringify(params.newState),
        actorUserId,
        actorIdentifier,
        reason: params.reason,
        ipAddress,
        userAgent,
        requestId,
        correlationId,
      });
      historyId = saved.id;
    } catch {
      // Fallback in-memory
    }
  }

  const record: FeatureFlagHistoryRecord = {
    id: historyId,
    flagId: params.flagId,
    flagKey: params.flagKey,
    action: params.action,
    oldState: params.oldState,
    newState: params.newState,
    actorUserId,
    actorIdentifier,
    reason: params.reason,
    ipAddress,
    userAgent,
    requestId,
    correlationId,
    createdAt: nowIso,
  };

  params.inMemoryHistory.unshift(record);
  if (params.inMemoryHistory.length > MAX_IN_MEMORY_SETTING_HISTORY) {
    params.inMemoryHistory.length = MAX_IN_MEMORY_SETTING_HISTORY;
  }

  if (params.auditLogService) {
    try {
      await params.auditLogService.record({
        actor: resolvedActor,
        actorUserId,
        actorIdentifier,
        module: SETTINGS_AUDIT_META.MODULE,
        feature: SETTINGS_AUDIT_META.FEATURES.FEATURE_FLAGS,
        action: `feature_flag.${params.action.toLowerCase()}`,
        resourceType: 'feature_flag',
        resourceId: params.flagKey,
        beforeData: params.oldState,
        afterData: params.newState,
        reason: params.reason,
        ipAddress,
        userAgent,
        requestId,
        correlationId,
      });
    } catch {
      // Ignore audit log error
    }
  }
}

export async function syncManifestFeatureFlagsToDatabaseAndRegistry(
  params: SyncManifestFeatureFlagsParams,
): Promise<SyncFeatureFlagsResult> {
  const { customFlags, registry, flagRepository, upsertDefinitionSilent, markHydrated } = params;
  registry.setInstalledModules(discoverInstalledModules());
  const manifestFlags = customFlags ?? discoverManifestFeatureFlags();
  const syncedModules = new Set<string>();

  const mergedFlags = new Map<string, FeatureFlagManifestItem>();
  for (const item of manifestFlags) {
    const normalizedKey = item.key.trim().toLowerCase();
    mergedFlags.set(normalizedKey, item);
    syncedModules.add((item.module ?? normalizedKey.split('.')[0] ?? 'settings').toLowerCase());
  }

  if (flagRepository) {
    try {
      for (const item of mergedFlags.values()) {
        const key = item.key.trim().toLowerCase();
        const moduleName = (item.module ?? key.split('.')[0] ?? 'settings').trim().toLowerCase();
        const validated = validateFeatureFlagRules({
          key,
          name: item.name,
          description: item.description,
          rolloutPercentage: item.rolloutPercentage ?? 100,
          targetUserIds: item.targetUserIds ?? [],
          targetRoles: item.targetRoles ?? [],
          targetOrganizationUnitIds: item.targetOrganizationUnitIds ?? [],
          startsAt: item.startsAt ?? null,
          endsAt: item.endsAt ?? null,
        });

        const existing = await flagRepository.findByKey(key);
        if (!existing) {
          await flagRepository.saveEntity({
            flagKey: key,
            module: moduleName,
            name: item.name.trim(),
            description: item.description.trim(),
            isEnabled: Boolean(item.isEnabled ?? false),
            rolloutPercentage: validated.rolloutPercentage,
            targetUserIdsJson: JSON.stringify(validated.targetUserIds),
            targetRolesJson: JSON.stringify(validated.targetRoles),
            targetOrgUnitIdsJson: JSON.stringify(validated.targetOrganizationUnitIds),
            startsAt: validated.startsAt ? new Date(validated.startsAt) : null,
            endsAt: validated.endsAt ? new Date(validated.endsAt) : null,
            metadataJson: item.metadata ? JSON.stringify(item.metadata) : null,
            isSystem: item.isSystem ?? true,
            status:
              item.status === FEATURE_FLAG_STATUS.ARCHIVED
                ? FEATURE_FLAG_STATUS.ARCHIVED
                : FEATURE_FLAG_STATUS.ACTIVE,
          });
        } else {
          await flagRepository.saveEntity({
            ...existing,
            module: moduleName,
            name: existing.name || item.name.trim(),
            description: existing.description || item.description.trim(),
            isSystem: item.isSystem ?? existing.isSystem,
          });
        }
      }

      const allDbFlags = await flagRepository.findFiltered();
      for (const entity of allDbFlags) {
        upsertDefinitionSilent(mapFeatureFlagEntityToDefinition(entity));
      }
      markHydrated();

      return {
        syncedModules: Array.from(syncedModules),
        totalFlags: allDbFlags.length,
      };
    } catch {
      // Fallback to in-memory registry below
    }
  }

  registry.registerManifestFlags(Array.from(mergedFlags.values()));
  return {
    syncedModules: Array.from(syncedModules),
    totalFlags: registry.listDefinitions().length,
  };
}

export function buildFeatureFlagEvaluationCacheKey(
  flagKey: string,
  context?: FeatureFlagEvaluationContext,
): string {
  const userPart =
    context?.userId !== undefined && context?.userId !== null
      ? String(context.userId).trim().toLowerCase()
      : '_anon_';
  const rolesPart = Array.isArray(context?.roles)
    ? [...context.roles]
        .map((r) => String(r).trim().toUpperCase())
        .sort()
        .join(',')
    : '_noroles_';
  const orgUnits: string[] = [];
  if (context?.organizationUnitId !== undefined && context?.organizationUnitId !== null) {
    orgUnits.push(String(context.organizationUnitId).trim().toLowerCase());
  }
  if (Array.isArray(context?.organizationUnitIds)) {
    for (const id of context.organizationUnitIds) {
      if (id !== undefined && id !== null) {
        orgUnits.push(String(id).trim().toLowerCase());
      }
    }
  }
  const orgPart = orgUnits.length > 0 ? orgUnits.sort().join(',') : '_noorg_';
  return `ff:eval:${flagKey}:u=${userPart}:r=${rolesPart}:o=${orgPart}`;
}

export function isCachedFeatureFlagWindowStillValid(
  entry: FeatureFlagEvaluationResult,
  nowMs: number,
): boolean {
  if (entry.startsAt) {
    const startMs = Date.parse(entry.startsAt);
    if (!Number.isNaN(startMs)) {
      const wasBeforeStart = entry.reason === 'NOT_STARTED';
      const isNowBeforeStart = nowMs < startMs;
      if (wasBeforeStart !== isNowBeforeStart) {
        return false;
      }
    }
  }
  if (entry.endsAt) {
    const endMs = Date.parse(entry.endsAt);
    if (!Number.isNaN(endMs)) {
      const wasExpired = entry.reason === 'EXPIRED';
      const isNowExpired = nowMs > endMs;
      if (wasExpired !== isNowExpired) {
        return false;
      }
    }
  }
  return true;
}
