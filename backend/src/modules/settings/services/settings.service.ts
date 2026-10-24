import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { BaseCacheProvider } from '@packages/cache/index.js';
import {
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  type RegisteredSettingDefinition,
  type ResolvedSettingView,
  SETTING_ENVIRONMENT,
  SETTING_ITEM_STATUS,
  type SettingEnvironmentCode,
  SettingRegistryService,
  type SettingResolveContext,
  type SettingValueTypeCode,
  buildSettingScopeKey,
  defaultSettingRegistry,
  discoverManifestSettings,
  getSettingEnvironmentName,
  normalizeSettingEnvironment,
  parseSettingEnvironmentCode,
  parseSettingValueTypeCode,
  resolvePagination,
  validateAndSerializeSettingValue,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  type UserIdentity,
  defaultFieldEncryptionService,
} from '@packages/security/index.js';
import type {
  ISettingsPublicService,
  SettingGroupSummary,
  SettingHistoryRecord,
  SyncSettingsResult,
  SystemSettingSummary,
} from '../contracts/index.js';
import type { SettingGroupEntity } from '../entities/setting-group.entity.js';
import { SETTING_CACHE_TTL_SEC, SETTINGS_AUDIT_META } from '../enum/settings.enum.js';
import {
  buildAndPersistNewSettingDefinition,
  buildSystemSettingSummary,
  mapSettingHistoryEntityToRecord,
  persistAndAuditSettingHistory,
  persistGlobalSettingUpdateRecord,
  persistScopedSettingUpdateRecord,
} from '../helpers/settings-audit-mapper.helper.js';
import {
  hydrateSettingRegistryFromDatabase,
  upsertSettingDefinitionFromManifest,
  upsertSettingGroupFromManifest,
} from '../helpers/settings-hydration.helper.js';
import { SettingGroupRepository } from '../repositories/setting-group.repository.js';
import { SystemSettingHistoryRepository } from '../repositories/system-setting-history.repository.js';
import { SystemSettingScopeRepository } from '../repositories/system-setting-scope.repository.js';
import { SystemSettingRepository } from '../repositories/system-setting.repository.js';
import type {
  BulkUpdateSettingsRequest,
  CreateSettingGroupRequest,
  CreateSettingRequest,
  DeleteSettingScopeQuery,
  ListSettingHistoryQuery,
  ListSettingsQuery,
  ResolveSettingsQuery,
  UpdateSettingValueRequest,
} from '../requests/settings.requests.js';

@Injectable()
export class SettingsService implements ISettingsPublicService, OnModuleInit {
  private readonly registry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;
  private readonly resolvedCache = new Map<
    string,
    { entry: ResolvedSettingView<unknown>; expiresAtMs: number }
  >();
  private readonly inMemoryHistory: SettingHistoryRecord[] = [];
  private historySeq = 0;
  private groupSeq = 100;
  private settingSeq = 100;
  private scopeSeq = 100;
  private isPublishingChange = false;

  constructor(
    @Optional()
    @Inject(SettingGroupRepository)
    private readonly groupRepository?: SettingGroupRepository | null,
    @Optional()
    @Inject(SystemSettingRepository)
    private readonly settingRepository?: SystemSettingRepository | null,
    @Optional()
    @Inject(SystemSettingScopeRepository)
    private readonly scopeRepository?: SystemSettingScopeRepository | null,
    @Optional()
    @Inject(SystemSettingHistoryRepository)
    private readonly historyRepository?: SystemSettingHistoryRepository | null,
    @Optional()
    @Inject(SettingRegistryService)
    settingRegistry?: SettingRegistryService | null,
    @Optional()
    @Inject(FieldEncryptionService)
    fieldEncryptionService?: FieldEncryptionService | null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService | null,
    @Optional()
    @Inject(BaseCacheProvider)
    private readonly cacheProvider?: BaseCacheProvider | null,
  ) {
    this.registry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = fieldEncryptionService ?? defaultFieldEncryptionService;
    this.registry.onSettingChanged(async (evt) => {
      const skipDbPersist = this.isPublishingChange;
      await this.invalidateSettingCacheForKey(evt.key);
      if (
        !skipDbPersist &&
        evt.environment === 'ALL' &&
        evt.organizationUnitId === null &&
        this.settingRepository
      ) {
        try {
          const existing = await this.settingRepository.findByKey(evt.key);
          if (existing) {
            const def = this.registry.getDefinition(evt.key);
            const nextGlobal = def ? def.globalSerializedValue : String(evt.value ?? '');
            if (existing.globalValue !== nextGlobal) {
              await this.settingRepository.saveEntity({
                ...existing,
                globalValue: nextGlobal,
              });
            }
          }
        } catch {
          // Ignore when DB is not ready
        }
      }
    });
  }

  private async publishSettingChanged(event: {
    key: string;
    module: string;
    namespace: string;
    environment: string;
    organizationUnitId: number | null;
    value: unknown;
  }): Promise<void> {
    try {
      this.isPublishingChange = true;
      await this.registry.notifySettingChanged(event);
    } finally {
      this.isPublishingChange = false;
    }
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.syncManifests();
    } catch {
      // Safe fallback to L1 memory when DB tables are not yet initialized in isolated unit tests
    }
  }

  /**
   * Đồng bộ tự động (Idempotent) toàn bộ nhóm cấu hình (`settingGroups`) và cấu hình mặc định (`settings`)
   * từ `module.manifest.json` của tất cả các module vào Database và L1/L2 Cache (Mục 5.1.1 & 5.1.2).
   */
  public async syncManifests(): Promise<SyncSettingsResult> {
    const discovered = discoverManifestSettings();
    const syncedModules = new Set<string>();
    let totalGroups = 0;
    let totalSettings = 0;
    let totalEnvironmentOverrides = 0;

    for (const grp of discovered.groups) {
      syncedModules.add((grp.module ?? 'settings').trim().toLowerCase());
      await upsertSettingGroupFromManifest({
        grp,
        groupRepository: this.groupRepository,
        registry: this.registry,
      });
      totalGroups++;
    }

    for (const item of discovered.settings) {
      syncedModules.add((item.module ?? 'settings').trim().toLowerCase());
      const envCount = await upsertSettingDefinitionFromManifest({
        item,
        settingRepository: this.settingRepository,
        scopeRepository: this.scopeRepository,
        registry: this.registry,
        encryptionService: this.encryptionService,
      });
      totalSettings++;
      totalEnvironmentOverrides += envCount;
    }

    await this.hydrateRegistryFromDbSafe();
    await this.invalidateAllSettingCache();

    return {
      syncedModules: [...syncedModules].sort(),
      totalGroups,
      totalSettings,
      totalEnvironmentOverrides,
    };
  }

  /** Liệt kê danh sách nhóm cấu hình hệ thống kèm số lượng cấu hình trong mỗi nhóm */
  public async listGroups(query?: {
    module?: string | undefined;
    q?: string | undefined;
  }): Promise<SettingGroupSummary[]> {
    await this.hydrateRegistryFromDbSafe();
    const allSettings = this.registry.listDefinitions();
    const countByGroup = new Map<string, number>();
    for (const def of allSettings) {
      countByGroup.set(def.groupCode, (countByGroup.get(def.groupCode) ?? 0) + 1);
    }

    let groups = this.registry.listGroups();
    if (query?.module?.trim()) {
      const m = query.module.trim().toLowerCase();
      groups = groups.filter((g) => g.module === m);
    }
    if (query?.q?.trim()) {
      const kw = query.q.trim().toLowerCase();
      groups = groups.filter(
        (g) =>
          g.code.toLowerCase().includes(kw) ||
          g.name.toLowerCase().includes(kw) ||
          (g.description ?? '').toLowerCase().includes(kw),
      );
    }

    return groups.map((g, idx) => ({
      id: g.id ?? idx + 1,
      code: g.code,
      module: g.module,
      name: g.name,
      description: g.description,
      icon: g.icon,
      sortOrder: g.sortOrder,
      isSystem: g.isSystem,
      status: g.status,
      statusName: g.status === SETTING_ITEM_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
      settingCount: countByGroup.get(g.code) ?? 0,
    }));
  }

  /** Tạo mới nhóm cấu hình hệ thống (Mục 5.1.1) */
  public async createGroup(
    dto: CreateSettingGroupRequest,
    actor?: UserIdentity | null,
  ): Promise<SettingGroupSummary> {
    const code = dto.code.trim().toLowerCase();
    const existing = this.registry.listGroups().find((g) => g.code === code);
    if (existing) {
      throw new ConflictAppException('settings.groupAlreadyExists', [], { code });
    }

    const moduleName = (dto.module ?? 'settings').trim().toLowerCase();
    let savedEntity: SettingGroupEntity | null = null;
    if (this.groupRepository) {
      try {
        savedEntity = await this.groupRepository.saveEntity({
          code,
          module: moduleName,
          name: dto.name.trim(),
          description: dto.description ?? null,
          icon: dto.icon ?? null,
          sortOrder: dto.sortOrder ?? 10,
          isSystem: false,
          status: SETTING_ITEM_STATUS.ACTIVE,
        });
      } catch {
        // Fallback to L1 registry in memory mode
      }
    }

    const registered = this.registry.registerGroup({
      id: savedEntity?.id ? Number(savedEntity.id) : ++this.groupSeq,
      code,
      module: moduleName,
      name: dto.name.trim(),
      description: dto.description ?? null,
      icon: dto.icon ?? null,
      sortOrder: dto.sortOrder ?? 10,
      isSystem: false,
      status: SETTING_ITEM_STATUS.ACTIVE,
    });

    if (this.auditLogService) {
      await this.auditLogService.record({
        actor,
        module: SETTINGS_AUDIT_META.MODULE,
        feature: SETTINGS_AUDIT_META.FEATURES.SETTING_GROUPS,
        action: 'SETTING_GROUP_CREATED',
        resourceType: 'setting_group',
        resourceId: registered.code,
        afterData: {
          code: registered.code,
          module: registered.module,
          name: registered.name,
        },
      });
    }

    return {
      id: registered.id ?? this.groupSeq,
      code: registered.code,
      module: registered.module,
      name: registered.name,
      description: registered.description,
      icon: registered.icon,
      sortOrder: registered.sortOrder,
      isSystem: registered.isSystem,
      status: registered.status,
      statusName: 'ACTIVE',
      settingCount: 0,
    };
  }

  /** Liệt kê danh sách cấu hình có lọc theo nhóm, module, namespace, kiểu dữ liệu, môi trường và đơn vị */
  public async listSettings(query: ListSettingsQuery = {}): Promise<SystemSettingSummary[]> {
    await this.hydrateRegistryFromDbSafe();
    let defs = this.registry.listDefinitions();

    if (query.groupCode?.trim()) {
      const grp = query.groupCode.trim().toLowerCase();
      defs = defs.filter((d) => d.groupCode === grp);
    }
    if (query.module?.trim()) {
      const mod = query.module.trim().toLowerCase();
      defs = defs.filter((d) => d.module === mod);
    }
    if (query.namespace?.trim()) {
      const ns = query.namespace.trim().toLowerCase();
      defs = defs.filter((d) => d.namespace === ns || d.namespace.startsWith(`${ns}.`));
    }
    if (query.valueType !== undefined) {
      const vt = parseSettingValueTypeCode(query.valueType);
      defs = defs.filter((d) => d.valueType === vt);
    }
    if (query.isSensitive !== undefined) {
      defs = defs.filter((d) => d.isSensitive === query.isSensitive);
    }
    if (query.q?.trim()) {
      const kw = query.q.trim().toLowerCase();
      defs = defs.filter(
        (d) =>
          d.key.toLowerCase().includes(kw) ||
          d.name.toLowerCase().includes(kw) ||
          d.namespace.toLowerCase().includes(kw) ||
          (d.description ?? '').toLowerCase().includes(kw),
      );
    }

    const context: SettingResolveContext = {
      environment: query.environment,
      organizationUnitId: query.organizationUnitId,
    };

    return defs.map((def, idx) => this.toSettingSummary(def, context, idx + 1));
  }

  /** Xem chi tiết một cấu hình theo `key` kèm danh sách các bản ghi override theo môi trường / đơn vị */
  public async getSettingByKey(
    key: string,
    context?: SettingResolveContext,
  ): Promise<SystemSettingSummary> {
    await this.hydrateRegistryFromDbSafe();
    const normKey = key.trim().toLowerCase();
    const def = this.registry.getDefinition(normKey);
    if (!def) {
      throw new NotFoundAppException('settings.settingNotFound', { key: normKey });
    }
    return this.toSettingSummary(def, context);
  }

  /**
   * Tạo mới một định nghĩa cấu hình theo module / namespace (Mục 5.1.2 & 5.1.3)
   */
  public async createSetting(
    dto: CreateSettingRequest,
    actor?: UserIdentity | null,
  ): Promise<SystemSettingSummary> {
    const key = dto.key.trim().toLowerCase();
    const existing = this.registry.getDefinition(key);
    if (existing) {
      throw new ConflictAppException('settings.settingAlreadyExists', [], { key });
    }

    const { def, valueType, isSensitive, moduleName, namespace, serializedGlobal, parsedGlobal } =
      await buildAndPersistNewSettingDefinition({
        dto,
        key,
        actorUserId: actor?.id ?? null,
        nextSettingId: () => ++this.settingSeq,
        registry: this.registry,
        encryptionService: this.encryptionService,
        settingRepository: this.settingRepository,
      });

    await this.invalidateSettingCacheForKey(key);

    await this.recordSettingHistory({
      settingId: def.id,
      settingKey: key,
      environmentCode: SETTING_ENVIRONMENT.ALL,
      environment: 'ALL',
      organizationUnitId: null,
      valueType,
      oldSerializedValue: null,
      newSerializedValue: serializedGlobal,
      isSensitive,
      actor,
      reason: dto.reason ?? 'Created new setting definition',
      action: 'SETTING_CREATED',
    });

    await this.publishSettingChanged({
      key,
      module: moduleName,
      namespace,
      environment: 'ALL',
      organizationUnitId: null,
      value: parsedGlobal,
    });

    return this.toSettingSummary(def);
  }

  /**
   * Cập nhật giá trị cấu hình (Toàn cục, theo Môi trường, hoặc theo Đơn vị — Mục 5.1.3 -> 5.1.8)
   */
  public async updateSettingValue(
    key: string,
    dto: UpdateSettingValueRequest,
    actor?: UserIdentity | null,
  ): Promise<SystemSettingSummary> {
    await this.hydrateRegistryFromDbSafe();
    const normKey = key.trim().toLowerCase();
    const def = this.registry.getDefinition(normKey);
    if (!def) {
      throw new NotFoundAppException('settings.settingNotFound', { key: normKey });
    }

    const envCode = parseSettingEnvironmentCode(dto.environment);
    const normEnv = getSettingEnvironmentName(envCode);
    const unitId =
      dto.organizationUnitId !== undefined && dto.organizationUnitId !== null
        ? Number(dto.organizationUnitId)
        : null;

    if (unitId !== null && !def.allowUnitOverride) {
      throw new ForbiddenAppException('settings.unitOverrideNotAllowed', [
        { key: normKey, organizationUnitId: unitId },
      ]);
    }

    const effectiveRules =
      dto.validationRules !== undefined ? dto.validationRules : def.validationRules;
    const validated = validateAndSerializeSettingValue(
      dto.value,
      def.valueType,
      effectiveRules,
      normKey,
    );

    const encryptedValue =
      def.isSensitive && validated.serialized.length > 0
        ? this.encryptionService.encrypt(validated.serialized)
        : validated.serialized;
    const isEncrypted = def.isSensitive && encryptedValue.startsWith('enc:v1:');
    const actorUserId = actor?.id ?? null;

    const isGlobalDefaultScope = envCode === SETTING_ENVIRONMENT.ALL && unitId === null;
    const oldPlainSerialized = isGlobalDefaultScope
      ? await persistGlobalSettingUpdateRecord({
          def,
          normKey,
          dto,
          effectiveRules: effectiveRules ?? null,
          encryptedValue,
          isEncrypted,
          actorUserId,
          registry: this.registry,
          settingRepository: this.settingRepository,
          decryptIfNeeded: (raw, isEnc) => this.decryptIfNeeded(raw, isEnc),
        })
      : await persistScopedSettingUpdateRecord({
          def,
          normKey,
          envCode,
          normEnv,
          unitId,
          encryptedValue,
          isEncrypted,
          actorUserId,
          reason: dto.reason ?? null,
          nextScopeId: () => ++this.scopeSeq,
          registry: this.registry,
          scopeRepository: this.scopeRepository,
          decryptIfNeeded: (raw, isEnc) => this.decryptIfNeeded(raw, isEnc),
        });

    await this.invalidateSettingCacheForKey(normKey);

    await this.recordSettingHistory({
      settingId: def.id,
      settingKey: normKey,
      environmentCode: envCode,
      environment: normEnv,
      organizationUnitId: unitId,
      valueType: def.valueType,
      oldSerializedValue: oldPlainSerialized,
      newSerializedValue: validated.serialized,
      isSensitive: def.isSensitive,
      actor,
      reason: dto.reason ?? null,
      action: isGlobalDefaultScope ? 'SETTING_UPDATED' : 'SETTING_SCOPE_OVERRIDDEN',
    });

    await this.publishSettingChanged({
      key: normKey,
      module: def.module,
      namespace: def.namespace,
      environment: normEnv,
      organizationUnitId: unitId,
      value: validated.parsedValue,
    });

    const latestDef = this.registry.getDefinition(normKey)!;
    return this.toSettingSummary(latestDef, {
      environment: normEnv,
      organizationUnitId: unitId,
    });
  }

  /** Cập nhật hàng loạt nhiều cấu hình trong một thao tác */
  public async bulkUpdateSettings(
    dto: BulkUpdateSettingsRequest,
    actor?: UserIdentity | null,
  ): Promise<SystemSettingSummary[]> {
    const results: SystemSettingSummary[] = [];
    for (const item of dto.items) {
      const updated = await this.updateSettingValue(
        item.key,
        {
          value: item.value,
          environment: item.environment ?? dto.environment,
          organizationUnitId:
            item.organizationUnitId !== undefined
              ? item.organizationUnitId
              : dto.organizationUnitId,
          reason: item.reason ?? dto.reason,
        },
        actor,
      );
      results.push(updated);
    }
    return results;
  }

  /** Xóa bản ghi cấu hình ghi đè theo môi trường / đơn vị để quay về kế thừa giá trị cấp trên */
  public async removeScopeOverride(
    key: string,
    query: DeleteSettingScopeQuery,
    actor?: UserIdentity | null,
  ): Promise<SystemSettingSummary> {
    await this.hydrateRegistryFromDbSafe();
    const normKey = key.trim().toLowerCase();
    const def = this.registry.getDefinition(normKey);
    if (!def) {
      throw new NotFoundAppException('settings.settingNotFound', { key: normKey });
    }

    const envCode = parseSettingEnvironmentCode(query.environment);
    const normEnv = getSettingEnvironmentName(envCode);
    const unitId = query.organizationUnitId ?? null;
    const scopeKey = buildSettingScopeKey(normKey, normEnv, unitId);

    const existing = this.registry
      .listScopeOverridesForKey(normKey)
      .find((o) => o.scopeKey === scopeKey);
    if (!existing) {
      throw new NotFoundAppException('settings.scopeOverrideNotFound', { key: normKey });
    }

    const oldPlain = this.decryptIfNeeded(existing.serializedValue, existing.isEncrypted);
    this.registry.removeScopeOverride(normKey, normEnv, unitId);

    if (this.scopeRepository) {
      try {
        await this.scopeRepository.deleteByScope(def.id, envCode, unitId);
      } catch {
        // Ignore in memory mode
      }
    }

    await this.invalidateSettingCacheForKey(normKey);

    await this.recordSettingHistory({
      settingId: def.id,
      settingKey: normKey,
      environmentCode: envCode,
      environment: normEnv,
      organizationUnitId: unitId,
      valueType: def.valueType,
      oldSerializedValue: oldPlain,
      newSerializedValue: def.globalSerializedValue,
      isSensitive: def.isSensitive,
      actor,
      reason: query.reason ?? 'Removed scoped setting override',
      action: 'SETTING_SCOPE_REMOVED',
    });

    return this.toSettingSummary(def, {
      environment: normEnv,
      organizationUnitId: unitId,
    });
  }

  /**
   * Phân giải giá trị cấu hình hiệu lực theo ngữ cảnh `{ environment, organizationUnitId }`
   * có sử dụng bộ nhớ đệm 2 tầng (L1 + L2 `BaseCacheProvider`) và tự động che giá trị nhạy cảm (Mục 5.1.8).
   */
  public async resolve<T = unknown>(
    key: string,
    context?: SettingResolveContext,
  ): Promise<ResolvedSettingView<T>> {
    await this.hydrateRegistryFromDbSafe();
    const normKey = key.trim().toLowerCase();
    const def = this.registry.getDefinition(normKey);
    if (!def) {
      throw new NotFoundAppException('settings.settingNotFound', { key: normKey });
    }

    const env = normalizeSettingEnvironment(
      context?.environment ?? this.registry.getActiveEnvironment(),
    );
    const unitId =
      context?.organizationUnitId !== undefined && context?.organizationUnitId !== null
        ? Number(context.organizationUnitId)
        : null;

    const cacheKey = this.buildCacheKey(normKey, env, unitId);
    const nowMs = Date.now();

    const localCached = this.resolvedCache.get(cacheKey);
    if (localCached && localCached.expiresAtMs > nowMs) {
      return {
        ...(localCached.entry as ResolvedSettingView<T>),
        fromCache: true,
      };
    }

    if (this.cacheProvider) {
      try {
        const l2Cached = await this.cacheProvider.get<ResolvedSettingView<T>>(cacheKey);
        if (l2Cached) {
          this.resolvedCache.set(cacheKey, {
            entry: l2Cached,
            expiresAtMs: nowMs + SETTING_CACHE_TTL_SEC * 1000,
          });
          return {
            ...l2Cached,
            fromCache: true,
          };
        }
      } catch {
        // Fallback to DB/L1 if L2 cache provider fails
      }
    }

    const freshResolved = this.registry.resolve<T>(
      normKey,
      {
        environment: env,
        organizationUnitId: unitId,
      },
      {
        maskSensitive: true,
        decryptor: (cipher) => this.encryptionService.decrypt(cipher),
        fromCache: false,
      },
    );

    if (!freshResolved) {
      throw new NotFoundAppException('settings.settingNotFound', { key: normKey });
    }

    this.resolvedCache.set(cacheKey, {
      entry: freshResolved,
      expiresAtMs: nowMs + SETTING_CACHE_TTL_SEC * 1000,
    });
    if (this.cacheProvider) {
      try {
        await this.cacheProvider.set(cacheKey, freshResolved, SETTING_CACHE_TTL_SEC);
      } catch {
        // Ignore L2 cache set errors
      }
    }

    return freshResolved;
  }

  /** Phân giải nhiều cấu hình cùng lúc theo danh sách `keys`, `groupCode`, `module` hoặc `namespace` */
  public async resolveMany(
    query: ResolveSettingsQuery = {},
  ): Promise<ResolvedSettingView<unknown>[]> {
    await this.hydrateRegistryFromDbSafe();
    const context: SettingResolveContext = {
      environment: query.environment,
      organizationUnitId: query.organizationUnitId,
    };

    const targetKeys = new Set<string>();
    if (query.key?.trim()) {
      targetKeys.add(query.key.trim().toLowerCase());
    }
    if (query.keys && query.keys.length > 0) {
      for (const k of query.keys) {
        targetKeys.add(k.trim().toLowerCase());
      }
    }

    if (targetKeys.size > 0) {
      const results: ResolvedSettingView<unknown>[] = [];
      for (const k of targetKeys) {
        results.push(await this.resolve(k, context));
      }
      return results;
    }

    let defs = this.registry.listDefinitions();
    if (query.groupCode?.trim()) {
      const g = query.groupCode.trim().toLowerCase();
      defs = defs.filter((d) => d.groupCode === g);
    }
    if (query.module?.trim()) {
      const m = query.module.trim().toLowerCase();
      defs = defs.filter((d) => d.module === m);
    }
    if (query.namespace?.trim()) {
      const ns = query.namespace.trim().toLowerCase();
      defs = defs.filter((d) => d.namespace === ns || d.namespace.startsWith(`${ns}.`));
    }

    const results: ResolvedSettingView<unknown>[] = [];
    for (const def of defs) {
      results.push(await this.resolve(def.key, context));
    }
    return results;
  }

  /**
   * Phương thức nội bộ dành riêng cho các Backend Services (Mailer, Storage, Auth...)
   * để lấy giá trị thật đã giải mã (`AES-256-GCM`) của cấu hình nhạy cảm (Mục 5.1.6).
   */
  public async getDecryptedValue<T = unknown>(
    key: string,
    context?: SettingResolveContext,
  ): Promise<T> {
    await this.hydrateRegistryFromDbSafe();
    const normKey = key.trim().toLowerCase();
    const resolved = this.registry.resolve<T>(normKey, context, {
      maskSensitive: false,
      decryptor: (cipher) => this.encryptionService.decrypt(cipher),
      fromCache: true,
    });
    if (!resolved) {
      throw new NotFoundAppException('settings.settingNotFound', { key: normKey });
    }
    return resolved.value;
  }

  /** Tra cứu danh sách lịch sử thay đổi cấu hình (biết ai đã thay đổi, lúc nào, lý do, giá trị cũ/mới) */
  public async listHistory(query: ListSettingHistoryQuery = {}): Promise<SettingHistoryRecord[]> {
    const { limit } = resolvePagination(query, {
      defaultLimit: 50,
      maxLimit: 200,
      registry: this.registry,
    });

    if (this.historyRepository) {
      try {
        await this.hydrateRegistryFromDbSafe();
        let targetSettingId: number | undefined;
        if (query.settingKey?.trim()) {
          const def = this.registry.getDefinition(query.settingKey.trim().toLowerCase());
          if (!def) {
            return [];
          }
          targetSettingId = def.id;
        }
        const targetEnvCode = query.environment?.trim()
          ? parseSettingEnvironmentCode(query.environment)
          : undefined;

        const dbItems = await this.historyRepository.searchFiltered({
          settingId: targetSettingId,
          environment: targetEnvCode,
          organizationUnitId: query.organizationUnitId,
          actorUserId: query.actorUserId,
          limit,
        });
        if (dbItems.length > 0) {
          return dbItems.map((item) => mapSettingHistoryEntityToRecord(item, this.registry));
        }
      } catch {
        // Fallback to in-memory history list
      }
    }

    let items = [...this.inMemoryHistory];
    if (query.settingKey?.trim()) {
      const k = query.settingKey.trim().toLowerCase();
      items = items.filter((h) => h.settingKey === k);
    }
    if (query.environment?.trim()) {
      const env = normalizeSettingEnvironment(query.environment);
      items = items.filter((h) => h.environment === env);
    }
    if (query.organizationUnitId !== undefined) {
      items = items.filter((h) => h.organizationUnitId === Number(query.organizationUnitId));
    }
    if (query.actorUserId !== undefined) {
      items = items.filter((h) => h.actorUserId === Number(query.actorUserId));
    }

    return items.slice(0, limit);
  }

  private buildCacheKey(settingKey: string, environment: string, unitId: number | null): string {
    return `settings:resolved:${environment}:${unitId ?? 0}:${settingKey}`;
  }

  private async invalidateSettingCacheForKey(settingKey: string): Promise<void> {
    const normKey = settingKey.trim().toLowerCase();
    const keysToDelete = new Set<string>([
      this.buildCacheKey(normKey, 'ALL', null),
      this.buildCacheKey(normKey, this.registry.getActiveEnvironment(), null),
    ]);
    for (const cacheKey of this.resolvedCache.keys()) {
      if (cacheKey.endsWith(`:${normKey}`)) {
        keysToDelete.add(cacheKey);
      }
    }
    for (const ov of this.registry.listScopeOverridesForKey(normKey)) {
      keysToDelete.add(this.buildCacheKey(normKey, ov.environment, ov.organizationUnitId));
    }
    for (const k of keysToDelete) {
      this.resolvedCache.delete(k);
      if (this.cacheProvider) {
        await this.cacheProvider.delete(k);
      }
    }
  }

  private async invalidateAllSettingCache(): Promise<void> {
    const keys = [...this.resolvedCache.keys()];
    this.resolvedCache.clear();
    if (this.cacheProvider) {
      for (const k of keys) {
        await this.cacheProvider.delete(k);
      }
    }
  }

  private decryptIfNeeded(raw: string, isEncrypted: boolean): string {
    if (!raw) return raw;
    if (isEncrypted || this.encryptionService.isEncrypted(raw)) {
      try {
        return this.encryptionService.decrypt(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  private toSettingSummary(
    def: RegisteredSettingDefinition,
    context?: SettingResolveContext,
    fallbackId = 1,
  ): SystemSettingSummary {
    return buildSystemSettingSummary({
      def,
      context,
      fallbackId,
      registry: this.registry,
      encryptionService: this.encryptionService,
      decryptIfNeeded: (raw, isEnc) => this.decryptIfNeeded(raw, isEnc),
    });
  }

  private async recordSettingHistory(input: {
    settingId: number;
    settingKey: string;
    environmentCode: SettingEnvironmentCode;
    environment: string;
    organizationUnitId: number | null;
    valueType: SettingValueTypeCode;
    oldSerializedValue: string | null;
    newSerializedValue: string;
    isSensitive: boolean;
    actor?: UserIdentity | null | undefined;
    reason?: string | null | undefined;
    action: string;
  }): Promise<void> {
    await persistAndAuditSettingHistory({
      ...input,
      nextHistoryId: () => ++this.historySeq,
      historyRepository: this.historyRepository,
      auditLogService: this.auditLogService,
      inMemoryHistory: this.inMemoryHistory,
    });
  }

  private async hydrateRegistryFromDbSafe(): Promise<void> {
    await hydrateSettingRegistryFromDatabase({
      groupRepository: this.groupRepository,
      settingRepository: this.settingRepository,
      scopeRepository: this.scopeRepository,
      registry: this.registry,
      decryptIfNeeded: (raw, isEnc) => this.decryptIfNeeded(raw, isEnc),
      invalidateSettingCacheForKey: (k) => this.invalidateSettingCacheForKey(k),
      publishSettingChanged: (evt) => this.publishSettingChanged(evt),
    });
  }
}
