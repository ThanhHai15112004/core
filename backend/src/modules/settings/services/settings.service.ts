import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { BaseCacheProvider } from '@packages/cache/index.js';
import {
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  type RegisteredSettingDefinition,
  type RegisteredSettingGroup,
  type RegisteredSettingScopeOverride,
  type ResolvedSettingView,
  SENSITIVE_SETTING_MASK,
  SETTING_ENVIRONMENT,
  SETTING_ITEM_STATUS,
  type SettingEnvironmentCode,
  type SettingGroupManifestItem,
  type SettingManifestItem,
  SettingRegistryService,
  type SettingResolveContext,
  type SettingValidationRules,
  type SettingValueTypeCode,
  buildSettingScopeKey,
  defaultSettingRegistry,
  deserializeSettingValue,
  discoverManifestSettings,
  getSettingEnvironmentName,
  getSettingValueTypeName,
  normalizeSettingEnvironment,
  parseSettingEnvironmentCode,
  parseSettingValueTypeCode,
  validateAndSerializeSettingValue,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  type UserIdentity,
} from '@packages/security/index.js';
import type {
  ISettingsPublicService,
  SettingGroupSummary,
  SettingHistoryRecord,
  SettingScopeOverrideSummary,
  SyncSettingsResult,
  SystemSettingSummary,
} from '../contracts/index.js';
import type { SettingGroupEntity } from '../entities/setting-group.entity.js';
import type { SystemSettingHistoryEntity } from '../entities/system-setting-history.entity.js';
import type { SystemSettingScopeEntity } from '../entities/system-setting-scope.entity.js';
import type { SystemSettingEntity } from '../entities/system-setting.entity.js';
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

const SETTING_CACHE_TTL_SEC = 300;

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
    @Optional() private readonly groupRepository?: SettingGroupRepository | null,
    @Optional() private readonly settingRepository?: SystemSettingRepository | null,
    @Optional() private readonly scopeRepository?: SystemSettingScopeRepository | null,
    @Optional() private readonly historyRepository?: SystemSettingHistoryRepository | null,
    @Optional()
    @Inject(SettingRegistryService)
    settingRegistry?: SettingRegistryService | null,
    @Optional() fieldEncryptionService?: FieldEncryptionService | null,
    @Optional() private readonly auditLogService?: AuditLogService | null,
    @Optional() private readonly cacheProvider?: BaseCacheProvider | null,
  ) {
    this.registry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = fieldEncryptionService ?? new FieldEncryptionService();
    this.registry.onSettingChanged(async (evt) => {
      await this.invalidateSettingCacheForKey(evt.key);
      if (
        !this.isPublishingChange &&
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
      await this.upsertGroupFromManifest(grp);
      totalGroups++;
    }

    for (const item of discovered.settings) {
      syncedModules.add((item.module ?? 'settings').trim().toLowerCase());
      const envCount = await this.upsertSettingFromManifest(item);
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

  // =========================================================================
  // 1. NHÓM CẤU HÌNH HỆ THỐNG (Mục 5.1.1 — Email, File, Bảo mật, Giao diện...)
  // =========================================================================

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
        module: 'settings',
        feature: 'setting_groups',
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

  // =========================================================================
  // 2. QUẢN LÝ & TRA CỨU CẤU HÌNH THEO MODULE / NAMESPACE (Mục 5.1.2 -> 5.1.6)
  // =========================================================================

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
   * Tạo mới một định nghĩa cấu hình theo module / namespace (Mục 5.1.2 & 5.1.3):
   * - Tự động kiểm tra kiểu dữ liệu `TEXT`, `NUMBER`, `BOOLEAN`, `JSON` trước khi lưu
   * - Tự động mã hóa `AES-256-GCM` nếu `isSensitive = true` (Mục 5.1.6)
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

    const groupCode = dto.groupCode.trim().toLowerCase();
    let group = this.registry.getGroupByCode(groupCode);
    if (!group) {
      group = this.registry.registerGroup({
        code: groupCode,
        module: (dto.module ?? 'settings').trim().toLowerCase(),
        name: groupCode.toUpperCase(),
      });
    }
    const groupId = group.id;

    const valueType = parseSettingValueTypeCode(dto.valueType);
    const rules: SettingValidationRules | null = dto.validationRules ?? null;

    const validatedDefault = validateAndSerializeSettingValue(
      dto.defaultValue,
      valueType,
      rules,
      key,
    );
    const initialRawValue = dto.value !== undefined ? dto.value : dto.defaultValue;
    const validatedGlobal = validateAndSerializeSettingValue(
      initialRawValue,
      valueType,
      rules,
      key,
    );

    const isSensitive = dto.isSensitive === true;
    const storedGlobalValue =
      isSensitive && validatedGlobal.serialized.length > 0
        ? this.encryptionService.encrypt(validatedGlobal.serialized)
        : validatedGlobal.serialized;
    const isEncrypted = isSensitive && storedGlobalValue.startsWith('enc:v1:');

    const parts = key.split('.');
    const moduleName = (dto.module ?? parts[0] ?? 'settings').trim().toLowerCase();
    const namespace = (
      dto.namespace ?? (parts.length >= 2 ? `${moduleName}.${parts[0]}` : moduleName)
    )
      .trim()
      .toLowerCase();
    const actorUserId = actor?.id ?? null;

    let savedEntity: SystemSettingEntity | null = null;
    if (this.settingRepository) {
      try {
        savedEntity = await this.settingRepository.saveEntity({
          settingKey: key,
          groupId,
          module: moduleName,
          namespace,
          name: dto.name.trim(),
          description: dto.description ?? null,
          valueType,
          defaultValue: validatedDefault.serialized,
          globalValue: storedGlobalValue,
          validationRulesJson: rules ? JSON.stringify(rules) : null,
          isSensitive,
          isEncrypted,
          allowUnitOverride: dto.allowUnitOverride ?? true,
          isSystem: dto.isSystem ?? false,
          sortOrder: dto.sortOrder ?? 10,
          status: SETTING_ITEM_STATUS.ACTIVE,
          updatedBy: actorUserId,
        });
      } catch {
        // Fallback to L1 memory
      }
    }

    const def: RegisteredSettingDefinition = {
      id: savedEntity?.id ? Number(savedEntity.id) : ++this.settingSeq,
      groupId,
      key,
      groupCode,
      module: moduleName,
      namespace,
      name: dto.name.trim(),
      description: dto.description ?? null,
      valueType,
      valueTypeName: getSettingValueTypeName(valueType),
      defaultSerializedValue: validatedDefault.serialized,
      globalSerializedValue: storedGlobalValue,
      validationRules: rules,
      isSensitive,
      isEncrypted,
      allowUnitOverride: dto.allowUnitOverride ?? true,
      isSystem: dto.isSystem ?? false,
      sortOrder: dto.sortOrder ?? 10,
      status: SETTING_ITEM_STATUS.ACTIVE,
      updatedBy: actorUserId,
    };

    this.registry.upsertDefinition(def);
    await this.invalidateSettingCacheForKey(key);

    await this.recordSettingHistory({
      settingId: def.id,
      settingKey: key,
      environmentCode: SETTING_ENVIRONMENT.ALL,
      environment: 'ALL',
      organizationUnitId: null,
      valueType,
      oldSerializedValue: null,
      newSerializedValue: validatedGlobal.serialized,
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
      value: validatedGlobal.parsedValue,
    });

    return this.toSettingSummary(def);
  }

  /**
   * Cập nhật giá trị cấu hình (Toàn cục, theo Môi trường, hoặc theo Đơn vị — Mục 5.1.3 -> 5.1.8):
   * - Kiểm tra đúng kiểu `TEXT`, `NUMBER`, `BOOLEAN`, `JSON` và `validationRules` trước khi lưu
   * - Chặn ghi đè theo đơn vị nếu `allowUnitOverride = false`
   * - Tự động mã hóa `AES-256-GCM` nếu `isSensitive = true`
   * - Tự động ghi lịch sử thay đổi (`system_setting_histories` + `AuditLogService`)
   * - Tự động xóa Cache (`BaseCacheProvider` + L1) để cập nhật tức thì
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
    let oldPlainSerialized: string | null = null;

    if (isGlobalDefaultScope) {
      oldPlainSerialized = this.decryptIfNeeded(def.globalSerializedValue, def.isEncrypted);

      const updatedDef: RegisteredSettingDefinition = {
        ...def,
        name: dto.name?.trim() || def.name,
        description: dto.description !== undefined ? dto.description : def.description,
        allowUnitOverride:
          dto.allowUnitOverride !== undefined ? dto.allowUnitOverride : def.allowUnitOverride,
        validationRules: effectiveRules ?? null,
        globalSerializedValue: encryptedValue,
        isEncrypted,
        updatedBy: actorUserId,
      };

      if (this.settingRepository) {
        try {
          const existingDb = await this.settingRepository.findByKey(normKey);
          if (existingDb) {
            await this.settingRepository.saveEntity({
              ...existingDb,
              name: updatedDef.name,
              description: updatedDef.description,
              allowUnitOverride: updatedDef.allowUnitOverride,
              validationRulesJson: updatedDef.validationRules
                ? JSON.stringify(updatedDef.validationRules)
                : null,
              globalValue: encryptedValue,
              isEncrypted,
              updatedBy: actorUserId,
            });
          }
        } catch {
          // Fallback to L1 memory
        }
      }

      this.registry.upsertDefinition(updatedDef);
    } else {
      const scopeKey = buildSettingScopeKey(normKey, normEnv, unitId);
      const existingOverride = this.registry
        .listScopeOverridesForKey(normKey)
        .find((o) => o.scopeKey === scopeKey);
      oldPlainSerialized = existingOverride
        ? this.decryptIfNeeded(existingOverride.serializedValue, existingOverride.isEncrypted)
        : null;

      let savedScope: SystemSettingScopeEntity | null = null;
      if (this.scopeRepository) {
        try {
          const existingDbScope = await this.scopeRepository.findByScope(def.id, envCode, unitId);
          savedScope = await this.scopeRepository.saveEntity({
            ...(existingDbScope ? { id: existingDbScope.id } : {}),
            settingId: def.id,
            environment: envCode,
            organizationUnitId: unitId,
            settingValue: encryptedValue,
            isEncrypted,
            updatedBy: actorUserId,
            reason: dto.reason ?? null,
          });
        } catch {
          // Fallback to L1 memory
        }
      }

      this.registry.upsertScopeOverride({
        id: savedScope?.id ? Number(savedScope.id) : (existingOverride?.id ?? ++this.scopeSeq),
        settingId: def.id,
        settingKey: normKey,
        environmentCode: envCode,
        environment: normEnv,
        organizationUnitId: unitId,
        scopeKey,
        serializedValue: encryptedValue,
        isEncrypted,
        updatedBy: actorUserId,
        reason: dto.reason ?? null,
        updatedAt: new Date().toISOString(),
      });
    }

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

  // =========================================================================
  // 3. PHÂN GIẢI CẤU HÌNH CÓ CACHE & ĐỌC SECRET NỘI BỘ (Mục 5.1.4 -> 5.1.8)
  // =========================================================================

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
      await this.cacheProvider.set(cacheKey, freshResolved, SETTING_CACHE_TTL_SEC);
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
   * Tuyệt đối KHÔNG phơi bày hàm này trực tiếp ra HTTP Response công khai.
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

  // =========================================================================
  // 4. LỊCH SỬ THAY ĐỔI CẤU HÌNH (Mục 5.1.7)
  // =========================================================================

  /** Tra cứu danh sách lịch sử thay đổi cấu hình (biết ai đã thay đổi, lúc nào, lý do, giá trị cũ/mới) */
  public async listHistory(query: ListSettingHistoryQuery = {}): Promise<SettingHistoryRecord[]> {
    const limit = Math.max(1, Math.min(200, query.limit ?? 50));

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
          return dbItems.map((item) => this.mapHistoryEntityToRecord(item));
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

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

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

  private formatMaskedOrDeserializedValue(
    serialized: string | null | undefined,
    valueType: SettingValueTypeCode,
    isSensitive: boolean,
    isEncrypted: boolean,
  ): unknown {
    if (serialized === null || serialized === undefined) {
      return null;
    }
    if (isSensitive) {
      return serialized.length > 0 ? SENSITIVE_SETTING_MASK : '';
    }
    const plain = this.decryptIfNeeded(serialized, isEncrypted);
    return deserializeSettingValue(plain, valueType);
  }

  private toSettingSummary(
    def: RegisteredSettingDefinition,
    context?: SettingResolveContext,
    fallbackId = 1,
  ): SystemSettingSummary {
    const resolved = this.registry.resolve(def.key, context, {
      maskSensitive: true,
      decryptor: (cipher) => this.encryptionService.decrypt(cipher),
      fromCache: true,
    });

    const overrides = this.registry
      .listScopeOverridesForKey(def.key)
      .map((ov, idx): SettingScopeOverrideSummary => ({
        id: ov.id ?? idx + 1,
        settingId: ov.settingId ?? def.id,
        settingKey: ov.settingKey,
        environmentCode: ov.environmentCode,
        environment: ov.environment,
        organizationUnitId: ov.organizationUnitId,
        scopeKey: ov.scopeKey,
        value: this.formatMaskedOrDeserializedValue(
          ov.serializedValue,
          def.valueType,
          def.isSensitive,
          ov.isEncrypted,
        ),
        isSensitive: def.isSensitive,
        isEncrypted: ov.isEncrypted,
        hasValue: ov.serializedValue.length > 0,
        updatedBy: ov.updatedBy,
        reason: ov.reason,
        updatedAt: ov.updatedAt ?? new Date().toISOString(),
      }));

    const globalFormatted = this.formatMaskedOrDeserializedValue(
      def.globalSerializedValue,
      def.valueType,
      def.isSensitive,
      def.isEncrypted,
    );
    const defaultFormatted = this.formatMaskedOrDeserializedValue(
      def.defaultSerializedValue,
      def.valueType,
      def.isSensitive,
      false,
    );

    return {
      id: def.id ?? fallbackId,
      groupId: def.groupId,
      key: def.key,
      groupCode: def.groupCode,
      module: def.module,
      namespace: def.namespace,
      name: def.name,
      description: def.description,
      valueType: def.valueType,
      valueTypeName: def.valueTypeName,
      value: resolved ? resolved.value : globalFormatted,
      globalValue: globalFormatted,
      defaultValue: defaultFormatted,
      validationRules: def.validationRules,
      isSensitive: def.isSensitive,
      isEncrypted: def.isEncrypted,
      hasValue: resolved ? resolved.hasValue : def.globalSerializedValue.length > 0,
      allowUnitOverride: def.allowUnitOverride,
      isSystem: def.isSystem,
      sortOrder: def.sortOrder,
      status: def.status,
      statusName: def.status === SETTING_ITEM_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
      resolvedSource: resolved?.resolvedSource ?? 'GLOBAL',
      resolvedEnvironment: resolved?.resolvedEnvironment ?? 'ALL',
      resolvedOrganizationUnitId: resolved?.resolvedOrganizationUnitId ?? null,
      scopeOverrides: overrides,
      updatedBy: def.updatedBy,
      updatedAt: new Date().toISOString(),
    };
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
    const ctx = RequestContextService.current();
    const resolvedActor = input.actor ?? (ctx?.actor as UserIdentity | undefined) ?? null;
    const actorUserId =
      resolvedActor?.id ??
      (ctx?.userId && !Number.isNaN(Number(ctx.userId)) ? Number(ctx.userId) : null);
    const actorIdentifier =
      resolvedActor?.email ??
      resolvedActor?.username ??
      (actorUserId ? `user:${actorUserId}` : 'system');
    const ipAddress = ctx?.ipAddress ?? '127.0.0.1';
    const userAgent = ctx?.userAgent ?? null;
    const requestId = ctx?.requestId ?? ctx?.correlationId ?? null;
    const correlationId = ctx?.correlationId ?? null;

    const safeOldSerialized = input.isSensitive
      ? input.oldSerializedValue
        ? SENSITIVE_SETTING_MASK
        : null
      : input.oldSerializedValue;
    const safeNewSerialized = input.isSensitive
      ? input.newSerializedValue
        ? SENSITIVE_SETTING_MASK
        : ''
      : input.newSerializedValue;

    let savedId = ++this.historySeq;
    if (this.historyRepository) {
      try {
        const saved = await this.historyRepository.saveEntity({
          settingId: input.settingId,
          environment: input.environmentCode,
          organizationUnitId: input.organizationUnitId,
          valueType: input.valueType,
          oldValue: safeOldSerialized,
          newValue: safeNewSerialized,
          actorUserId,
          actorIdentifier,
          reason: input.reason ?? null,
          ipAddress,
          userAgent,
          requestId,
          correlationId,
        });
        savedId = Number(saved.id);
      } catch {
        // Fallback to in-memory history
      }
    }

    const oldParsed =
      safeOldSerialized === null
        ? null
        : input.isSensitive
          ? SENSITIVE_SETTING_MASK
          : deserializeSettingValue(safeOldSerialized, input.valueType);
    const newParsed = input.isSensitive
      ? SENSITIVE_SETTING_MASK
      : deserializeSettingValue(safeNewSerialized, input.valueType);

    const historyRecord: SettingHistoryRecord = {
      id: savedId,
      settingId: input.settingId,
      settingKey: input.settingKey,
      environmentCode: input.environmentCode,
      environment: input.environment,
      organizationUnitId: input.organizationUnitId,
      valueType: input.valueType,
      valueTypeName: getSettingValueTypeName(input.valueType),
      oldValue: oldParsed,
      newValue: newParsed,
      actorUserId,
      actorIdentifier,
      reason: input.reason ?? null,
      ipAddress,
      userAgent,
      requestId,
      correlationId,
      createdAt: new Date().toISOString(),
    };

    this.inMemoryHistory.unshift(historyRecord);
    if (this.inMemoryHistory.length > 500) {
      this.inMemoryHistory.pop();
    }

    if (this.auditLogService) {
      await this.auditLogService.record({
        actor: resolvedActor,
        actorUserId,
        actorIdentifier,
        module: 'settings',
        feature: 'system_settings',
        action: input.action,
        resourceType: 'system_setting',
        resourceId: input.settingKey,
        beforeData: {
          settingId: input.settingId,
          settingKey: input.settingKey,
          environmentCode: input.environmentCode,
          environment: input.environment,
          organizationUnitId: input.organizationUnitId,
          value: oldParsed,
        },
        afterData: {
          settingId: input.settingId,
          settingKey: input.settingKey,
          environmentCode: input.environmentCode,
          environment: input.environment,
          organizationUnitId: input.organizationUnitId,
          value: newParsed,
        },
        reason: input.reason ?? null,
        ipAddress,
        userAgent,
        requestId,
        correlationId,
      });
    }
  }

  private mapHistoryEntityToRecord(entity: SystemSettingHistoryEntity): SettingHistoryRecord {
    const valueType = parseSettingValueTypeCode(entity.valueType);
    const envCode = parseSettingEnvironmentCode(entity.environment);
    const envName = getSettingEnvironmentName(envCode);
    const def = this.registry.getDefinitionById(Number(entity.settingId));
    const settingKey = def?.key ?? `setting:${entity.settingId}`;
    const isMaskedOld = entity.oldValue === SENSITIVE_SETTING_MASK;
    const isMaskedNew = entity.newValue === SENSITIVE_SETTING_MASK;

    return {
      id: Number(entity.id),
      settingId: Number(entity.settingId),
      settingKey,
      environmentCode: envCode,
      environment: envName,
      organizationUnitId: entity.organizationUnitId ?? null,
      valueType,
      valueTypeName: getSettingValueTypeName(valueType),
      oldValue:
        entity.oldValue === null || entity.oldValue === undefined
          ? null
          : isMaskedOld
            ? SENSITIVE_SETTING_MASK
            : deserializeSettingValue(entity.oldValue, valueType),
      newValue: isMaskedNew
        ? SENSITIVE_SETTING_MASK
        : deserializeSettingValue(entity.newValue, valueType),
      actorUserId: entity.actorUserId ?? null,
      actorIdentifier: entity.actorIdentifier ?? null,
      reason: entity.reason ?? null,
      ipAddress: entity.ipAddress ?? null,
      userAgent: entity.userAgent ?? null,
      requestId: entity.requestId ?? null,
      correlationId: entity.correlationId ?? null,
      createdAt:
        entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : String(entity.createdAt ?? new Date().toISOString()),
    };
  }

  private async upsertGroupFromManifest(grp: SettingGroupManifestItem): Promise<void> {
    const code = grp.code.trim().toLowerCase();
    const moduleName = (grp.module ?? 'settings').trim().toLowerCase();
    let dbId: number | undefined;

    if (this.groupRepository) {
      try {
        const existing = await this.groupRepository.findByCode(code);
        const saved = await this.groupRepository.saveEntity({
          ...(existing ? { id: existing.id } : {}),
          code,
          module: moduleName,
          name: existing?.name || grp.name.trim(),
          description: existing?.description ?? grp.description ?? null,
          icon: existing?.icon ?? grp.icon ?? null,
          sortOrder: grp.sortOrder ?? existing?.sortOrder ?? 0,
          isSystem: grp.isSystem ?? true,
          status: SETTING_ITEM_STATUS.ACTIVE,
        });
        dbId = Number(saved.id);
      } catch {
        // Ignore when DB table is not available
      }
    }

    this.registry.registerGroup({
      ...grp,
      ...(dbId ? { id: dbId } : {}),
      code,
      module: moduleName,
    });
  }

  private async upsertSettingFromManifest(item: SettingManifestItem): Promise<number> {
    const key = item.key.trim().toLowerCase();
    const valueType = parseSettingValueTypeCode(item.valueType);
    const validatedDefault = validateAndSerializeSettingValue(
      item.defaultValue,
      valueType,
      item.validationRules,
      key,
    );
    const parts = key.split('.');
    const groupCode = (item.groupCode || parts[0] || 'system').trim().toLowerCase();
    const moduleName = (item.module ?? 'settings').trim().toLowerCase();
    const namespace = (
      item.namespace ?? (parts.length >= 2 ? `${moduleName}.${parts[0]}` : moduleName)
    )
      .trim()
      .toLowerCase();

    let group = this.registry.getGroupByCode(groupCode);
    if (!group) {
      group = this.registry.registerGroup({
        code: groupCode,
        module: moduleName,
        name: groupCode.toUpperCase(),
      });
    }
    const groupId = group.id;

    const isSensitive = item.isSensitive === true;
    const encryptedDefault =
      isSensitive && validatedDefault.serialized.length > 0
        ? this.encryptionService.encrypt(validatedDefault.serialized)
        : validatedDefault.serialized;
    const isEncrypted = isSensitive && encryptedDefault.startsWith('enc:v1:');

    let savedSettingId: number | undefined;
    if (this.settingRepository) {
      try {
        const existing = await this.settingRepository.findByKey(key);
        if (!existing) {
          const saved = await this.settingRepository.saveEntity({
            settingKey: key,
            groupId,
            module: moduleName,
            namespace,
            name: item.name.trim(),
            description: item.description ?? null,
            valueType,
            defaultValue: validatedDefault.serialized,
            globalValue: encryptedDefault,
            validationRulesJson: item.validationRules ? JSON.stringify(item.validationRules) : null,
            isSensitive,
            isEncrypted,
            allowUnitOverride: item.allowUnitOverride ?? true,
            isSystem: item.isSystem ?? true,
            sortOrder: item.sortOrder ?? 0,
            status: SETTING_ITEM_STATUS.ACTIVE,
          });
          savedSettingId = Number(saved.id);
        } else {
          savedSettingId = Number(existing.id);
        }
      } catch {
        // Ignore when DB table is not available
      }
    }

    const registeredDef = this.registry.registerManifestSetting({
      ...item,
      ...(savedSettingId ? { id: savedSettingId } : {}),
      groupId,
    });
    const effectiveSettingId = savedSettingId ?? registeredDef.id;

    let envCount = 0;
    if (item.environmentOverrides && typeof item.environmentOverrides === 'object') {
      for (const [envKey, envVal] of Object.entries(item.environmentOverrides)) {
        const envCode = parseSettingEnvironmentCode(envKey);
        const validatedEnv = validateAndSerializeSettingValue(
          envVal,
          valueType,
          item.validationRules,
          key,
        );
        if (this.scopeRepository) {
          try {
            const existingScope = await this.scopeRepository.findByScope(
              effectiveSettingId,
              envCode,
              null,
            );
            if (!existingScope) {
              await this.scopeRepository.saveEntity({
                settingId: effectiveSettingId,
                environment: envCode,
                organizationUnitId: null,
                settingValue: validatedEnv.serialized,
                isEncrypted: false,
                reason: 'Manifest environment default',
              });
            }
          } catch {
            // Ignore when DB table is not available
          }
        }
        envCount++;
      }
    }

    return envCount;
  }

  private async hydrateRegistryFromDbSafe(): Promise<void> {
    if (this.groupRepository) {
      try {
        const dbGroups = await this.groupRepository.findFiltered();
        if (dbGroups.length > 0) {
          const seenCodes = new Set<string>();
          for (const g of dbGroups) {
            const normCode = g.code.trim().toLowerCase();
            seenCodes.add(normCode);
            const group: RegisteredSettingGroup = {
              id: Number(g.id),
              code: normCode,
              module: g.module.trim().toLowerCase(),
              name: g.name,
              description: g.description ?? null,
              icon: g.icon ?? null,
              sortOrder: g.sortOrder ?? 0,
              isSystem: g.isSystem ?? true,
              status:
                g.status === SETTING_ITEM_STATUS.INACTIVE
                  ? SETTING_ITEM_STATUS.INACTIVE
                  : SETTING_ITEM_STATUS.ACTIVE,
            };
            this.registry.registerGroup(group);
          }
          for (const existingGrp of this.registry.listGroups()) {
            if (existingGrp.id !== undefined && !seenCodes.has(existingGrp.code)) {
              this.registry.removeGroup(existingGrp.code);
            }
          }
        }
      } catch {
        // Ignore when DB is not ready
      }
    }

    if (this.settingRepository) {
      try {
        const dbSettings = await this.settingRepository.findFiltered();
        if (dbSettings.length > 0) {
          const seenKeys = new Set<string>();
          for (const s of dbSettings) {
            const normKey = s.settingKey.trim().toLowerCase();
            seenKeys.add(normKey);
            const existingDef = this.registry.getDefinition(normKey);
            const groupId = Number(s.groupId ?? existingDef?.groupId ?? 1);
            const groupCode = (
              this.registry.getGroupById(groupId)?.code ??
              existingDef?.groupCode ??
              normKey.split('.')[0] ??
              'system'
            )
              .trim()
              .toLowerCase();
            const valueType = parseSettingValueTypeCode(s.valueType);
            let rules: SettingValidationRules | null = null;
            if (s.validationRulesJson) {
              try {
                rules = JSON.parse(s.validationRulesJson) as SettingValidationRules;
              } catch {
                rules = null;
              }
            }
            const nextStatus =
              s.status === SETTING_ITEM_STATUS.INACTIVE
                ? SETTING_ITEM_STATUS.INACTIVE
                : SETTING_ITEM_STATUS.ACTIVE;

            const valueChangedInDb =
              !existingDef ||
              existingDef.globalSerializedValue !== s.globalValue ||
              existingDef.defaultSerializedValue !== s.defaultValue ||
              existingDef.isEncrypted !== Boolean(s.isEncrypted) ||
              existingDef.isSensitive !== Boolean(s.isSensitive) ||
              existingDef.allowUnitOverride !== Boolean(s.allowUnitOverride) ||
              existingDef.status !== nextStatus ||
              existingDef.name !== s.name;

            this.registry.upsertDefinition({
              id: Number(s.id),
              groupId,
              key: normKey,
              groupCode,
              module: s.module.trim().toLowerCase(),
              namespace: s.namespace.trim().toLowerCase(),
              name: s.name,
              description: s.description ?? null,
              valueType,
              valueTypeName: getSettingValueTypeName(valueType),
              defaultSerializedValue: s.defaultValue,
              globalSerializedValue: s.globalValue,
              validationRules: rules,
              isSensitive: Boolean(s.isSensitive),
              isEncrypted: Boolean(s.isEncrypted),
              allowUnitOverride: Boolean(s.allowUnitOverride),
              isSystem: Boolean(s.isSystem),
              sortOrder: s.sortOrder ?? 0,
              status: nextStatus,
              updatedBy: s.updatedBy ?? null,
            });

            if (valueChangedInDb) {
              await this.invalidateSettingCacheForKey(normKey);
              if (existingDef && existingDef.globalSerializedValue !== s.globalValue) {
                const plainSerialized = this.decryptIfNeeded(s.globalValue, Boolean(s.isEncrypted));
                const parsedValue = deserializeSettingValue(plainSerialized, valueType);
                await this.publishSettingChanged({
                  key: normKey,
                  module: s.module.trim().toLowerCase(),
                  namespace: s.namespace.trim().toLowerCase(),
                  environment: 'ALL',
                  organizationUnitId: null,
                  value: parsedValue,
                });
              }
            }
          }

          for (const existingDef of this.registry.listDefinitions()) {
            if (existingDef.id !== undefined && !seenKeys.has(existingDef.key)) {
              this.registry.removeDefinition(existingDef.key);
              await this.invalidateSettingCacheForKey(existingDef.key);
            }
          }
        }
      } catch {
        // Ignore when DB is not ready
      }
    }

    if (this.scopeRepository) {
      try {
        const dbScopes = await this.scopeRepository.findAllScopes();
        const seenScopeKeys = new Set<string>();
        const existingScopesByKey = new Map(
          this.registry.listAllScopeOverrides().map((o) => [o.scopeKey, o]),
        );

        for (const sc of dbScopes) {
          const settingId = Number(sc.settingId);
          const def = this.registry.getDefinitionById(settingId);
          if (!def) continue;
          const envCode = parseSettingEnvironmentCode(sc.environment);
          const envName = getSettingEnvironmentName(envCode);
          const unitId = sc.organizationUnitId ?? null;
          const scopeKey = buildSettingScopeKey(def.key, envName, unitId);

          seenScopeKeys.add(scopeKey);
          const prev = existingScopesByKey.get(scopeKey);
          const changed =
            !prev ||
            prev.serializedValue !== sc.settingValue ||
            prev.isEncrypted !== Boolean(sc.isEncrypted);

          const override: RegisteredSettingScopeOverride = {
            id: Number(sc.id),
            settingId,
            settingKey: def.key,
            environmentCode: envCode,
            environment: envName,
            organizationUnitId: unitId,
            scopeKey,
            serializedValue: sc.settingValue,
            isEncrypted: Boolean(sc.isEncrypted),
            updatedBy: sc.updatedBy ?? null,
            reason: sc.reason ?? null,
            updatedAt:
              sc.updatedAt instanceof Date
                ? sc.updatedAt.toISOString()
                : String(sc.updatedAt ?? new Date().toISOString()),
          };
          this.registry.upsertScopeOverride(override);

          if (changed) {
            await this.invalidateSettingCacheForKey(override.settingKey);
          }
        }

        for (const existingOverride of existingScopesByKey.values()) {
          if (existingOverride.id !== undefined && !seenScopeKeys.has(existingOverride.scopeKey)) {
            this.registry.removeScopeOverrideByScopeKey(existingOverride.scopeKey);
            await this.invalidateSettingCacheForKey(existingOverride.settingKey);
          }
        }
      } catch {
        // Ignore when DB is not ready
      }
    }
  }
}
