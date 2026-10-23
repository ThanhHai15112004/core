import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { BaseCacheProvider } from '@packages/cache/index.js';
import {
  ConflictAppException,
  FEATURE_FLAG_STATUS,
  type FeatureFlagEvaluationContext,
  type FeatureFlagEvaluationResult,
  type FeatureFlagManifestItem,
  FeatureFlagRegistryService,
  type FeatureFlagStatusCode,
  NotFoundAppException,
  type RegisteredFeatureFlagDefinition,
  UnprocessableEntityAppException,
  defaultFeatureFlagRegistry,
  defaultMenuRegistry,
  parseNumericUserId,
  resolvePagination,
  validateFeatureFlagRules,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type {
  FeatureFlagHistoryRecord,
  FeatureFlagSummary,
  IFeatureFlagsPublicService,
  SyncFeatureFlagsResult,
} from '../contracts/index.js';
import {
  FEATURE_FLAG_CACHE_TTL_SEC,
  type FeatureFlagHistoryActionType,
} from '../enum/settings.enum.js';
import {
  buildFeatureFlagEvaluationCacheKey,
  buildFeatureFlagSnapshot,
  isCachedFeatureFlagWindowStillValid,
  mapFeatureFlagDefinitionToSummary,
  mapFeatureFlagEntityToDefinition,
  mapFeatureFlagHistoryEntityToRecord,
  recordFeatureFlagHistoryAndAudit,
  syncManifestFeatureFlagsToDatabaseAndRegistry,
} from '../helpers/feature-flags.helper.js';
import { FeatureFlagHistoryRepository } from '../repositories/feature-flag-history.repository.js';
import { FeatureFlagRepository } from '../repositories/feature-flag.repository.js';
import type {
  CreateFeatureFlagRequest,
  EvaluateFeatureFlagsQuery,
  ListFeatureFlagHistoryQuery,
  ListFeatureFlagsQuery,
  ToggleFeatureFlagRequest,
  UpdateFeatureFlagRequest,
} from '../requests/settings.requests.js';

@Injectable()
export class FeatureFlagsService implements IFeatureFlagsPublicService, OnModuleInit {
  private readonly registry: FeatureFlagRegistryService;
  private readonly evaluationCache = new Map<
    string,
    { entry: FeatureFlagEvaluationResult; expiresAtMs: number }
  >();
  private readonly inMemoryHistory: FeatureFlagHistoryRecord[] = [];
  private historySeq = 0;
  private flagSeq = 100;
  private isPublishingChange = false;
  private dbHydrated = false;

  constructor(
    @Optional() private readonly flagRepository?: FeatureFlagRepository | null,
    @Optional() private readonly historyRepository?: FeatureFlagHistoryRepository | null,
    @Optional()
    @Inject(FeatureFlagRegistryService)
    featureFlagRegistry?: FeatureFlagRegistryService | null,
    @Optional() private readonly auditLogService?: AuditLogService | null,
    @Optional() private readonly cacheProvider?: BaseCacheProvider | null,
  ) {
    this.registry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
    this.registry.onFlagChanged(async (evt) => {
      const skipDbPersist = this.isPublishingChange;
      await this.invalidateCacheForFlag(evt.key);
      if (!skipDbPersist && this.flagRepository) {
        try {
          const existing = await this.flagRepository.findByKey(evt.key);
          const def = this.registry.getDefinition(evt.key);
          if (existing && def) {
            await this.flagRepository.saveEntity({
              ...existing,
              isEnabled: def.isEnabled,
              rolloutPercentage: def.rolloutPercentage,
              targetUserIdsJson: JSON.stringify(def.targetUserIds),
              targetRolesJson: JSON.stringify(def.targetRoles),
              targetOrgUnitIdsJson: JSON.stringify(def.targetOrganizationUnitIds),
              startsAt: def.startsAt ? new Date(def.startsAt) : null,
              endsAt: def.endsAt ? new Date(def.endsAt) : null,
              status: def.status,
            });
          }
        } catch {
          // Ignore when DB is not ready
        }
      }
    });
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.syncManifests();
    } catch {
      // Allow graceful startup before migration/seeding
    }
  }

  /**
   * 5.2.2: Cập nhật danh sách module đã được cài đặt (`enabledModules`) phục vụ kiểm tra hợp lệ.
   */
  public setInstalledModules(modules: readonly string[]): void {
    this.registry.setInstalledModules(modules);
    this.evaluationCache.clear();
    defaultMenuRegistry.invalidateCache();
  }

  public getInstalledModules(): string[] {
    return this.registry.getInstalledModules();
  }

  /**
   * Đồng bộ Idempotent các Feature Flag khai báo trong `module.manifest.json` vào DB & Kernel Registry.
   */
  public async syncManifests(
    customFlags?: readonly FeatureFlagManifestItem[],
  ): Promise<SyncFeatureFlagsResult> {
    return syncManifestFeatureFlagsToDatabaseAndRegistry({
      customFlags,
      registry: this.registry,
      flagRepository: this.flagRepository,
      upsertDefinitionSilent: (def) => this.upsertDefinitionSilent(def),
      markHydrated: () => {
        this.dbHydrated = true;
      },
    });
  }

  /**
   * 5.2.1 -> 5.2.7: Tạo mới Feature Flag với key, mô tả rõ ràng, kiểm tra module đã cài đặt và các quy tắc nhắm mục tiêu.
   */
  public async createFeatureFlag(
    input: CreateFeatureFlagRequest,
    actor?: UserIdentity,
  ): Promise<FeatureFlagSummary> {
    const key = input.key.trim().toLowerCase();
    const moduleName = (input.module ?? key.split('.')[0] ?? '').trim().toLowerCase();

    if (!moduleName) {
      throw new UnprocessableEntityAppException(
        'settings.featureFlagModuleRequired',
        [],
        undefined,
        'FEATURE_FLAG_MODULE_REQUIRED',
      );
    }

    if (!this.registry.isModuleInstalled(moduleName)) {
      throw new UnprocessableEntityAppException(
        `Cannot create or enable feature flag "${key}" because module "${moduleName}" is not installed in enabledModules.`,
        [
          {
            key,
            module: moduleName,
            installedModules: this.registry.getInstalledModules(),
          },
        ],
        undefined,
        'FEATURE_FLAG_MODULE_NOT_INSTALLED',
      );
    }

    const validated = validateFeatureFlagRules({
      key,
      name: input.name,
      description: input.description,
      rolloutPercentage: input.rolloutPercentage ?? 100,
      targetUserIds: input.targetUserIds ?? [],
      targetRoles: input.targetRoles ?? [],
      targetOrganizationUnitIds: input.targetOrganizationUnitIds ?? [],
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    });

    const existingInRegistry = this.registry.getDefinition(key);
    const existingInDb = this.flagRepository ? await this.flagRepository.findByKey(key) : null;
    if (existingInRegistry || existingInDb) {
      throw new ConflictAppException(
        `Feature flag "${key}" already exists.`,
        [],
        undefined,
        'FEATURE_FLAG_ALREADY_EXISTS',
      );
    }

    const nowIso = new Date().toISOString();
    const isEnabled = Boolean(input.isEnabled ?? false);
    const actorUserId = parseNumericUserId(actor?.id);
    let flagId = ++this.flagSeq;

    if (this.flagRepository) {
      try {
        const saved = await this.flagRepository.saveEntity({
          flagKey: key,
          module: moduleName,
          name: input.name.trim(),
          description: input.description.trim(),
          isEnabled,
          rolloutPercentage: validated.rolloutPercentage,
          targetUserIdsJson: JSON.stringify(validated.targetUserIds),
          targetRolesJson: JSON.stringify(validated.targetRoles),
          targetOrgUnitIdsJson: JSON.stringify(validated.targetOrganizationUnitIds),
          startsAt: validated.startsAt ? new Date(validated.startsAt) : null,
          endsAt: validated.endsAt ? new Date(validated.endsAt) : null,
          metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
          isSystem: input.isSystem ?? false,
          status: FEATURE_FLAG_STATUS.ACTIVE,
          updatedBy: actorUserId,
        });
        flagId = saved.id;
      } catch {
        // Fallback in-memory
      }
    }

    const definition: RegisteredFeatureFlagDefinition = {
      id: flagId,
      key,
      module: moduleName,
      name: input.name.trim(),
      description: input.description.trim(),
      isEnabled,
      rolloutPercentage: validated.rolloutPercentage,
      targetUserIds: validated.targetUserIds,
      targetRoles: validated.targetRoles,
      targetOrganizationUnitIds: validated.targetOrganizationUnitIds,
      startsAt: validated.startsAt,
      endsAt: validated.endsAt,
      metadata: input.metadata ?? null,
      isSystem: input.isSystem ?? false,
      status: FEATURE_FLAG_STATUS.ACTIVE,
      updatedBy: actorUserId,
      updatedAt: nowIso,
    };

    this.upsertDefinitionSilent(definition);
    await this.invalidateCacheForFlag(key);
    const summary = this.toSummary(definition);

    await this.recordHistory({
      flagId,
      flagKey: key,
      action: 'CREATE',
      oldState: null,
      newState: buildFeatureFlagSnapshot(summary),
      reason: input.reason ?? 'Created feature flag',
      actor,
    });

    return summary;
  }

  /**
   * 5.2.2 -> 5.2.7: Cập nhật quy tắc nhắm mục tiêu (người dùng, vai trò, đơn vị, tỷ lệ rollout, thời gian bắt đầu/kết thúc).
   */
  public async updateFeatureFlag(
    flagKey: string,
    input: UpdateFeatureFlagRequest,
    actor?: UserIdentity,
  ): Promise<FeatureFlagSummary> {
    const current = await this.getFlagOrThrow(flagKey);
    const key = current.key;

    if (input.isEnabled === true && !this.registry.isModuleInstalled(current.module)) {
      throw new UnprocessableEntityAppException(
        `Cannot enable feature flag "${key}" because module "${current.module}" is not installed in enabledModules.`,
        [
          {
            key,
            module: current.module,
            installedModules: this.registry.getInstalledModules(),
          },
        ],
        undefined,
        'FEATURE_FLAG_MODULE_NOT_INSTALLED',
      );
    }

    const nextName = input.name !== undefined ? input.name.trim() : current.name;
    const nextDescription =
      input.description !== undefined ? input.description.trim() : current.description;
    const nextIsEnabled = input.isEnabled !== undefined ? input.isEnabled : current.isEnabled;
    const nextRollout =
      input.rolloutPercentage !== undefined ? input.rolloutPercentage : current.rolloutPercentage;
    const nextUsers =
      input.targetUserIds !== undefined ? input.targetUserIds : current.targetUserIds;
    const nextRoles = input.targetRoles !== undefined ? input.targetRoles : current.targetRoles;
    const nextOrgUnits =
      input.targetOrganizationUnitIds !== undefined
        ? input.targetOrganizationUnitIds
        : current.targetOrganizationUnitIds;
    const nextStartsAt = input.startsAt !== undefined ? input.startsAt : current.startsAt;
    const nextEndsAt = input.endsAt !== undefined ? input.endsAt : current.endsAt;

    const validated = validateFeatureFlagRules({
      key,
      name: nextName,
      description: nextDescription,
      rolloutPercentage: nextRollout,
      targetUserIds: nextUsers,
      targetRoles: nextRoles,
      targetOrganizationUnitIds: nextOrgUnits,
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
    });

    const nextMetadata = input.metadata !== undefined ? input.metadata : current.metadata;
    const nextStatus: FeatureFlagStatusCode =
      input.status === FEATURE_FLAG_STATUS.ARCHIVED
        ? FEATURE_FLAG_STATUS.ARCHIVED
        : input.status === FEATURE_FLAG_STATUS.ACTIVE
          ? FEATURE_FLAG_STATUS.ACTIVE
          : current.status === FEATURE_FLAG_STATUS.ARCHIVED
            ? FEATURE_FLAG_STATUS.ARCHIVED
            : FEATURE_FLAG_STATUS.ACTIVE;
    const actorUserId = parseNumericUserId(actor?.id);
    const nowIso = new Date().toISOString();

    if (this.flagRepository) {
      try {
        const existingEntity = await this.flagRepository.findByKey(key);
        if (existingEntity) {
          await this.flagRepository.saveEntity({
            ...existingEntity,
            name: nextName,
            description: nextDescription,
            isEnabled: nextIsEnabled,
            rolloutPercentage: validated.rolloutPercentage,
            targetUserIdsJson: JSON.stringify(validated.targetUserIds),
            targetRolesJson: JSON.stringify(validated.targetRoles),
            targetOrgUnitIdsJson: JSON.stringify(validated.targetOrganizationUnitIds),
            startsAt: validated.startsAt ? new Date(validated.startsAt) : null,
            endsAt: validated.endsAt ? new Date(validated.endsAt) : null,
            metadataJson: nextMetadata ? JSON.stringify(nextMetadata) : null,
            status: nextStatus,
            updatedBy: actorUserId,
          });
        }
      } catch {
        // Fallback in-memory
      }
    }

    const updatedDef: RegisteredFeatureFlagDefinition = {
      id: current.id,
      key,
      module: current.module,
      name: nextName,
      description: nextDescription,
      isEnabled: nextIsEnabled,
      rolloutPercentage: validated.rolloutPercentage,
      targetUserIds: validated.targetUserIds,
      targetRoles: validated.targetRoles,
      targetOrganizationUnitIds: validated.targetOrganizationUnitIds,
      startsAt: validated.startsAt,
      endsAt: validated.endsAt,
      metadata: nextMetadata,
      isSystem: current.isSystem,
      status: nextStatus,
      updatedBy: actorUserId,
      updatedAt: nowIso,
    };

    this.upsertDefinitionSilent(updatedDef);
    await this.invalidateCacheForFlag(key);
    const updatedSummary = this.toSummary(updatedDef);

    const action: FeatureFlagHistoryActionType =
      nextStatus === FEATURE_FLAG_STATUS.ARCHIVED && current.status !== FEATURE_FLAG_STATUS.ARCHIVED
        ? 'ARCHIVE'
        : 'UPDATE';

    await this.recordHistory({
      flagId: current.id,
      flagKey: key,
      action,
      oldState: buildFeatureFlagSnapshot(current),
      newState: buildFeatureFlagSnapshot(updatedSummary),
      reason: input.reason ?? `Updated feature flag (${action})`,
      actor,
    });

    return updatedSummary;
  }

  /**
   * 5.2.2: Bật hoặc tắt nhanh chức năng đã được cài (kiểm tra `enabledModules` trước khi cho phép bật).
   */
  public async toggleFeatureFlag(
    flagKey: string,
    input: ToggleFeatureFlagRequest,
    actor?: UserIdentity,
  ): Promise<FeatureFlagSummary> {
    const current = await this.getFlagOrThrow(flagKey);
    const key = current.key;

    if (input.isEnabled && !this.registry.isModuleInstalled(current.module)) {
      throw new UnprocessableEntityAppException(
        `Cannot enable feature flag "${key}" because module "${current.module}" is not installed in enabledModules.`,
        [
          {
            key,
            module: current.module,
            installedModules: this.registry.getInstalledModules(),
          },
        ],
        undefined,
        'FEATURE_FLAG_MODULE_NOT_INSTALLED',
      );
    }

    const actorUserId = parseNumericUserId(actor?.id);
    const nowIso = new Date().toISOString();

    if (this.flagRepository) {
      try {
        const existingEntity = await this.flagRepository.findByKey(key);
        if (existingEntity) {
          await this.flagRepository.saveEntity({
            ...existingEntity,
            isEnabled: input.isEnabled,
            updatedBy: actorUserId,
          });
        }
      } catch {
        // Fallback in-memory
      }
    }

    const updatedDef: RegisteredFeatureFlagDefinition = {
      id: current.id,
      key,
      module: current.module,
      name: current.name,
      description: current.description,
      isEnabled: input.isEnabled,
      rolloutPercentage: current.rolloutPercentage,
      targetUserIds: current.targetUserIds,
      targetRoles: current.targetRoles,
      targetOrganizationUnitIds: current.targetOrganizationUnitIds,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      metadata: current.metadata,
      isSystem: current.isSystem,
      status:
        current.status === FEATURE_FLAG_STATUS.ARCHIVED
          ? FEATURE_FLAG_STATUS.ARCHIVED
          : FEATURE_FLAG_STATUS.ACTIVE,
      updatedBy: actorUserId,
      updatedAt: nowIso,
    };

    this.upsertDefinitionSilent(updatedDef);
    await this.invalidateCacheForFlag(key);
    const updatedSummary = this.toSummary(updatedDef);

    await this.recordHistory({
      flagId: current.id,
      flagKey: key,
      action: 'TOGGLE',
      oldState: buildFeatureFlagSnapshot(current),
      newState: buildFeatureFlagSnapshot(updatedSummary),
      reason: input.reason ?? (input.isEnabled ? 'Enabled feature flag' : 'Disabled feature flag'),
      actor,
    });

    return updatedSummary;
  }

  public async listFeatureFlags(query?: ListFeatureFlagsQuery): Promise<FeatureFlagSummary[]> {
    await this.ensureLoadedFromDb();
    let definitions = this.registry.listDefinitions({
      module: query?.module,
      isEnabled: query?.isEnabled,
      status: query?.status,
    });

    if (query?.q?.trim()) {
      const keyword = query.q.trim().toLowerCase();
      definitions = definitions.filter(
        (d) =>
          d.key.toLowerCase().includes(keyword) ||
          d.name.toLowerCase().includes(keyword) ||
          d.description.toLowerCase().includes(keyword),
      );
    }

    return definitions.map((d) => this.toSummary(d));
  }

  public async getFeatureFlagByKey(flagKey: string): Promise<FeatureFlagSummary> {
    return this.getFlagOrThrow(flagKey);
  }

  /**
   * 5.2.2 -> 5.2.7: Đánh giá trạng thái hiệu lực của 1 Feature Flag theo ngữ cảnh (User, Role, OrgUnit, Rollout %, Time window).
   */
  public async evaluate(
    key: string,
    context?: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagEvaluationResult> {
    await this.ensureLoadedFromDb();
    const normalizedKey = key.trim().toLowerCase();

    if (context?.at !== undefined && context?.at !== null) {
      return this.registry.evaluate(normalizedKey, context, false);
    }

    const cacheKey = buildFeatureFlagEvaluationCacheKey(normalizedKey, context);
    const nowMs = Date.now();

    const l1 = this.evaluationCache.get(cacheKey);
    if (l1 && l1.expiresAtMs > nowMs && isCachedFeatureFlagWindowStillValid(l1.entry, nowMs)) {
      return {
        ...l1.entry,
        fromCache: true,
      };
    }

    if (this.cacheProvider) {
      try {
        const l2Cached = await this.cacheProvider.get<FeatureFlagEvaluationResult>(cacheKey);
        if (l2Cached && isCachedFeatureFlagWindowStillValid(l2Cached, nowMs)) {
          const cachedView: FeatureFlagEvaluationResult = {
            ...l2Cached,
            fromCache: true,
          };
          this.evaluationCache.set(cacheKey, {
            entry: cachedView,
            expiresAtMs: nowMs + FEATURE_FLAG_CACHE_TTL_SEC * 1000,
          });
          return cachedView;
        }
      } catch {
        // Ignore cache error
      }
    }

    const fresh = this.registry.evaluate(normalizedKey, context, false);
    this.evaluationCache.set(cacheKey, {
      entry: fresh,
      expiresAtMs: nowMs + FEATURE_FLAG_CACHE_TTL_SEC * 1000,
    });

    if (this.cacheProvider) {
      try {
        await this.cacheProvider.set(cacheKey, fresh, FEATURE_FLAG_CACHE_TTL_SEC);
      } catch {
        // Ignore cache write error
      }
    }

    return fresh;
  }

  public async isEnabled(key: string, context?: FeatureFlagEvaluationContext): Promise<boolean> {
    const result = await this.evaluate(key, context);
    return result.enabled;
  }

  public async evaluateMany(
    query: EvaluateFeatureFlagsQuery,
    actor?: UserIdentity,
  ): Promise<FeatureFlagEvaluationResult[]> {
    await this.ensureLoadedFromDb();
    const firstActorOrgUnitId =
      Array.isArray(actor?.organizationUnitIds) && actor.organizationUnitIds.length > 0
        ? String(actor.organizationUnitIds[0])
        : null;
    const context: FeatureFlagEvaluationContext = {
      userId: query.userId ?? (actor?.id !== undefined ? String(actor.id) : null),
      roles: query.roles ?? actor?.roles ?? [],
      organizationUnitId: query.organizationUnitId ?? firstActorOrgUnitId,
      organizationUnitIds:
        query.organizationUnitIds ??
        (Array.isArray(actor?.organizationUnitIds)
          ? actor.organizationUnitIds.map((id) => String(id))
          : []),
      at: query.at ?? null,
    };

    const targetKeys = new Set<string>();
    if (query.key?.trim()) {
      targetKeys.add(query.key.trim().toLowerCase());
    }
    if (Array.isArray(query.keys)) {
      for (const k of query.keys) {
        if (k.trim()) targetKeys.add(k.trim().toLowerCase());
      }
    }

    if (targetKeys.size === 0) {
      const defs = this.registry.listDefinitions({
        module: query.module,
      });
      for (const def of defs) {
        targetKeys.add(def.key);
      }
    }

    const results: FeatureFlagEvaluationResult[] = [];
    for (const k of targetKeys) {
      results.push(await this.evaluate(k, context));
    }
    return results;
  }

  /**
   * 5.2.8: Truy vấn lịch sử thay đổi Feature Flag.
   */
  public async listHistory(
    query?: ListFeatureFlagHistoryQuery,
  ): Promise<FeatureFlagHistoryRecord[]> {
    const { limit } = resolvePagination(query, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const filterKey = query?.flagKey?.trim().toLowerCase();
    const filterAction = query?.action?.trim().toUpperCase();

    if (this.historyRepository) {
      try {
        const dbRows = await this.historyRepository.searchFiltered({
          flagKey: filterKey,
          action: filterAction,
          actorUserId: query?.actorUserId,
          limit,
        });
        if (dbRows.length > 0) {
          return dbRows.map((row) => mapFeatureFlagHistoryEntityToRecord(row));
        }
      } catch {
        // Fallback to in-memory history
      }
    }

    return this.inMemoryHistory
      .filter((item) => {
        if (filterKey && item.flagKey.toLowerCase() !== filterKey) return false;
        if (filterAction && item.action !== filterAction) return false;
        if (query?.actorUserId !== undefined && item.actorUserId !== query.actorUserId) {
          return false;
        }
        return true;
      })
      .slice(0, limit);
  }

  private async getFlagOrThrow(flagKey: string): Promise<FeatureFlagSummary> {
    await this.ensureLoadedFromDb();
    const normalizedKey = flagKey.trim().toLowerCase();
    let def = this.registry.getDefinition(normalizedKey);

    if (!def && this.flagRepository) {
      try {
        const entity = await this.flagRepository.findByKey(normalizedKey);
        if (entity) {
          def = mapFeatureFlagEntityToDefinition(entity);
          this.upsertDefinitionSilent(def);
        }
      } catch {
        // Ignore DB error
      }
    }

    if (!def) {
      throw new NotFoundAppException(`Feature flag "${normalizedKey}" was not found.`, {
        key: normalizedKey,
      });
    }

    return this.toSummary(def);
  }

  private async ensureLoadedFromDb(): Promise<void> {
    if (this.flagRepository && !this.dbHydrated) {
      this.dbHydrated = true;
      try {
        const allDbFlags = await this.flagRepository.findFiltered();
        for (const entity of allDbFlags) {
          this.upsertDefinitionSilent(mapFeatureFlagEntityToDefinition(entity));
        }
      } catch {
        // Ignore DB error when table is not yet migrated
      }
    }
    if (this.registry.listDefinitions().length > 0) {
      return;
    }
    await this.syncManifests();
  }

  private upsertDefinitionSilent(def: RegisteredFeatureFlagDefinition): void {
    this.isPublishingChange = true;
    try {
      this.registry.upsertDefinition(def);
    } finally {
      this.isPublishingChange = false;
    }
  }

  private toSummary(def: RegisteredFeatureFlagDefinition): FeatureFlagSummary {
    return mapFeatureFlagDefinitionToSummary(def, this.registry);
  }

  private async recordHistory(params: {
    flagId: number;
    flagKey: string;
    action: FeatureFlagHistoryActionType;
    oldState: Record<string, unknown> | null;
    newState: Record<string, unknown>;
    reason: string | null;
    actor?: UserIdentity | undefined;
  }): Promise<void> {
    await recordFeatureFlagHistoryAndAudit({
      ...params,
      nextHistoryId: () => ++this.historySeq,
      historyRepository: this.historyRepository,
      auditLogService: this.auditLogService,
      inMemoryHistory: this.inMemoryHistory,
    });
  }

  private async invalidateCacheForFlag(flagKey: string): Promise<void> {
    const normalized = flagKey.trim().toLowerCase();
    const prefix = `ff:eval:${normalized}:`;
    const keysToDelete: string[] = [buildFeatureFlagEvaluationCacheKey(normalized)];
    for (const key of this.evaluationCache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    for (const k of keysToDelete) {
      this.evaluationCache.delete(k);
      if (this.cacheProvider) {
        try {
          await this.cacheProvider.delete(k);
        } catch {
          // Ignore cache error
        }
      }
    }
    defaultMenuRegistry.invalidateCache();
  }
}
