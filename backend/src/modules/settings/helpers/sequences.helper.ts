import {
  type RegisteredSequenceRuleDefinition,
  SEQUENCE_DATE_FORMAT_NAME_BY_CODE,
  SEQUENCE_RESET_POLICY_NAME_BY_CODE,
  SEQUENCE_STATUS,
  type SequenceDateFormatCode,
  type SequenceManifestItem,
  type SequenceRegistryService,
  type SequenceResetPolicyCode,
  type SequenceStatusCode,
  computeSequencePeriodKey,
  discoverManifestSequences,
  formatSequenceCode,
  parseNumericUserId,
  resolveSequenceDateParts,
  safeJsonParseObject,
  validateSequenceRule,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  SequenceRuleHistoryRecord,
  SequenceRuleSummary,
  SyncSequencesResult,
} from '../contracts/index.js';
import type { SequenceRuleHistoryEntity } from '../entities/sequence-rule-history.entity.js';
import type { SequenceRuleEntity } from '../entities/sequence-rule.entity.js';
import {
  MAX_IN_MEMORY_SETTING_HISTORY,
  SETTINGS_AUDIT_META,
  type SequenceHistoryActionType,
} from '../enum/settings.enum.js';
import type {
  RecordSequenceHistoryParams,
  SyncManifestSequencesParams,
} from '../types/settings.types.js';

export function syncSequenceEntityToRegistry(
  entity: SequenceRuleEntity,
  registry: SequenceRegistryService,
): RegisteredSequenceRuleDefinition {
  const dateFormat = (entity.dateFormat ?? 1) as SequenceDateFormatCode;
  const resetPolicy = (entity.resetPolicy ?? 2) as SequenceResetPolicyCode;
  return registry.registerRule(
    {
      id: entity.id,
      key: entity.sequenceKey.trim().toLowerCase(),
      module: entity.module.trim().toLowerCase(),
      name: entity.name,
      description: entity.description ?? null,
      prefix: entity.prefix ?? '',
      suffix: entity.suffix ?? '',
      separator: entity.separator ?? '-',
      dateFormat,
      dateFormatName: SEQUENCE_DATE_FORMAT_NAME_BY_CODE[dateFormat] ?? 'YYYY',
      templatePattern: entity.templatePattern ?? null,
      paddingLength: Number(entity.paddingLength ?? 6),
      startValue: Number(entity.startValue ?? 1),
      step: Number(entity.step ?? 1),
      resetPolicy,
      resetPolicyName: SEQUENCE_RESET_POLICY_NAME_BY_CODE[resetPolicy] ?? 'YEARLY',
      scopeByUnit: Boolean(entity.scopeByUnit),
      timezone: entity.timezone || 'Asia/Ho_Chi_Minh',
      isSystem: Boolean(entity.isSystem),
      status: (entity.status as SequenceStatusCode | undefined) ?? SEQUENCE_STATUS.ACTIVE,
      updatedBy: entity.updatedBy ?? null,
      updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : new Date().toISOString(),
    },
    { silent: true },
  );
}

export function mapSequenceDefinitionToSummary(
  def: RegisteredSequenceRuleDefinition,
  registry: SequenceRegistryService,
): SequenceRuleSummary {
  const dateParts = resolveSequenceDateParts(undefined, def.timezone);
  const currentPeriodKey = computeSequencePeriodKey(def.resetPolicy, dateParts);
  const counters = registry.getCounters(def.key);
  const activePeriodCounters = counters.filter((c) => c.periodKey === currentPeriodKey);
  const currentCounterValue = activePeriodCounters.reduce(
    (max, c) => Math.max(max, c.currentValue),
    0,
  );

  const previewSeq =
    currentCounterValue > 0
      ? Math.max(currentCounterValue + def.step, def.startValue)
      : def.startValue;
  const formatted = formatSequenceCode(def, previewSeq, {
    unitCode: def.scopeByUnit ? 'HCM' : undefined,
    timezone: def.timezone,
  });

  return {
    id: def.id ?? 0,
    key: def.key,
    module: def.module,
    name: def.name,
    description: def.description,
    prefix: def.prefix,
    suffix: def.suffix,
    separator: def.separator,
    dateFormat: def.dateFormat,
    dateFormatName: def.dateFormatName,
    templatePattern: def.templatePattern,
    resolvedTemplate: formatted.resolvedTemplate,
    paddingLength: def.paddingLength,
    startValue: def.startValue,
    step: def.step,
    resetPolicy: def.resetPolicy,
    resetPolicyName: def.resetPolicyName,
    scopeByUnit: def.scopeByUnit,
    timezone: def.timezone,
    samplePreview: formatted.code,
    currentPeriodKey,
    currentCounterValue,
    counters,
    isSystem: def.isSystem,
    status: def.status,
    statusName: def.status === SEQUENCE_STATUS.ARCHIVED ? 'ARCHIVED' : 'ACTIVE',
    updatedBy: def.updatedBy ?? null,
    updatedAt: def.updatedAt ?? new Date().toISOString(),
  };
}

export function serializeSequenceRuleState(
  def: RegisteredSequenceRuleDefinition,
): Record<string, unknown> {
  return {
    key: def.key,
    module: def.module,
    name: def.name,
    description: def.description,
    prefix: def.prefix,
    suffix: def.suffix,
    separator: def.separator,
    dateFormat: def.dateFormat,
    dateFormatName: def.dateFormatName,
    templatePattern: def.templatePattern,
    paddingLength: def.paddingLength,
    startValue: def.startValue,
    step: def.step,
    resetPolicy: def.resetPolicy,
    resetPolicyName: def.resetPolicyName,
    scopeByUnit: def.scopeByUnit,
    timezone: def.timezone,
    status: def.status,
  };
}

export function mapSequenceHistoryEntityToRecord(
  entity: SequenceRuleHistoryEntity,
): SequenceRuleHistoryRecord {
  const actionUpper = entity.action.toUpperCase();
  const action: SequenceHistoryActionType =
    actionUpper === 'CREATE' || actionUpper === 'RESET_COUNTER' || actionUpper === 'ARCHIVE'
      ? actionUpper
      : 'UPDATE';

  return {
    id: entity.id,
    sequenceId: entity.sequenceId,
    sequenceKey: entity.sequenceKey,
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

export async function recordSequenceHistoryAndAudit(
  params: RecordSequenceHistoryParams,
): Promise<void> {
  const reqCtx = RequestContextService.current();
  const resolvedActor = params.actor ?? (reqCtx?.actor as UserIdentity | undefined) ?? null;
  const actorUserId = parseNumericUserId(resolvedActor?.id ?? reqCtx?.userId);
  const actorIdentifier =
    resolvedActor?.email ??
    resolvedActor?.username ??
    (actorUserId ? `user:${actorUserId}` : 'system');
  const ipAddress = reqCtx?.ipAddress ?? '127.0.0.1';
  const userAgent = reqCtx?.userAgent ?? null;
  const requestId = reqCtx?.requestId ?? reqCtx?.correlationId ?? null;
  const correlationId = reqCtx?.correlationId ?? null;
  const nowIso = new Date().toISOString();

  let historyId = params.nextHistoryId();

  if (params.historyRepository) {
    try {
      const saved = await params.historyRepository.saveEntity({
        sequenceId: params.sequenceId,
        sequenceKey: params.sequenceKey,
        action: params.action,
        oldStateJson: params.oldState ? JSON.stringify(params.oldState) : null,
        newStateJson: JSON.stringify(params.newState),
        actorUserId,
        actorIdentifier,
        reason: params.reason ?? null,
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

  const record: SequenceRuleHistoryRecord = {
    id: historyId,
    sequenceId: params.sequenceId,
    sequenceKey: params.sequenceKey,
    action: params.action,
    oldState: params.oldState,
    newState: params.newState,
    actorUserId,
    actorIdentifier,
    reason: params.reason ?? null,
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
        actor: params.actor,
        actorUserId,
        actorIdentifier,
        module: SETTINGS_AUDIT_META.MODULE,
        feature: SETTINGS_AUDIT_META.FEATURES.SEQUENCES,
        action: `sequence.${params.action.toLowerCase()}`,
        resourceType: 'sequence_rule',
        resourceId: params.sequenceKey,
        beforeData: params.oldState,
        afterData: params.newState,
        reason: params.reason ?? null,
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

export async function syncManifestSequencesToDatabaseAndRegistry(
  params: SyncManifestSequencesParams,
): Promise<SyncSequencesResult> {
  const { customSequences, registry, ruleRepository, counterRepository, nextRuleId, markHydrated } =
    params;

  const manifestSequences = customSequences ?? discoverManifestSequences();
  const syncedModules = new Set<string>();

  const merged = new Map<string, SequenceManifestItem>();
  for (const item of manifestSequences) {
    const normalizedKey = item.key.trim().toLowerCase();
    merged.set(normalizedKey, item);
    syncedModules.add((item.module ?? normalizedKey.split('.')[0] ?? 'settings').toLowerCase());
  }

  if (ruleRepository) {
    try {
      for (const item of merged.values()) {
        const key = item.key.trim().toLowerCase();
        const moduleName = (item.module ?? key.split('.')[0] ?? 'settings').trim().toLowerCase();
        const validated = validateSequenceRule({
          key,
          name: item.name,
          prefix: item.prefix,
          suffix: item.suffix,
          separator: item.separator,
          dateFormat: item.dateFormat,
          templatePattern: item.templatePattern,
          paddingLength: item.paddingLength,
          startValue: item.startValue,
          step: item.step,
          resetPolicy: item.resetPolicy,
          scopeByUnit: item.scopeByUnit,
          timezone: item.timezone,
        });

        const existing = await ruleRepository.findByKey(key);
        if (!existing) {
          await ruleRepository.saveEntity({
            sequenceKey: key,
            module: moduleName,
            name: validated.name,
            description: item.description?.trim() ?? null,
            prefix: validated.prefix,
            suffix: validated.suffix,
            separator: validated.separator,
            dateFormat: validated.dateFormat,
            templatePattern: validated.templatePattern,
            paddingLength: validated.paddingLength,
            startValue: validated.startValue,
            step: validated.step,
            resetPolicy: validated.resetPolicy,
            scopeByUnit: validated.scopeByUnit,
            timezone: validated.timezone,
            isSystem: item.isSystem ?? true,
            status: (item.status as SequenceStatusCode | undefined) ?? SEQUENCE_STATUS.ACTIVE,
          });
        } else {
          await ruleRepository.saveEntity({
            ...existing,
            module: moduleName,
            name: existing.name || validated.name,
            description: existing.description ?? item.description?.trim() ?? null,
            isSystem: item.isSystem ?? existing.isSystem,
          });
        }
      }

      const allDbRules = await ruleRepository.findFiltered();
      for (const dbRule of allDbRules) {
        syncSequenceEntityToRegistry(dbRule, registry);
        syncedModules.add(dbRule.module.toLowerCase());
      }

      if (counterRepository) {
        const allCounters = await counterRepository.findAllCounters();
        for (const c of allCounters) {
          registry.setCounterSnapshot({
            sequenceKey: c.sequenceKey.toLowerCase(),
            periodKey: c.periodKey,
            organizationUnitId: c.organizationUnitId ?? null,
            unitScopeKey: c.unitScopeKey,
            currentValue: Number(c.currentValue),
            updatedAt: c.updatedAt ? c.updatedAt.toISOString() : new Date().toISOString(),
          });
        }
      }

      markHydrated();
      return {
        syncedModules: Array.from(syncedModules).sort(),
        totalSequences: allDbRules.length,
      };
    } catch {
      // Fallback to in-memory registry when DB is unavailable
    }
  }

  for (const item of merged.values()) {
    const key = item.key.trim().toLowerCase();
    const moduleName = (item.module ?? key.split('.')[0] ?? 'settings').trim().toLowerCase();
    const validated = validateSequenceRule({
      key,
      name: item.name,
      prefix: item.prefix,
      suffix: item.suffix,
      separator: item.separator,
      dateFormat: item.dateFormat,
      templatePattern: item.templatePattern,
      paddingLength: item.paddingLength,
      startValue: item.startValue,
      step: item.step,
      resetPolicy: item.resetPolicy,
      scopeByUnit: item.scopeByUnit,
      timezone: item.timezone,
    });

    const existing = registry.getRule(key);
    registry.registerRule(
      {
        id: existing?.id ?? nextRuleId(),
        key,
        module: moduleName,
        name: existing?.name ?? validated.name,
        description: existing?.description ?? item.description?.trim() ?? null,
        prefix: existing?.prefix ?? validated.prefix,
        suffix: existing?.suffix ?? validated.suffix,
        separator: existing?.separator ?? validated.separator,
        dateFormat: existing?.dateFormat ?? validated.dateFormat,
        dateFormatName: existing?.dateFormatName ?? validated.dateFormatName,
        templatePattern: existing?.templatePattern ?? validated.templatePattern,
        paddingLength: existing?.paddingLength ?? validated.paddingLength,
        startValue: existing?.startValue ?? validated.startValue,
        step: existing?.step ?? validated.step,
        resetPolicy: existing?.resetPolicy ?? validated.resetPolicy,
        resetPolicyName: existing?.resetPolicyName ?? validated.resetPolicyName,
        scopeByUnit: existing?.scopeByUnit ?? validated.scopeByUnit,
        timezone: existing?.timezone ?? validated.timezone,
        isSystem: item.isSystem ?? existing?.isSystem ?? true,
        status: existing?.status ?? SEQUENCE_STATUS.ACTIVE,
      },
      { silent: true },
    );
  }

  return {
    syncedModules: Array.from(syncedModules).sort(),
    totalSequences: registry.listRules().length,
  };
}
