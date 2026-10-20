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
  discoverInstalledModules,
  discoverManifestFeatureFlags,
  safeJsonParseObject,
  safeJsonParseStringArray,
  validateFeatureFlagRules,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type {
  FeatureFlagHistoryRecord,
  FeatureFlagSummary,
  IFeatureFlagsPublicService,
  SyncFeatureFlagsResult,
} from '../contracts/index.js';
import type { FeatureFlagHistoryEntity } from '../entities/feature-flag-history.entity.js';
import type { FeatureFlagEntity } from '../entities/feature-flag.entity.js';
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

const FEATURE_FLAG_CACHE_TTL_SEC = 300;

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
    this.registry.setInstalledModules(discoverInstalledModules());
    const manifestFlags = customFlags ?? discoverManifestFeatureFlags();
    const syncedModules = new Set<string>();

    const mergedFlags = new Map<string, FeatureFlagManifestItem>();
    for (const item of manifestFlags) {
      const normalizedKey = item.key.trim().toLowerCase();
      mergedFlags.set(normalizedKey, item);
      syncedModules.add((item.module ?? normalizedKey.split('.')[0] ?? 'settings').toLowerCase());
    }

    if (this.flagRepository) {
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

          const existing = await this.flagRepository.findByKey(key);
          if (!existing) {
            await this.flagRepository.saveEntity({
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
            await this.flagRepository.saveEntity({
              ...existing,
              module: moduleName,
              name: existing.name || item.name.trim(),
              description: existing.description || item.description.trim(),
              isSystem: item.isSystem ?? existing.isSystem,
            });
          }
        }

        const allDbFlags = await this.flagRepository.findFiltered();
        for (const entity of allDbFlags) {
          this.syncEntityIntoRegistry(entity);
        }
        this.dbHydrated = true;

        return {
          syncedModules: Array.from(syncedModules),
          totalFlags: allDbFlags.length,
        };
      } catch {
        // Fallback to in-memory registry below
      }
    }

    this.registry.registerManifestFlags(Array.from(mergedFlags.values()));
    return {
      syncedModules: Array.from(syncedModules),
      totalFlags: this.registry.listDefinitions().length,
    };
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
        'Feature flag must belong to a valid module (<module>.<feature>).',
        [],
        undefined,
        'FEATURE_FLAG_MODULE_REQUIRED',
      );
    }

    // 5.2.2: Không dùng Feature Flag thay cho việc cài module — chặn tạo/bật flag cho module chưa cài đặt
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
    const actorUserId = this.parseNumericUserId(actor?.id);
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

    this.isPublishingChange = true;
    try {
      this.registry.upsertDefinition(definition);
    } finally {
      this.isPublishingChange = false;
    }

    await this.invalidateCacheForFlag(key);
    const summary = this.toSummary(definition);

    await this.recordHistory({
      flagId,
      flagKey: key,
      action: 'CREATE',
      oldState: null,
      newState: this.toSnapshot(summary),
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
    const actorUserId = this.parseNumericUserId(actor?.id);
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

    this.isPublishingChange = true;
    try {
      this.registry.upsertDefinition(updatedDef);
    } finally {
      this.isPublishingChange = false;
    }

    await this.invalidateCacheForFlag(key);
    const updatedSummary = this.toSummary(updatedDef);

    const action =
      nextStatus === FEATURE_FLAG_STATUS.ARCHIVED && current.status !== FEATURE_FLAG_STATUS.ARCHIVED
        ? 'ARCHIVE'
        : 'UPDATE';

    await this.recordHistory({
      flagId: current.id,
      flagKey: key,
      action,
      oldState: this.toSnapshot(current),
      newState: this.toSnapshot(updatedSummary),
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

    const actorUserId = this.parseNumericUserId(actor?.id);
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

    this.isPublishingChange = true;
    try {
      this.registry.upsertDefinition(updatedDef);
    } finally {
      this.isPublishingChange = false;
    }

    await this.invalidateCacheForFlag(key);
    const updatedSummary = this.toSummary(updatedDef);

    await this.recordHistory({
      flagId: current.id,
      flagKey: key,
      action: 'TOGGLE',
      oldState: this.toSnapshot(current),
      newState: this.toSnapshot(updatedSummary),
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

    // Khi có truyền thời điểm kiểm thử `at`, đánh giá trực tiếp không qua cache tĩnh để chính xác tuyệt đối
    if (context?.at !== undefined && context?.at !== null) {
      return this.registry.evaluate(normalizedKey, context, false);
    }

    const cacheKey = this.buildEvaluationCacheKey(normalizedKey, context);
    const nowMs = Date.now();

    const l1 = this.evaluationCache.get(cacheKey);
    if (l1 && l1.expiresAtMs > nowMs && this.isCachedWindowStillValid(l1.entry, nowMs)) {
      return {
        ...l1.entry,
        fromCache: true,
      };
    }

    if (this.cacheProvider) {
      try {
        const l2Cached = await this.cacheProvider.get<FeatureFlagEvaluationResult>(cacheKey);
        if (l2Cached && this.isCachedWindowStillValid(l2Cached, nowMs)) {
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
    const limit = Math.max(1, Math.min(200, query?.limit ?? 50));
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
          return dbRows.map((row) => this.mapHistoryEntityToRecord(row));
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
          def = this.syncEntityIntoRegistry(entity);
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
          this.syncEntityIntoRegistry(entity);
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

  private syncEntityIntoRegistry(entity: FeatureFlagEntity): RegisteredFeatureFlagDefinition {
    const def: RegisteredFeatureFlagDefinition = {
      id: entity.id,
      key: entity.flagKey.trim().toLowerCase(),
      module: entity.module.trim().toLowerCase(),
      name: entity.name,
      description: entity.description,
      isEnabled: Boolean(entity.isEnabled),
      rolloutPercentage: Number(entity.rolloutPercentage ?? 100),
      targetUserIds: this.parseJsonArray(entity.targetUserIdsJson),
      targetRoles: this.parseJsonArray(entity.targetRolesJson).map((r) => r.toUpperCase()),
      targetOrganizationUnitIds: this.parseJsonArray(entity.targetOrgUnitIdsJson),
      startsAt: entity.startsAt ? new Date(entity.startsAt).toISOString() : null,
      endsAt: entity.endsAt ? new Date(entity.endsAt).toISOString() : null,
      metadata: this.parseJsonObject(entity.metadataJson),
      isSystem: Boolean(entity.isSystem),
      status:
        entity.status === FEATURE_FLAG_STATUS.ARCHIVED
          ? FEATURE_FLAG_STATUS.ARCHIVED
          : FEATURE_FLAG_STATUS.ACTIVE,
      updatedBy: entity.updatedBy ?? null,
      updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : new Date().toISOString(),
    };

    this.isPublishingChange = true;
    try {
      this.registry.upsertDefinition(def);
    } finally {
      this.isPublishingChange = false;
    }

    return def;
  }

  private toSummary(def: RegisteredFeatureFlagDefinition): FeatureFlagSummary {
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
      isModuleInstalled: this.registry.isModuleInstalled(def.module),
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

  private toSnapshot(summary: FeatureFlagSummary): Record<string, unknown> {
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

  private async recordHistory(params: {
    flagId: number;
    flagKey: string;
    action: 'CREATE' | 'UPDATE' | 'TOGGLE' | 'ARCHIVE';
    oldState: Record<string, unknown> | null;
    newState: Record<string, unknown>;
    reason: string | null;
    actor?: UserIdentity | undefined;
  }): Promise<void> {
    const reqCtx = RequestContextService.current();
    const resolvedActor = params.actor ?? (reqCtx?.actor as UserIdentity | undefined) ?? null;
    const actorUserId = this.parseNumericUserId(resolvedActor?.id ?? reqCtx?.userId);
    const actorIdentifier =
      resolvedActor?.email ??
      resolvedActor?.username ??
      (actorUserId !== null ? `user:${actorUserId}` : 'system');
    const ipAddress = reqCtx?.ipAddress ?? '127.0.0.1';
    const userAgent = reqCtx?.userAgent ?? null;
    const requestId = reqCtx?.requestId ?? reqCtx?.correlationId ?? null;
    const correlationId = reqCtx?.correlationId ?? null;
    const nowIso = new Date().toISOString();

    let historyId = ++this.historySeq;

    if (this.historyRepository) {
      try {
        const saved = await this.historyRepository.saveEntity({
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

    this.inMemoryHistory.unshift(record);
    if (this.inMemoryHistory.length > 500) {
      this.inMemoryHistory.length = 500;
    }

    if (this.auditLogService) {
      try {
        await this.auditLogService.record({
          actor: resolvedActor,
          actorUserId,
          actorIdentifier,
          module: 'settings',
          feature: 'feature_flags',
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

  private mapHistoryEntityToRecord(entity: FeatureFlagHistoryEntity): FeatureFlagHistoryRecord {
    const actionUpper = entity.action.toUpperCase();
    const action: 'CREATE' | 'UPDATE' | 'TOGGLE' | 'ARCHIVE' =
      actionUpper === 'CREATE' || actionUpper === 'TOGGLE' || actionUpper === 'ARCHIVE'
        ? actionUpper
        : 'UPDATE';

    return {
      id: entity.id,
      flagId: entity.flagId,
      flagKey: entity.flagKey,
      action,
      oldState: this.parseJsonObject(entity.oldStateJson),
      newState: this.parseJsonObject(entity.newStateJson) ?? {},
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

  private buildEvaluationCacheKey(flagKey: string, context?: FeatureFlagEvaluationContext): string {
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

  private isCachedWindowStillValid(entry: FeatureFlagEvaluationResult, nowMs: number): boolean {
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

  private async invalidateCacheForFlag(flagKey: string): Promise<void> {
    const normalized = flagKey.trim().toLowerCase();
    const prefix = `ff:eval:${normalized}:`;
    const keysToDelete: string[] = [this.buildEvaluationCacheKey(normalized)];
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

  private parseNumericUserId(rawId: unknown): number | null {
    if (typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0) {
      return rawId;
    }
    if (typeof rawId === 'string' && /^\d+$/.test(rawId.trim())) {
      const parsed = Number.parseInt(rawId.trim(), 10);
      return parsed > 0 ? parsed : null;
    }
    return null;
  }

  private parseJsonArray(jsonStr?: string | null): string[] {
    return safeJsonParseStringArray(jsonStr);
  }

  private parseJsonObject(jsonStr?: string | null): Record<string, unknown> | null {
    return safeJsonParseObject(jsonStr, null);
  }
}
