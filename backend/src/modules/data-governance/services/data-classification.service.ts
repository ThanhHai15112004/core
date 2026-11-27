import { Injectable, Optional } from '@nestjs/common';
import {
  DATA_GOVERNANCE_DOMAIN_EVENTS,
  DataGovernanceHookRegistry,
  DomainEventBusService,
  FeatureFlagRegistryService,
  NotFoundAppException,
  SettingRegistryService,
  createDomainEvent,
  defaultDataGovernanceHookRegistry,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
  type DataClassificationLevel,
  type ExportDatasetSanitizeInput,
  type ExportDatasetSanitizeResult,
  type ISensitiveFieldPolicyEvaluator,
  type PaginatedResult,
  type RetentionPolicyExecutionResult,
  type SensitiveFieldActorContext,
  type SensitiveFieldPolicyRule,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type { DataSensitiveFieldEntity } from '../entities/data-sensitive-field.entity.js';
import {
  assertDataGovernanceEnabled,
  resolveDataGovernanceRuntimeConfig,
} from '../helpers/data-governance-config.helper.js';
import {
  mapClassificationToView,
  mapSensitiveFieldToView,
} from '../helpers/data-governance-mapper.helper.js';
import {
  applySensitiveMaskToRecord,
  maskCsvContentColumns,
} from '../helpers/sensitive-masking.helper.js';
import { DataClassificationRepository } from '../repositories/data-classification.repository.js';
import { DataSensitiveFieldRepository } from '../repositories/data-sensitive-field.repository.js';
import type {
  ListDataClassificationsQuery,
  ListSensitiveFieldsQuery,
  UpdateDataClassificationRequest,
  UpdateSensitiveFieldRequest,
  UpsertDataClassificationRequest,
  UpsertSensitiveFieldRequest,
} from '../requests/data-governance.requests.js';
import type {
  DataClassificationView,
  RetentionSweepSummaryView,
  SensitiveFieldView,
} from '../types/data-governance.types.js';

@Injectable()
export class DataClassificationService implements ISensitiveFieldPolicyEvaluator {
  private cachedEnabledFields: DataSensitiveFieldEntity[] = [];
  private cacheLoaded = false;
  private readonly hookRegistry: DataGovernanceHookRegistry;
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly classificationRepo: DataClassificationRepository,
    private readonly sensitiveFieldRepo: DataSensitiveFieldRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() hookRegistry?: DataGovernanceHookRegistry,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.hookRegistry = hookRegistry ?? defaultDataGovernanceHookRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public async refreshSensitiveFieldCache(): Promise<void> {
    this.cachedEnabledFields = await this.sensitiveFieldRepo.findAllEnabled();
    this.cacheLoaded = true;
    this.hookRegistry.notifyLogRedactSync();
  }

  private async ensureSensitiveCache(): Promise<DataSensitiveFieldEntity[]> {
    if (!this.cacheLoaded) {
      await this.refreshSensitiveFieldCache();
    }
    return this.cachedEnabledFields;
  }

  public getLogRedactFieldNames(): readonly string[] {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    if (!cfg.moduleEnabled) return [];
    const names = new Set<string>();
    for (const item of this.cachedEnabledFields) {
      if (!item.isEnabled || !item.redactInLog) continue;
      const leaf = item.fieldPath.split('.').pop()?.trim();
      if (leaf) names.add(leaf);
    }
    return [...names];
  }

  public async listRulesForResource(
    resourceType: string,
  ): Promise<readonly SensitiveFieldPolicyRule[]> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    if (!cfg.moduleEnabled) return [];
    const enabled = await this.ensureSensitiveCache();
    const cleanRes = resourceType.trim().toLowerCase();
    return enabled
      .filter((f) => {
        const r = f.resourceType.trim().toLowerCase();
        return r === '*' || r === cleanRes;
      })
      .map((f) => ({
        resourceType: f.resourceType,
        fieldPath: f.fieldPath,
        classificationLevel: f.classificationLevel,
        maskStrategy: f.maskStrategy,
        redactInLog: f.redactInLog,
        maskInExport: f.maskInExport,
        requiredPermission: f.requiredPermission,
      }));
  }

  public async sanitizeRecordForActor<T extends Record<string, unknown>>(
    resourceType: string,
    record: T,
    actor?: SensitiveFieldActorContext,
    context: 'read' | 'export' = 'read',
  ): Promise<T> {
    const rules = await this.listRulesForResource(resourceType);
    if (rules.length === 0) return record;
    return applySensitiveMaskToRecord(record, rules, actor, context);
  }

  public async sanitizeCsvExport(
    input: ExportDatasetSanitizeInput,
  ): Promise<ExportDatasetSanitizeResult> {
    if (!input.csvContent) {
      return { csvContent: input.csvContent, maskedColumns: [] };
    }
    const [moduleRules, profileRules] = await Promise.all([
      this.listRulesForResource(input.moduleName),
      input.profileCode !== input.moduleName
        ? this.listRulesForResource(input.profileCode)
        : Promise.resolve([]),
    ]);
    const combined = [...moduleRules, ...profileRules];
    if (combined.length === 0) {
      return { csvContent: input.csvContent, maskedColumns: [] };
    }
    return maskCsvContentColumns({
      csvContent: input.csvContent,
      rules: combined,
      actor: input.actor,
    });
  }

  public async listClassifications(
    query: ListDataClassificationsQuery,
  ): Promise<PaginatedResult<DataClassificationView>> {
    const page = await this.classificationRepo.paginateFiltered({
      classificationLevel: query.classificationLevel,
      moduleName: query.moduleName,
      isEnabled: query.isEnabled,
      search: query.q,
      page: query.page,
      limit: query.limit,
    });
    return {
      data: page.data.map(mapClassificationToView),
      meta: page.meta,
    };
  }

  public async getClassificationSummaryCounts(): Promise<{
    total: number;
    byLevel: Record<DataClassificationLevel, number>;
  }> {
    const all = await this.classificationRepo.findAll();
    const byLevel: Record<DataClassificationLevel, number> = {
      PUBLIC: 0,
      INTERNAL: 0,
      CONFIDENTIAL: 0,
      RESTRICTED: 0,
    };
    for (const item of all) {
      if (item.classificationLevel in byLevel) {
        byLevel[item.classificationLevel] += 1;
      }
    }
    return { total: all.length, byLevel };
  }

  public async upsertClassification(
    dto: UpsertDataClassificationRequest,
    actor?: UserIdentity,
  ): Promise<DataClassificationView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);

    const code = dto.dataTypeCode.trim().toLowerCase();
    const existing = await this.classificationRepo.findByCode(code);
    const entity = existing
      ? Object.assign(existing, {
          displayName: dto.displayName.trim(),
          moduleName: dto.moduleName.trim().toLowerCase(),
          classificationLevel: dto.classificationLevel,
          containsPii: dto.containsPii,
          retentionDays: dto.retentionDays,
          retentionAction: dto.retentionAction,
          legalBasis: dto.legalBasis?.trim() ?? null,
          description: dto.description?.trim() ?? null,
          isEnabled: dto.isEnabled,
          updatedBy: actor?.id ?? null,
        })
      : this.classificationRepo.create({
          dataTypeCode: code,
          displayName: dto.displayName.trim(),
          moduleName: dto.moduleName.trim().toLowerCase(),
          classificationLevel: dto.classificationLevel,
          containsPii: dto.containsPii,
          retentionDays: dto.retentionDays,
          retentionAction: dto.retentionAction,
          legalBasis: dto.legalBasis?.trim() ?? null,
          description: dto.description?.trim() ?? null,
          isEnabled: dto.isEnabled,
          createdBy: actor?.id ?? null,
          updatedBy: actor?.id ?? null,
        });

    const saved = await this.classificationRepo.saveEntity(entity);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'classification',
      action: existing ? 'UPDATE' : 'CREATE',
      resourceType: 'data_classification',
      resourceId: String(saved.id),
      afterData: mapClassificationToView(saved) as unknown as Record<string, unknown>,
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.CLASSIFICATION_UPDATED,
        sourceModule: 'data-governance',
        aggregateType: 'data_classification',
        aggregateId: String(saved.id),
        actorId: actor?.id ?? null,
        payload: {
          dataTypeCode: saved.dataTypeCode,
          classificationLevel: saved.classificationLevel,
          retentionDays: saved.retentionDays,
        },
      }),
    );
    return mapClassificationToView(saved);
  }

  public async updateClassification(
    id: number,
    dto: UpdateDataClassificationRequest,
    actor?: UserIdentity,
  ): Promise<DataClassificationView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);

    const existing = await this.classificationRepo.findById(id);
    if (!existing) {
      throw new NotFoundAppException('data-governance.classificationNotFound', { id });
    }
    if (dto.displayName !== undefined) existing.displayName = dto.displayName.trim();
    if (dto.moduleName !== undefined) existing.moduleName = dto.moduleName.trim().toLowerCase();
    if (dto.classificationLevel !== undefined)
      existing.classificationLevel = dto.classificationLevel;
    if (dto.containsPii !== undefined) existing.containsPii = dto.containsPii;
    if (dto.retentionDays !== undefined) existing.retentionDays = dto.retentionDays;
    if (dto.retentionAction !== undefined) existing.retentionAction = dto.retentionAction;
    if (dto.legalBasis !== undefined) existing.legalBasis = dto.legalBasis?.trim() ?? null;
    if (dto.description !== undefined) existing.description = dto.description?.trim() ?? null;
    if (dto.isEnabled !== undefined) existing.isEnabled = dto.isEnabled;
    existing.updatedBy = actor?.id ?? null;

    const saved = await this.classificationRepo.saveEntity(existing);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'classification',
      action: 'UPDATE',
      resourceType: 'data_classification',
      resourceId: String(saved.id),
      afterData: mapClassificationToView(saved) as unknown as Record<string, unknown>,
    });
    return mapClassificationToView(saved);
  }

  public async listSensitiveFields(
    query: ListSensitiveFieldsQuery,
  ): Promise<PaginatedResult<SensitiveFieldView>> {
    const page = await this.sensitiveFieldRepo.paginateFiltered({
      resourceType: query.resourceType,
      classificationLevel: query.classificationLevel,
      isEnabled: query.isEnabled,
      search: query.q,
      page: query.page,
      limit: query.limit,
    });
    return {
      data: page.data.map(mapSensitiveFieldToView),
      meta: page.meta,
    };
  }

  public async getSensitiveFieldStats(): Promise<{
    total: number;
    logRedacted: number;
    exportMasked: number;
  }> {
    const all = await this.sensitiveFieldRepo.findAll();
    let logRedacted = 0;
    let exportMasked = 0;
    for (const f of all) {
      if (f.isEnabled && f.redactInLog) logRedacted += 1;
      if (f.isEnabled && f.maskInExport) exportMasked += 1;
    }
    return { total: all.length, logRedacted, exportMasked };
  }

  public async upsertSensitiveField(
    dto: UpsertSensitiveFieldRequest,
    actor?: UserIdentity,
  ): Promise<SensitiveFieldView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);

    const resType = dto.resourceType.trim().toLowerCase();
    const pathKey = dto.fieldPath.trim();
    const existing = await this.sensitiveFieldRepo.findByResourceAndPath(resType, pathKey);

    const entity = existing
      ? Object.assign(existing, {
          displayName: dto.displayName.trim(),
          classificationLevel: dto.classificationLevel,
          maskStrategy: dto.maskStrategy,
          redactInLog: dto.redactInLog,
          maskInExport: dto.maskInExport,
          requiredPermission: dto.requiredPermission?.trim() || null,
          description: dto.description?.trim() ?? null,
          isEnabled: dto.isEnabled,
          updatedBy: actor?.id ?? null,
        })
      : this.sensitiveFieldRepo.create({
          resourceType: resType,
          fieldPath: pathKey,
          displayName: dto.displayName.trim(),
          classificationLevel: dto.classificationLevel,
          maskStrategy: dto.maskStrategy,
          redactInLog: dto.redactInLog,
          maskInExport: dto.maskInExport,
          requiredPermission: dto.requiredPermission?.trim() || null,
          description: dto.description?.trim() ?? null,
          isEnabled: dto.isEnabled,
          createdBy: actor?.id ?? null,
          updatedBy: actor?.id ?? null,
        });

    const saved = await this.sensitiveFieldRepo.saveEntity(entity);
    await this.refreshSensitiveFieldCache();

    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'sensitive-field',
      action: existing ? 'UPDATE' : 'CREATE',
      resourceType: 'data_sensitive_field',
      resourceId: String(saved.id),
      afterData: mapSensitiveFieldToView(saved) as unknown as Record<string, unknown>,
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.SENSITIVE_FIELD_UPDATED,
        sourceModule: 'data-governance',
        aggregateType: 'data_sensitive_field',
        aggregateId: String(saved.id),
        actorId: actor?.id ?? null,
        payload: {
          resourceType: saved.resourceType,
          fieldPath: saved.fieldPath,
          redactInLog: saved.redactInLog,
          maskInExport: saved.maskInExport,
        },
      }),
    );

    return mapSensitiveFieldToView(saved);
  }

  public async updateSensitiveField(
    id: number,
    dto: UpdateSensitiveFieldRequest,
    actor?: UserIdentity,
  ): Promise<SensitiveFieldView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);

    const existing = await this.sensitiveFieldRepo.findById(id);
    if (!existing) {
      throw new NotFoundAppException('data-governance.sensitiveFieldNotFound', { id });
    }
    if (dto.resourceType !== undefined)
      existing.resourceType = dto.resourceType.trim().toLowerCase();
    if (dto.fieldPath !== undefined) existing.fieldPath = dto.fieldPath.trim();
    if (dto.displayName !== undefined) existing.displayName = dto.displayName.trim();
    if (dto.classificationLevel !== undefined)
      existing.classificationLevel = dto.classificationLevel;
    if (dto.maskStrategy !== undefined) existing.maskStrategy = dto.maskStrategy;
    if (dto.redactInLog !== undefined) existing.redactInLog = dto.redactInLog;
    if (dto.maskInExport !== undefined) existing.maskInExport = dto.maskInExport;
    if (dto.requiredPermission !== undefined) {
      existing.requiredPermission = dto.requiredPermission?.trim() || null;
    }
    if (dto.description !== undefined) existing.description = dto.description?.trim() ?? null;
    if (dto.isEnabled !== undefined) existing.isEnabled = dto.isEnabled;
    existing.updatedBy = actor?.id ?? null;

    const saved = await this.sensitiveFieldRepo.saveEntity(existing);
    await this.refreshSensitiveFieldCache();

    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'sensitive-field',
      action: 'UPDATE',
      resourceType: 'data_sensitive_field',
      resourceId: String(saved.id),
      afterData: mapSensitiveFieldToView(saved) as unknown as Record<string, unknown>,
    });

    return mapSensitiveFieldToView(saved);
  }

  public async runRetentionSweep(options?: {
    readonly dataTypeCode?: string | undefined;
    readonly dryRun?: boolean | undefined;
    readonly now?: Date | undefined;
    readonly actor?: UserIdentity | undefined;
  }): Promise<RetentionSweepSummaryView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    const now = options?.now ?? new Date();
    const dryRun = options?.dryRun ?? false;
    if (!cfg.moduleEnabled) {
      return {
        executedAt: now.toISOString(),
        dryRun,
        evaluatedPolicies: 0,
        results: [],
      };
    }

    const enabledPolicies = await this.classificationRepo.findAllEnabled();
    const targetPolicies = options?.dataTypeCode?.trim()
      ? enabledPolicies.filter((p) => p.dataTypeCode === options.dataTypeCode!.trim().toLowerCase())
      : enabledPolicies;

    const holdGuard = this.hookRegistry.getLegalHoldGuard();
    const results: RetentionPolicyExecutionResult[] = [];

    for (const policy of targetPolicies) {
      if (policy.retentionDays <= 0 || policy.retentionAction === 'RETAIN_LEGAL') {
        results.push({
          dataTypeCode: policy.dataTypeCode,
          scannedCount: 0,
          affectedCount: 0,
          skippedLegalHoldCount: 0,
          actionApplied: 'RETAINED_BY_POLICY',
        });
        continue;
      }

      if (holdGuard) {
        const typeHold = await holdGuard.checkLegalHold({ dataTypeCode: policy.dataTypeCode });
        if (typeHold.onHold) {
          results.push({
            dataTypeCode: policy.dataTypeCode,
            scannedCount: 0,
            affectedCount: 0,
            skippedLegalHoldCount: 1,
            actionApplied: 'SKIPPED_DATA_TYPE_LEGAL_HOLD',
          });
          continue;
        }
      }

      const executor = this.hookRegistry.getRetentionExecutor(policy.dataTypeCode);
      if (!executor) {
        results.push({
          dataTypeCode: policy.dataTypeCode,
          scannedCount: 0,
          affectedCount: 0,
          skippedLegalHoldCount: 0,
          actionApplied: 'NO_EXECUTOR_REGISTERED',
        });
        continue;
      }

      const cutoffDate = new Date(now.getTime() - policy.retentionDays * 86_400_000);
      const execRes = await executor.executeRetention({
        dataTypeCode: policy.dataTypeCode,
        retentionDays: policy.retentionDays,
        retentionAction: policy.retentionAction,
        cutoffDate,
        dryRun,
        isUserUnderLegalHold: async (userId: number) => {
          if (!holdGuard) return false;
          const res = await holdGuard.checkLegalHold({
            userId,
            dataTypeCode: policy.dataTypeCode,
          });
          return res.onHold;
        },
        isResourceUnderLegalHold: async (resourceType: string, resourceId: string | number) => {
          if (!holdGuard) return false;
          const res = await holdGuard.checkLegalHold({
            resourceType,
            resourceId,
            dataTypeCode: policy.dataTypeCode,
          });
          return res.onHold;
        },
      });
      results.push(execRes);

      if (!dryRun) {
        policy.lastEnforcedAt = now;
        await this.classificationRepo.saveEntity(policy);
      }
    }

    await this.auditLogService?.record({
      actor: options?.actor,
      module: 'data-governance',
      feature: 'retention',
      action: dryRun ? 'SIMULATE' : 'EXECUTE',
      resourceType: 'retention_sweep',
      afterData: {
        dryRun,
        evaluatedPolicies: targetPolicies.length,
        results,
      },
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.RETENTION_EXECUTED,
        sourceModule: 'data-governance',
        aggregateType: 'retention_sweep',
        aggregateId: now.toISOString(),
        actorId: options?.actor?.id ?? null,
        payload: { dryRun, evaluatedPolicies: targetPolicies.length, results },
      }),
    );

    return {
      executedAt: now.toISOString(),
      dryRun,
      evaluatedPolicies: targetPolicies.length,
      results,
    };
  }
}
