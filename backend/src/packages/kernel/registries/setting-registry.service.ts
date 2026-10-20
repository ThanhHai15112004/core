import { Injectable } from '@nestjs/common';
import {
  SENSITIVE_SETTING_MASK,
  SETTING_ITEM_STATUS,
  buildSettingScopeKey,
  deserializeSettingValue,
  discoverManifestSettings,
  getSettingEnvironmentName,
  getSettingValueTypeName,
  normalizeSettingEnvironment,
  parseSettingEnvironmentCode,
  parseSettingValueTypeCode,
  validateAndSerializeSettingValue,
  type RegisteredSettingDefinition,
  type RegisteredSettingGroup,
  type RegisteredSettingScopeOverride,
  type ResolvedSettingView,
  type SettingChangeListener,
  type SettingEnvironmentCode,
  type SettingEnvironmentName,
  type SettingGroupManifestItem,
  type SettingManifestItem,
  type SettingResolveContext,
  type SettingResolvedSource,
  type SettingValueTypeCode,
} from '../contracts/setting-lookup.contract.js';

/**
 * L1 In-Memory Registry & Resolver cho Cấu hình Hệ thống (Mục 5.1):
 * Cho phép bất kỳ module nào đọc nhanh giá trị cấu hình theo thứ tự ưu tiên:
 * `Đơn vị + Môi trường` -> `Đơn vị (ALL)` -> `Môi trường (Global)` -> `Toàn cục (Global)` -> `Mặc định (Manifest)`
 */
@Injectable()
export class SettingRegistryService {
  private static sharedInstance: SettingRegistryService | null = null;

  public static getInstance(): SettingRegistryService {
    if (!SettingRegistryService.sharedInstance) {
      SettingRegistryService.sharedInstance = new SettingRegistryService();
    }
    return SettingRegistryService.sharedInstance;
  }

  private readonly groups = new Map<string, RegisteredSettingGroup>();
  private readonly definitions = new Map<string, RegisteredSettingDefinition>();
  private readonly scopeOverrides = new Map<string, RegisteredSettingScopeOverride>();
  private readonly listeners = new Set<SettingChangeListener>();
  private nextGroupId = 1;
  private nextDefinitionId = 1;
  private activeEnvironment: SettingEnvironmentName = 'development';

  constructor(initialEnvironment?: string) {
    if (initialEnvironment) {
      this.activeEnvironment = normalizeSettingEnvironment(initialEnvironment);
    }
    this.bootstrapFromManifests();
    if (!SettingRegistryService.sharedInstance) {
      SettingRegistryService.sharedInstance = this;
    }
  }

  /** Nạp danh mục cấu hình mặc định từ các `module.manifest.json` vào L1 Cache */
  public bootstrapFromManifests(): void {
    const discovered = discoverManifestSettings();
    for (const grp of discovered.groups) {
      this.registerGroup(grp);
    }
    for (const item of discovered.settings) {
      this.registerManifestSetting(item);
    }
  }

  /** Đặt môi trường mặc định hiện hành khi phân giải cấu hình */
  public setActiveEnvironment(environment: string | number): void {
    this.activeEnvironment = normalizeSettingEnvironment(environment);
  }

  public getActiveEnvironment(): string {
    return this.activeEnvironment;
  }

  /** Đăng ký listener nhận thông báo mỗi khi một cấu hình thay đổi */
  public onSettingChanged(listener: SettingChangeListener): () => void {
    this.listeners.add(listener);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.listeners.add(listener);
    }
    return () => {
      this.listeners.delete(listener);
      if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
        SettingRegistryService.sharedInstance.listeners.delete(listener);
      }
    };
  }

  public async notifySettingChanged(event: {
    key: string;
    module: string;
    namespace: string;
    environment: string;
    organizationUnitId: number | null;
    value: unknown;
  }): Promise<void> {
    const allListeners = new Set<SettingChangeListener>(this.listeners);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      for (const l of SettingRegistryService.sharedInstance.listeners) {
        allListeners.add(l);
      }
    }
    for (const listener of allListeners) {
      try {
        await listener(event);
      } catch {
        // Ignore listener error to avoid breaking setting update flow
      }
    }
  }

  public registerGroup(
    input: SettingGroupManifestItem & { id?: number | undefined },
  ): RegisteredSettingGroup {
    const code = input.code.trim().toLowerCase();
    const existing = this.groups.get(code);
    const assignedId =
      input.id !== undefined ? Number(input.id) : (existing?.id ?? this.nextGroupId++);
    if (assignedId >= this.nextGroupId) {
      this.nextGroupId = assignedId + 1;
    }
    const group: RegisteredSettingGroup = {
      id: assignedId,
      code,
      module: (input.module ?? existing?.module ?? 'settings').trim().toLowerCase(),
      name: input.name.trim(),
      description: input.description ?? existing?.description ?? null,
      icon: input.icon ?? existing?.icon ?? null,
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
      isSystem: input.isSystem ?? existing?.isSystem ?? true,
      status:
        input.status === SETTING_ITEM_STATUS.INACTIVE
          ? SETTING_ITEM_STATUS.INACTIVE
          : SETTING_ITEM_STATUS.ACTIVE,
    };
    this.groups.set(code, group);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.groups.set(code, group);
    }
    return group;
  }

  public getGroupByCode(code: string): RegisteredSettingGroup | undefined {
    return this.groups.get(code.trim().toLowerCase());
  }

  public getGroupById(id: number): RegisteredSettingGroup | undefined {
    const targetId = Number(id);
    for (const grp of this.groups.values()) {
      if (Number(grp.id) === targetId) {
        return grp;
      }
    }
    return undefined;
  }

  public removeGroup(code: string): boolean {
    const norm = code.trim().toLowerCase();
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.groups.delete(norm);
    }
    return this.groups.delete(norm);
  }

  public registerManifestSetting(
    item: SettingManifestItem & { id?: number | undefined; groupId?: number | undefined },
  ): RegisteredSettingDefinition {
    const key = item.key.trim().toLowerCase();
    const valueType = parseSettingValueTypeCode(item.valueType);
    const { serialized } = validateAndSerializeSettingValue(
      item.defaultValue,
      valueType,
      item.validationRules,
      key,
    );
    const existing = this.definitions.get(key);
    const parts = key.split('.');
    const moduleName = (item.module ?? existing?.module ?? 'settings').trim().toLowerCase();
    const groupCode = (item.groupCode || existing?.groupCode || parts[0] || 'system')
      .trim()
      .toLowerCase();
    let group = this.groups.get(groupCode);
    if (!group) {
      group = this.registerGroup({
        code: groupCode,
        module: moduleName,
        name: groupCode.toUpperCase(),
      });
    }
    const groupId = item.groupId !== undefined ? Number(item.groupId) : group.id;
    const assignedId =
      item.id !== undefined ? Number(item.id) : (existing?.id ?? this.nextDefinitionId++);
    if (assignedId >= this.nextDefinitionId) {
      this.nextDefinitionId = assignedId + 1;
    }

    const namespace = (
      item.namespace ??
      existing?.namespace ??
      (parts.length >= 2 ? `${moduleName}.${parts[0]}` : moduleName)
    )
      .trim()
      .toLowerCase();

    const registered: RegisteredSettingDefinition = {
      id: assignedId,
      groupId,
      key,
      groupCode,
      module: moduleName,
      namespace,
      name: item.name.trim(),
      description: item.description ?? existing?.description ?? null,
      valueType,
      valueTypeName: getSettingValueTypeName(valueType),
      defaultSerializedValue: serialized,
      globalSerializedValue: existing?.globalSerializedValue ?? serialized,
      validationRules: item.validationRules ?? existing?.validationRules ?? null,
      isSensitive: item.isSensitive ?? existing?.isSensitive ?? false,
      isEncrypted: existing?.isEncrypted ?? false,
      allowUnitOverride: item.allowUnitOverride ?? existing?.allowUnitOverride ?? true,
      isSystem: item.isSystem ?? existing?.isSystem ?? true,
      sortOrder: item.sortOrder ?? existing?.sortOrder ?? 0,
      status:
        item.status === SETTING_ITEM_STATUS.INACTIVE
          ? SETTING_ITEM_STATUS.INACTIVE
          : SETTING_ITEM_STATUS.ACTIVE,
      updatedBy: existing?.updatedBy ?? null,
    };

    this.definitions.set(key, registered);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.definitions.set(key, registered);
    }

    if (item.environmentOverrides && typeof item.environmentOverrides === 'object') {
      this.registerEnvironmentOverrides(item, assignedId, key, valueType);
    }

    return registered;
  }

  public upsertDefinition(def: RegisteredSettingDefinition): void {
    const normKey = def.key.trim().toLowerCase();
    const existing = this.definitions.get(normKey);
    const assignedId =
      def.id !== undefined ? Number(def.id) : (existing?.id ?? this.nextDefinitionId++);
    if (assignedId >= this.nextDefinitionId) {
      this.nextDefinitionId = assignedId + 1;
    }
    const groupById = def.groupId ? this.getGroupById(def.groupId) : undefined;
    const groupByCode = def.groupCode ? this.getGroupByCode(def.groupCode) : undefined;
    const resolvedGroupId = def.groupId ?? groupByCode?.id ?? existing?.groupId ?? 1;
    const resolvedGroupCode = (groupById?.code ?? def.groupCode ?? existing?.groupCode ?? 'system')
      .trim()
      .toLowerCase();

    const normalized: RegisteredSettingDefinition = {
      ...def,
      id: assignedId,
      groupId: resolvedGroupId,
      groupCode: resolvedGroupCode,
      key: normKey,
    };
    this.definitions.set(normKey, normalized);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.definitions.set(normKey, normalized);
    }
  }

  public removeDefinition(key: string): boolean {
    const normKey = key.trim().toLowerCase();
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.definitions.delete(normKey);
    }
    return this.definitions.delete(normKey);
  }

  public upsertScopeOverride(
    override: Omit<RegisteredSettingScopeOverride, 'settingId' | 'environmentCode'> & {
      settingId?: number | undefined;
      environmentCode?: SettingEnvironmentCode | undefined;
    },
  ): void {
    const defById =
      override.settingId !== undefined ? this.getDefinitionById(override.settingId) : undefined;
    const defByKey = override.settingKey ? this.getDefinition(override.settingKey) : undefined;
    const resolvedSettingKey = (defById?.key ?? override.settingKey ?? '').trim().toLowerCase();
    const resolvedSettingId = Number(override.settingId ?? defByKey?.id ?? defById?.id ?? 1);
    const envCode = override.environmentCode ?? parseSettingEnvironmentCode(override.environment);
    const normEnv = getSettingEnvironmentName(envCode);

    const scopeKey = buildSettingScopeKey(resolvedSettingKey, normEnv, override.organizationUnitId);
    const normalized: RegisteredSettingScopeOverride = {
      ...override,
      settingId: resolvedSettingId,
      settingKey: resolvedSettingKey,
      environmentCode: envCode,
      environment: normEnv,
      scopeKey,
    };
    this.scopeOverrides.set(scopeKey, normalized);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.scopeOverrides.set(scopeKey, normalized);
    }
  }

  public removeScopeOverride(
    settingKey: string,
    environment?: string | number | null,
    organizationUnitId?: number | null,
  ): boolean {
    const scopeKey = buildSettingScopeKey(settingKey, environment, organizationUnitId);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.scopeOverrides.delete(scopeKey);
    }
    return this.scopeOverrides.delete(scopeKey);
  }

  public removeScopeOverrideByScopeKey(scopeKey: string): boolean {
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.scopeOverrides.delete(scopeKey);
    }
    return this.scopeOverrides.delete(scopeKey);
  }

  public listAllScopeOverrides(): RegisteredSettingScopeOverride[] {
    return [...this.scopeOverrides.values()];
  }

  public getDefinition(key: string): RegisteredSettingDefinition | undefined {
    return this.definitions.get(key.trim().toLowerCase());
  }

  public getDefinitionById(id: number): RegisteredSettingDefinition | undefined {
    const targetId = Number(id);
    for (const def of this.definitions.values()) {
      if (Number(def.id) === targetId) {
        return def;
      }
    }
    return undefined;
  }

  public listDefinitions(): RegisteredSettingDefinition[] {
    return [...this.definitions.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
    );
  }

  public listGroups(): RegisteredSettingGroup[] {
    return [...this.groups.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );
  }

  public listScopeOverridesForKey(settingKey: string): RegisteredSettingScopeOverride[] {
    const normKey = settingKey.trim().toLowerCase();
    const def = this.definitions.get(normKey);
    const result: RegisteredSettingScopeOverride[] = [];
    for (const item of this.scopeOverrides.values()) {
      if (item.settingKey === normKey || (def && item.settingId === def.id)) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Phân giải giá trị cấu hình theo chuỗi ưu tiên:
   * 1. `UNIT_ENV` (Đơn vị + Môi trường cụ thể)
   * 2. `UNIT_ALL` (Đơn vị + Mọi môi trường 'ALL')
   * 3. `GLOBAL_ENV` (Môi trường cụ thể + Toàn hệ thống)
   * 4. `GLOBAL` (Giá trị toàn cục trên `system_settings`)
   * 5. `DEFAULT` (Giá trị mặc định từ Manifest)
   */
  public resolve<T = unknown>(
    key: string,
    context?: SettingResolveContext,
    options?: {
      maskSensitive?: boolean | undefined;
      decryptor?: ((cipherText: string) => string) | undefined;
      fromCache?: boolean | undefined;
    },
  ): ResolvedSettingView<T> | null {
    const normKey = key.trim().toLowerCase();
    const def = this.definitions.get(normKey);
    if (!def) {
      return null;
    }

    const env = normalizeSettingEnvironment(context?.environment ?? this.activeEnvironment);
    const unitId =
      def.allowUnitOverride &&
      context?.organizationUnitId !== undefined &&
      context?.organizationUnitId !== null &&
      Number(context.organizationUnitId) > 0
        ? Number(context.organizationUnitId)
        : null;

    const cascade = this.resolveScopeCascade(def, normKey, env, unitId);
    const hasValue =
      cascade.selectedSerialized !== undefined &&
      cascade.selectedSerialized !== null &&
      cascade.selectedSerialized !== '';
    const maskSensitive = options?.maskSensitive !== false;

    const finalValue = this.decodeSettingValue(
      def,
      cascade.selectedSerialized,
      cascade.selectedEncrypted,
      hasValue,
      maskSensitive,
      options?.decryptor,
    );

    const defaultValue =
      def.isSensitive && maskSensitive
        ? def.defaultSerializedValue
          ? SENSITIVE_SETTING_MASK
          : ''
        : deserializeSettingValue(def.defaultSerializedValue, def.valueType);

    return {
      id: def.id,
      groupId: def.groupId,
      key: def.key,
      groupCode: def.groupCode,
      module: def.module,
      namespace: def.namespace,
      name: def.name,
      description: def.description,
      valueType: def.valueType,
      valueTypeName: def.valueTypeName,
      value: finalValue as T,
      defaultValue,
      isSensitive: def.isSensitive,
      isEncrypted: def.isEncrypted || cascade.selectedEncrypted,
      hasValue,
      allowUnitOverride: def.allowUnitOverride,
      isSystem: def.isSystem,
      resolvedSource: cascade.resolvedSource,
      resolvedEnvironment: cascade.resolvedEnv,
      resolvedOrganizationUnitId: cascade.resolvedUnitId,
      fromCache: options?.fromCache ?? true,
    };
  }

  /** Cập nhật nhanh giá trị toàn cục (`globalSerializedValue`) của một cấu hình đã đăng ký */
  public setGlobalValue(key: string, value: unknown): void {
    const normKey = key.trim().toLowerCase();
    const def = this.definitions.get(normKey);
    if (!def) return;
    const { serialized } = validateAndSerializeSettingValue(
      value,
      def.valueType,
      def.validationRules,
      normKey,
    );
    this.upsertDefinition({
      ...def,
      globalSerializedValue: serialized,
    });
  }

  /** Đọc nhanh cấu hình kiểu `number` (ví dụ: `getNumber('security.password.min_length', undefined, 8)`) */
  public getNumber(
    key: string,
    context?: SettingResolveContext,
    fallback = 0,
    decryptor?: (cipherText: string) => string,
  ): number {
    const resolved = this.resolve<number>(key, context, { maskSensitive: false, decryptor });
    if (!resolved || typeof resolved.value !== 'number' || !Number.isFinite(resolved.value)) {
      return fallback;
    }
    return resolved.value;
  }

  /** Đọc nhanh cấu hình kiểu `boolean` */
  public getBoolean(
    key: string,
    context?: SettingResolveContext,
    fallback = false,
    decryptor?: (cipherText: string) => string,
  ): boolean {
    const resolved = this.resolve<boolean>(key, context, { maskSensitive: false, decryptor });
    if (!resolved || typeof resolved.value !== 'boolean') {
      return fallback;
    }
    return resolved.value;
  }

  /** Đọc nhanh cấu hình kiểu `string` */
  public getString(
    key: string,
    context?: SettingResolveContext,
    fallback = '',
    decryptor?: (cipherText: string) => string,
  ): string {
    const resolved = this.resolve<string>(key, context, {
      maskSensitive: false,
      decryptor,
    });
    if (!resolved || typeof resolved.value !== 'string') {
      return fallback;
    }
    return resolved.value;
  }

  /** Đọc nhanh cấu hình kiểu `JSON` */
  public getJson<T = Record<string, unknown>>(
    key: string,
    context?: SettingResolveContext,
    fallback?: T,
    decryptor?: (cipherText: string) => string,
  ): T {
    const resolved = this.resolve<T>(key, context, { maskSensitive: false, decryptor });
    if (!resolved || resolved.value === undefined || resolved.value === null) {
      return (fallback ?? ({} as T)) as T;
    }
    return resolved.value;
  }

  private registerEnvironmentOverrides(
    item: SettingManifestItem,
    assignedId: number,
    key: string,
    valueType: SettingValueTypeCode,
  ): void {
    for (const [envKey, envVal] of Object.entries(item.environmentOverrides ?? {})) {
      const envCode = parseSettingEnvironmentCode(envKey);
      const normEnv = getSettingEnvironmentName(envCode);
      const scopeKey = buildSettingScopeKey(key, normEnv, null);
      if (!this.scopeOverrides.has(scopeKey)) {
        const validatedEnv = validateAndSerializeSettingValue(
          envVal,
          valueType,
          item.validationRules,
          key,
        );
        const scopeEntry: RegisteredSettingScopeOverride = {
          settingId: assignedId,
          settingKey: key,
          environmentCode: envCode,
          environment: normEnv,
          organizationUnitId: null,
          scopeKey,
          serializedValue: validatedEnv.serialized,
          isEncrypted: false,
          updatedBy: null,
          reason: 'Manifest environment default',
        };
        this.scopeOverrides.set(scopeKey, scopeEntry);
        if (
          SettingRegistryService.sharedInstance &&
          SettingRegistryService.sharedInstance !== this &&
          !SettingRegistryService.sharedInstance.scopeOverrides.has(scopeKey)
        ) {
          SettingRegistryService.sharedInstance.scopeOverrides.set(scopeKey, scopeEntry);
        }
      }
    }
  }

  private resolveScopeCascade(
    def: RegisteredSettingDefinition,
    normKey: string,
    env: SettingEnvironmentName,
    unitId: number | null,
  ): {
    selectedSerialized: string;
    selectedEncrypted: boolean;
    resolvedSource: SettingResolvedSource;
    resolvedEnv: string;
    resolvedUnitId: number | null;
  } {
    if (unitId !== null && env !== 'ALL') {
      const unitEnvOverride = this.scopeOverrides.get(buildSettingScopeKey(normKey, env, unitId));
      if (unitEnvOverride) {
        return {
          selectedSerialized: unitEnvOverride.serializedValue,
          selectedEncrypted: unitEnvOverride.isEncrypted,
          resolvedSource: 'UNIT_ENV',
          resolvedEnv: env,
          resolvedUnitId: unitId,
        };
      }
    }

    if (unitId !== null) {
      const unitAllOverride = this.scopeOverrides.get(buildSettingScopeKey(normKey, 'ALL', unitId));
      if (unitAllOverride) {
        return {
          selectedSerialized: unitAllOverride.serializedValue,
          selectedEncrypted: unitAllOverride.isEncrypted,
          resolvedSource: 'UNIT_ALL',
          resolvedEnv: 'ALL',
          resolvedUnitId: unitId,
        };
      }
    }

    if (env !== 'ALL') {
      const globalEnvOverride = this.scopeOverrides.get(buildSettingScopeKey(normKey, env, null));
      if (globalEnvOverride) {
        return {
          selectedSerialized: globalEnvOverride.serializedValue,
          selectedEncrypted: globalEnvOverride.isEncrypted,
          resolvedSource: 'GLOBAL_ENV',
          resolvedEnv: env,
          resolvedUnitId: null,
        };
      }
    }

    const globalAllOverride = this.scopeOverrides.get(buildSettingScopeKey(normKey, 'ALL', null));
    if (globalAllOverride) {
      return {
        selectedSerialized: globalAllOverride.serializedValue,
        selectedEncrypted: globalAllOverride.isEncrypted,
        resolvedSource: 'GLOBAL',
        resolvedEnv: 'ALL',
        resolvedUnitId: null,
      };
    }

    if (def.globalSerializedValue === undefined || def.globalSerializedValue === null) {
      return {
        selectedSerialized: def.defaultSerializedValue,
        selectedEncrypted: def.isEncrypted,
        resolvedSource: 'DEFAULT',
        resolvedEnv: 'ALL',
        resolvedUnitId: null,
      };
    }

    return {
      selectedSerialized: def.globalSerializedValue,
      selectedEncrypted: def.isEncrypted,
      resolvedSource: 'GLOBAL',
      resolvedEnv: 'ALL',
      resolvedUnitId: null,
    };
  }

  private decodeSettingValue(
    def: RegisteredSettingDefinition,
    selectedSerialized: string,
    selectedEncrypted: boolean,
    hasValue: boolean,
    maskSensitive: boolean,
    decryptor?: (cipherText: string) => string,
  ): unknown {
    if (def.isSensitive && maskSensitive) {
      return hasValue ? SENSITIVE_SETTING_MASK : '';
    }

    let plainSerialized = selectedSerialized;
    if (selectedEncrypted) {
      if (decryptor) {
        try {
          plainSerialized = decryptor(selectedSerialized);
        } catch {
          plainSerialized = def.defaultSerializedValue ?? '';
        }
      } else {
        plainSerialized = def.defaultSerializedValue ?? '';
      }
    }
    return deserializeSettingValue(plainSerialized, def.valueType);
  }
}

export const defaultSettingRegistry = new SettingRegistryService();
