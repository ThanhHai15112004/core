import type { SeederContext, SeederContract } from '@packages/database/index.js';
import {
  type I18nLocaleManifestItem,
  type I18nTimezoneManifestItem,
  type I18nTranslationManifestItem,
  discoverManifestI18n,
  getInitialStaticDictionaries,
} from '@packages/i18n/index.js';
import {
  type CodeTypeManifestItem,
  type FeatureFlagManifestItem,
  type SequenceManifestItem,
  type SettingGroupManifestItem,
  type SettingManifestItem,
  SETTING_ITEM_STATUS,
  discoverManifestCodeTypes,
  discoverManifestFeatureFlags,
  discoverManifestSequences,
  discoverManifestSettings,
  parseSettingEnvironmentCode,
  parseSettingValueTypeCode,
  validateAndSerializeSettingValue,
  validateSequenceRule,
} from '@packages/kernel/index.js';

export interface PermissionSeedItem {
  code: string;
  module: string;
  description: string;
  name?: string;
}

export interface MasterSettingSeedItem {
  key: string;
  value: string;
  description: string;
}

const DEFAULT_MASTER_SETTINGS: MasterSettingSeedItem[] = [
  {
    key: 'system.locale.default',
    value: 'vi',
    description: 'Default system language',
  },
  {
    key: 'system.timezone.default',
    value: 'Asia/Ho_Chi_Minh',
    description: 'Default system timezone',
  },
  {
    key: 'system.maintenance.mode',
    value: 'false',
    description: 'Global maintenance mode flag',
  },
];

export const SEED_SYSTEM_SETTING_GROUPS: readonly SettingGroupManifestItem[] =
  discoverManifestSettings().groups;

function collectInitialI18nTranslations(): I18nTranslationManifestItem[] {
  const map = new Map<string, I18nTranslationManifestItem>();
  for (const [locale, dict] of Object.entries(getInitialStaticDictionaries())) {
    for (const [key, value] of Object.entries(dict)) {
      const namespace = key.includes('.') ? key.split('.')[0]! : 'common';
      map.set(`${locale}::${key}`, {
        locale,
        namespace,
        key,
        value,
        isSystem: true,
        status: SETTING_ITEM_STATUS.ACTIVE,
      });
    }
  }
  for (const item of discoverManifestI18n().translations) {
    map.set(`${item.locale}::${item.key}`, item);
  }
  return [...map.values()];
}

/**
 * Seeder đồng bộ danh mục Quyền hạn (`permissions`), Danh mục Động & Hybrid (`code_types`, `code_values`),
 * Cấu hình Hệ thống Động (`setting_groups`, `system_settings`, `system_setting_scopes`),
 * Feature Flags (`feature_flags`) và Đa ngôn ngữ & Múi giờ (`i18n_locales`, `i18n_timezones`, `i18n_translations`)
 * từ `module.manifest.json` và Master Data nền tảng (`core_master_settings`).
 * Thiết kế Idempotent: chạy nhiều lần trên mọi môi trường (kể cả Production) không sinh dữ liệu trùng.
 */
export class MasterPermissionSeeder implements SeederContract {
  public readonly name = 'MasterPermissionAndSettingsSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 10;

  constructor(
    private readonly permissions: PermissionSeedItem[],
    private readonly masterSettings: MasterSettingSeedItem[] = DEFAULT_MASTER_SETTINGS,
    private readonly codeTypes: readonly CodeTypeManifestItem[] = discoverManifestCodeTypes(),
    private readonly settingGroups: readonly SettingGroupManifestItem[] = SEED_SYSTEM_SETTING_GROUPS,
    private readonly systemSettings: readonly SettingManifestItem[] = discoverManifestSettings()
      .settings,
    private readonly featureFlags: readonly FeatureFlagManifestItem[] = discoverManifestFeatureFlags(),
    private readonly i18nLocales: readonly I18nLocaleManifestItem[] = discoverManifestI18n()
      .locales,
    private readonly i18nTimezones: readonly I18nTimezoneManifestItem[] = discoverManifestI18n()
      .timezones,
    private readonly i18nTranslations: readonly I18nTranslationManifestItem[] = collectInitialI18nTranslations(),
  ) {}

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id ${pkDef},
        code VARCHAR(128) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        module VARCHAR(64) NOT NULL,
        description TEXT NULL,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS core_master_settings (
        id ${pkDef},
        setting_key VARCHAR(128) NOT NULL UNIQUE,
        setting_value TEXT NOT NULL,
        description VARCHAR(255) NOT NULL,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS code_types (
        id ${pkDef},
        code VARCHAR(100) NOT NULL UNIQUE,
        module VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        allow_custom_values BOOLEAN NOT NULL DEFAULT TRUE,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS code_values (
        id ${pkDef},
        type_code VARCHAR(100) NOT NULL,
        numeric_code INT NOT NULL,
        code VARCHAR(64) NOT NULL,
        behavior_code VARCHAR(64) NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        labels_json TEXT NULL,
        aliases_json TEXT NULL,
        color VARCHAR(32) NULL,
        icon VARCHAR(64) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        metadata_json TEXT NULL,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        CONSTRAINT uq_code_values_type_numeric UNIQUE (type_code, numeric_code),
        CONSTRAINT uq_code_values_type_code UNIQUE (type_code, code)
      )
    `);

    let affected = 0;

    for (const perm of this.permissions) {
      const displayName = perm.name ?? perm.code;
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO permissions (code, name, module, description, status)
           VALUES ($1, $2, $3, $4, 1)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, module = EXCLUDED.module, description = EXCLUDED.description`,
          [perm.code, displayName, perm.module, perm.description],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO permissions (code, name, module, description, status)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), description = VALUES(description)`,
          [perm.code, displayName, perm.module, perm.description],
        );
      }
      affected++;
    }

    for (const setting of this.masterSettings) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO core_master_settings (setting_key, setting_value, description, status)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (setting_key) DO NOTHING`,
          [setting.key, setting.value, setting.description],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO core_master_settings (setting_key, setting_value, description, status)
           VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE description = VALUES(description)`,
          [setting.key, setting.value, setting.description],
        );
      }
      affected++;
    }

    // Merge discovered manifest codeTypes and custom passed codeTypes
    const mergedCodeTypes = new Map<string, CodeTypeManifestItem>();
    for (const item of discoverManifestCodeTypes()) {
      mergedCodeTypes.set(item.code.trim().toLowerCase(), item);
    }
    for (const item of this.codeTypes) {
      mergedCodeTypes.set(item.code.trim().toLowerCase(), item);
    }

    let codeValuesSeeded = 0;
    for (const ct of mergedCodeTypes.values()) {
      const typeCode = ct.code.trim().toLowerCase();
      const moduleName = (ct.module ?? typeCode.split('.')[0] ?? 'core').trim().toLowerCase();
      const isSystem = ct.isSystem ?? true;
      const allowCustomValues = ct.allowCustomValues ?? true;

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO code_types (code, module, name, description, is_system, allow_custom_values, status)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT (code) DO UPDATE SET
             module = EXCLUDED.module,
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             is_system = EXCLUDED.is_system,
             allow_custom_values = EXCLUDED.allow_custom_values`,
          [typeCode, moduleName, ct.name, ct.description ?? null, isSystem, allowCustomValues],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO code_types (code, module, name, description, is_system, allow_custom_values, status)
           VALUES (?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             module = VALUES(module),
             name = VALUES(name),
             description = VALUES(description),
             is_system = VALUES(is_system),
             allow_custom_values = VALUES(allow_custom_values)`,
          [typeCode, moduleName, ct.name, ct.description ?? null, isSystem, allowCustomValues],
        );
      }
      affected++;

      for (const val of ct.values ?? []) {
        const valCode = val.code.trim().toUpperCase();
        const behaviorCode = val.behaviorCode ? val.behaviorCode.trim().toUpperCase() : null;
        const labelsJson = val.labels ? JSON.stringify(val.labels) : null;
        const aliasesJson = val.aliases ? JSON.stringify(val.aliases) : null;
        const metadataJson = val.metadata ? JSON.stringify(val.metadata) : null;

        if (isPostgres) {
          await ctx.manager.query(
            `INSERT INTO code_values (
               type_code, numeric_code, code, behavior_code, name, description,
               labels_json, aliases_json, color, icon, sort_order, is_default, is_system, metadata_json, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1)
             ON CONFLICT (type_code, numeric_code) DO UPDATE SET
               code = EXCLUDED.code,
               behavior_code = EXCLUDED.behavior_code,
               name = COALESCE(NULLIF(code_values.name, ''), EXCLUDED.name),
               description = COALESCE(code_values.description, EXCLUDED.description),
               labels_json = COALESCE(code_values.labels_json, EXCLUDED.labels_json),
               aliases_json = COALESCE(code_values.aliases_json, EXCLUDED.aliases_json),
               color = COALESCE(code_values.color, EXCLUDED.color),
               icon = COALESCE(code_values.icon, EXCLUDED.icon),
               sort_order = EXCLUDED.sort_order,
               is_default = EXCLUDED.is_default,
               is_system = EXCLUDED.is_system`,
            [
              typeCode,
              val.numericCode,
              valCode,
              behaviorCode,
              val.name,
              val.description ?? null,
              labelsJson,
              aliasesJson,
              val.color ?? null,
              val.icon ?? null,
              val.sortOrder ?? val.numericCode,
              val.isDefault ?? false,
              val.isSystem ?? true,
              metadataJson,
            ],
          );
        } else {
          await ctx.manager.query(
            `INSERT INTO code_values (
               type_code, numeric_code, code, behavior_code, name, description,
               labels_json, aliases_json, color, icon, sort_order, is_default, is_system, metadata_json, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
               code = VALUES(code),
               behavior_code = VALUES(behavior_code),
               name = COALESCE(NULLIF(code_values.name, ''), VALUES(name)),
               description = COALESCE(code_values.description, VALUES(description)),
               labels_json = COALESCE(code_values.labels_json, VALUES(labels_json)),
               aliases_json = COALESCE(code_values.aliases_json, VALUES(aliases_json)),
               color = COALESCE(code_values.color, VALUES(color)),
               icon = COALESCE(code_values.icon, VALUES(icon)),
               sort_order = VALUES(sort_order),
               is_default = VALUES(is_default),
               is_system = VALUES(is_system)`,
            [
              typeCode,
              val.numericCode,
              valCode,
              behaviorCode,
              val.name,
              val.description ?? null,
              labelsJson,
              aliasesJson,
              val.color ?? null,
              val.icon ?? null,
              val.sortOrder ?? val.numericCode,
              val.isDefault ?? false,
              val.isSystem ?? true,
              metadataJson,
            ],
          );
        }
        codeValuesSeeded++;
        affected++;
      }
    }

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS setting_groups (
        id ${pkDef},
        code VARCHAR(64) NOT NULL UNIQUE,
        module VARCHAR(64) NOT NULL DEFAULT 'settings',
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        icon VARCHAR(64) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id ${pkDef},
        setting_key VARCHAR(150) NOT NULL UNIQUE,
        group_id INT NOT NULL,
        module VARCHAR(64) NOT NULL,
        namespace VARCHAR(120) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        value_type INT NOT NULL DEFAULT 1,
        default_value TEXT NOT NULL,
        global_value TEXT NOT NULL,
        validation_rules_json TEXT NULL,
        is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
        is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
        allow_unit_override BOOLEAN NOT NULL DEFAULT TRUE,
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        status INT NOT NULL DEFAULT 1,
        updated_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS system_setting_scopes (
        id ${pkDef},
        setting_id INT NOT NULL,
        environment INT NOT NULL DEFAULT 1,
        organization_unit_id INT NULL,
        setting_value TEXT NOT NULL,
        is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
        updated_by INT NULL,
        reason VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS system_setting_histories (
        id ${pkDef},
        setting_id INT NOT NULL,
        environment INT NOT NULL DEFAULT 1,
        organization_unit_id INT NULL,
        value_type INT NOT NULL DEFAULT 1,
        old_value TEXT NULL,
        new_value TEXT NOT NULL,
        actor_user_id INT NULL,
        actor_identifier VARCHAR(150) NULL,
        reason VARCHAR(500) NULL,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        request_id VARCHAR(128) NULL,
        correlation_id VARCHAR(128) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const discoveredSettings = discoverManifestSettings();
    const mergedSettingGroups = new Map<string, SettingGroupManifestItem>();
    for (const grp of this.settingGroups) {
      mergedSettingGroups.set(grp.code.trim().toLowerCase(), grp);
    }
    for (const grp of discoveredSettings.groups) {
      mergedSettingGroups.set(grp.code.trim().toLowerCase(), grp);
    }

    const mergedSystemSettings = new Map<string, SettingManifestItem>();
    for (const item of discoveredSettings.settings) {
      mergedSystemSettings.set(item.key.trim().toLowerCase(), item);
    }
    for (const item of this.systemSettings) {
      mergedSystemSettings.set(item.key.trim().toLowerCase(), item);
    }

    let settingsSeeded = 0;

    for (const grp of mergedSettingGroups.values()) {
      const grpCode = grp.code.trim().toLowerCase();
      const grpModule = (grp.module ?? 'settings').trim().toLowerCase();
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO setting_groups (code, module, name, description, icon, sort_order, is_system, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
           ON CONFLICT (code) DO UPDATE SET
             module = EXCLUDED.module,
             name = COALESCE(NULLIF(setting_groups.name, ''), EXCLUDED.name),
             description = COALESCE(setting_groups.description, EXCLUDED.description),
             icon = COALESCE(setting_groups.icon, EXCLUDED.icon),
             sort_order = EXCLUDED.sort_order`,
          [
            grpCode,
            grpModule,
            grp.name,
            grp.description ?? null,
            grp.icon ?? null,
            grp.sortOrder ?? 0,
            grp.isSystem ?? true,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO setting_groups (code, module, name, description, icon, sort_order, is_system, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             module = VALUES(module),
             name = COALESCE(NULLIF(setting_groups.name, ''), VALUES(name)),
             description = COALESCE(setting_groups.description, VALUES(description)),
             icon = COALESCE(setting_groups.icon, VALUES(icon)),
             sort_order = VALUES(sort_order)`,
          [
            grpCode,
            grpModule,
            grp.name,
            grp.description ?? null,
            grp.icon ?? null,
            grp.sortOrder ?? 0,
            grp.isSystem ?? true,
          ],
        );
      }
      affected++;
    }

    const groupRows = (await ctx.manager.query(`SELECT id, code FROM setting_groups`)) as Array<{
      id: number;
      code: string;
    }>;
    const groupIdByCode = new Map<string, number>();
    for (const row of groupRows) {
      groupIdByCode.set(String(row.code).trim().toLowerCase(), Number(row.id));
    }

    for (const item of mergedSystemSettings.values()) {
      const key = item.key.trim().toLowerCase();
      const valueType = parseSettingValueTypeCode(item.valueType);
      const { serialized } = validateAndSerializeSettingValue(
        item.defaultValue,
        valueType,
        item.validationRules,
        key,
      );
      const groupCode = (item.groupCode || key.split('.')[0] || 'system').trim().toLowerCase();
      const groupId = groupIdByCode.get(groupCode) ?? 1;
      const moduleName = (item.module ?? 'settings').trim().toLowerCase();
      const namespace = (item.namespace ?? `${moduleName}.${groupCode}`).trim().toLowerCase();
      const rulesJson = item.validationRules ? JSON.stringify(item.validationRules) : null;

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO system_settings (
             setting_key, group_id, module, namespace, name, description,
             value_type, default_value, global_value, validation_rules_json,
             is_sensitive, is_encrypted, allow_unit_override, is_system, sort_order, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE, $12, $13, $14, 1)
           ON CONFLICT (setting_key) DO UPDATE SET
             group_id = EXCLUDED.group_id,
             module = EXCLUDED.module,
             namespace = EXCLUDED.namespace,
             value_type = EXCLUDED.value_type,
             default_value = EXCLUDED.default_value,
             validation_rules_json = COALESCE(EXCLUDED.validation_rules_json, system_settings.validation_rules_json)`,
          [
            key,
            groupId,
            moduleName,
            namespace,
            item.name,
            item.description ?? null,
            valueType,
            serialized,
            serialized,
            rulesJson,
            item.isSensitive ?? false,
            item.allowUnitOverride ?? true,
            item.isSystem ?? true,
            item.sortOrder ?? 0,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO system_settings (
             setting_key, group_id, module, namespace, name, description,
             value_type, default_value, global_value, validation_rules_json,
             is_sensitive, is_encrypted, allow_unit_override, is_system, sort_order, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             group_id = VALUES(group_id),
             module = VALUES(module),
             namespace = VALUES(namespace),
             value_type = VALUES(value_type),
             default_value = VALUES(default_value),
             validation_rules_json = COALESCE(VALUES(validation_rules_json), system_settings.validation_rules_json)`,
          [
            key,
            groupId,
            moduleName,
            namespace,
            item.name,
            item.description ?? null,
            valueType,
            serialized,
            serialized,
            rulesJson,
            item.isSensitive ?? false,
            item.allowUnitOverride ?? true,
            item.isSystem ?? true,
            item.sortOrder ?? 0,
          ],
        );
      }
      settingsSeeded++;
      affected++;
    }

    const settingRows = (await ctx.manager.query(
      `SELECT id, setting_key FROM system_settings`,
    )) as Array<{ id: number; setting_key: string }>;
    const settingIdByKey = new Map<string, number>();
    for (const row of settingRows) {
      settingIdByKey.set(String(row.setting_key).trim().toLowerCase(), Number(row.id));
    }

    let fallbackSettingId = 1;
    for (const item of mergedSystemSettings.values()) {
      const key = item.key.trim().toLowerCase();
      const settingId = settingIdByKey.get(key) ?? fallbackSettingId++;
      const valueType = parseSettingValueTypeCode(item.valueType);

      if (item.environmentOverrides && typeof item.environmentOverrides === 'object') {
        for (const [envKey, envVal] of Object.entries(item.environmentOverrides)) {
          const envCode = parseSettingEnvironmentCode(envKey);
          const validatedEnv = validateAndSerializeSettingValue(
            envVal,
            valueType,
            item.validationRules,
            key,
          );
          if (isPostgres) {
            const existingScope = (await ctx.manager.query(
              `SELECT id FROM system_setting_scopes WHERE setting_id = $1 AND environment = $2 AND organization_unit_id IS NULL LIMIT 1`,
              [settingId, envCode],
            )) as Array<{ id: number }>;
            if (existingScope.length === 0) {
              await ctx.manager.query(
                `INSERT INTO system_setting_scopes (
                   setting_id, environment, organization_unit_id, setting_value, is_encrypted, reason
                 ) VALUES ($1, $2, NULL, $3, FALSE, $4)`,
                [settingId, envCode, validatedEnv.serialized, 'Manifest environment default'],
              );
            }
          } else {
            const existingScope = (await ctx.manager.query(
              `SELECT id FROM system_setting_scopes WHERE setting_id = ? AND environment = ? AND organization_unit_id IS NULL LIMIT 1`,
              [settingId, envCode],
            )) as Array<{ id: number }>;
            if (existingScope.length === 0) {
              await ctx.manager.query(
                `INSERT INTO system_setting_scopes (
                   setting_id, environment, organization_unit_id, setting_value, is_encrypted, reason
                 ) VALUES (?, ?, NULL, ?, FALSE, ?)`,
                [settingId, envCode, validatedEnv.serialized, 'Manifest environment default'],
              );
            }
          }
          affected++;
        }
      }
    }

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id ${pkDef},
        flag_key VARCHAR(150) NOT NULL UNIQUE,
        module VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        rollout_percentage INT NOT NULL DEFAULT 100,
        target_user_ids_json TEXT NOT NULL,
        target_roles_json TEXT NOT NULL,
        target_org_unit_ids_json TEXT NOT NULL,
        starts_at TIMESTAMP NULL,
        ends_at TIMESTAMP NULL,
        metadata_json TEXT NULL,
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        status INT NOT NULL DEFAULT 1,
        updated_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS feature_flag_histories (
        id ${pkDef},
        flag_id INT NOT NULL,
        flag_key VARCHAR(150) NOT NULL,
        action VARCHAR(32) NOT NULL,
        old_state_json TEXT NULL,
        new_state_json TEXT NOT NULL,
        actor_user_id INT NULL,
        actor_identifier VARCHAR(150) NULL,
        reason VARCHAR(500) NULL,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        request_id VARCHAR(128) NULL,
        correlation_id VARCHAR(128) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const mergedFeatureFlags = new Map<string, FeatureFlagManifestItem>();
    for (const item of discoverManifestFeatureFlags()) {
      mergedFeatureFlags.set(item.key.trim().toLowerCase(), item);
    }
    for (const item of this.featureFlags) {
      mergedFeatureFlags.set(item.key.trim().toLowerCase(), item);
    }

    let featureFlagsSeeded = 0;
    for (const flag of mergedFeatureFlags.values()) {
      const flagKey = flag.key.trim().toLowerCase();
      const moduleName = (flag.module ?? flagKey.split('.')[0] ?? 'settings').trim().toLowerCase();
      const isEnabled = Boolean(flag.isEnabled ?? false);
      const rolloutPercentage = flag.rolloutPercentage ?? 100;
      const targetUserIdsJson = JSON.stringify(flag.targetUserIds ?? []);
      const targetRolesJson = JSON.stringify(flag.targetRoles ?? []);
      const targetOrgUnitsJson = JSON.stringify(flag.targetOrganizationUnitIds ?? []);
      const startsAt = flag.startsAt ? new Date(flag.startsAt) : null;
      const endsAt = flag.endsAt ? new Date(flag.endsAt) : null;
      const metadataJson = flag.metadata ? JSON.stringify(flag.metadata) : null;
      const isSystem = flag.isSystem ?? true;

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO feature_flags (
             flag_key, module, name, description, is_enabled, rollout_percentage,
             target_user_ids_json, target_roles_json, target_org_unit_ids_json,
             starts_at, ends_at, metadata_json, is_system, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
           ON CONFLICT (flag_key) DO UPDATE SET
             module = EXCLUDED.module,
             name = COALESCE(NULLIF(feature_flags.name, ''), EXCLUDED.name),
             description = COALESCE(NULLIF(feature_flags.description, ''), EXCLUDED.description),
             is_system = EXCLUDED.is_system`,
          [
            flagKey,
            moduleName,
            flag.name,
            flag.description,
            isEnabled,
            rolloutPercentage,
            targetUserIdsJson,
            targetRolesJson,
            targetOrgUnitsJson,
            startsAt,
            endsAt,
            metadataJson,
            isSystem,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO feature_flags (
             flag_key, module, name, description, is_enabled, rollout_percentage,
             target_user_ids_json, target_roles_json, target_org_unit_ids_json,
             starts_at, ends_at, metadata_json, is_system, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             module = VALUES(module),
             name = COALESCE(NULLIF(feature_flags.name, ''), VALUES(name)),
             description = COALESCE(NULLIF(feature_flags.description, ''), VALUES(description)),
             is_system = VALUES(is_system)`,
          [
            flagKey,
            moduleName,
            flag.name,
            flag.description,
            isEnabled,
            rolloutPercentage,
            targetUserIdsJson,
            targetRolesJson,
            targetOrgUnitsJson,
            startsAt,
            endsAt,
            metadataJson,
            isSystem,
          ],
        );
      }
      featureFlagsSeeded++;
      affected++;
    }

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS i18n_locales (
        id ${pkDef},
        code VARCHAR(16) NOT NULL UNIQUE,
        bcp47_tag VARCHAR(32) NOT NULL,
        name VARCHAR(100) NOT NULL,
        native_name VARCHAR(100) NOT NULL,
        direction VARCHAR(8) NOT NULL DEFAULT 'ltr',
        date_format VARCHAR(32) NOT NULL DEFAULT 'dd/MM/yyyy',
        datetime_format VARCHAR(64) NOT NULL DEFAULT 'dd/MM/yyyy HH:mm:ss',
        currency_code VARCHAR(8) NOT NULL DEFAULT 'VND',
        number_decimal_separator VARCHAR(4) NOT NULL DEFAULT ',',
        number_group_separator VARCHAR(4) NOT NULL DEFAULT '.',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        status INT NOT NULL DEFAULT 1,
        updated_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS i18n_timezones (
        id ${pkDef},
        code VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        labels_json TEXT NULL,
        utc_offset VARCHAR(16) NOT NULL,
        utc_offset_minutes INT NOT NULL DEFAULT 0,
        region VARCHAR(64) NOT NULL DEFAULT 'Asia',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        status INT NOT NULL DEFAULT 1,
        updated_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS i18n_translations (
        id ${pkDef},
        locale VARCHAR(16) NOT NULL,
        namespace VARCHAR(64) NOT NULL DEFAULT 'common',
        translation_key VARCHAR(191) NOT NULL,
        translation_value TEXT NOT NULL,
        description VARCHAR(255) NULL,
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        status INT NOT NULL DEFAULT 1,
        updated_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        CONSTRAINT uq_i18n_translations_locale_key UNIQUE (locale, translation_key)
      )
    `);

    const discoveredI18n = discoverManifestI18n();
    const mergedLocales = new Map<string, I18nLocaleManifestItem>();
    for (const loc of discoveredI18n.locales) {
      mergedLocales.set(loc.code.trim().toLowerCase(), loc);
    }
    for (const loc of this.i18nLocales) {
      mergedLocales.set(loc.code.trim().toLowerCase(), loc);
    }

    let localesSeeded = 0;
    for (const loc of mergedLocales.values()) {
      const code = loc.code.trim().toLowerCase();
      const bcp47Tag =
        loc.bcp47Tag?.trim() || (code === 'vi' ? 'vi-VN' : `${code}-${code.toUpperCase()}`);
      const direction = loc.direction === 'rtl' ? 'rtl' : 'ltr';
      const decimalSep = loc.numberDecimalSeparator || ',';
      const groupSep = loc.numberGroupSeparator || '.';
      const isDefault = Boolean(loc.isDefault);
      const isSystem = loc.isSystem ?? true;
      const sortOrder = loc.sortOrder ?? localesSeeded + 1;
      const status = loc.status ?? 1;

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO i18n_locales (
             code, bcp47_tag, name, native_name, direction, date_format, datetime_format,
             currency_code, number_decimal_separator, number_group_separator,
             is_default, is_system, sort_order, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (code) DO UPDATE SET
             bcp47_tag = EXCLUDED.bcp47_tag,
             name = EXCLUDED.name,
             native_name = EXCLUDED.native_name,
             date_format = COALESCE(NULLIF(i18n_locales.date_format, ''), EXCLUDED.date_format),
             datetime_format = COALESCE(NULLIF(i18n_locales.datetime_format, ''), EXCLUDED.datetime_format),
             currency_code = COALESCE(NULLIF(i18n_locales.currency_code, ''), EXCLUDED.currency_code)`,
          [
            code,
            bcp47Tag,
            loc.name,
            loc.nativeName,
            direction,
            loc.dateFormat,
            loc.datetimeFormat,
            loc.currencyCode.toUpperCase(),
            decimalSep,
            groupSep,
            isDefault,
            isSystem,
            sortOrder,
            status,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO i18n_locales (
             code, bcp47_tag, name, native_name, direction, date_format, datetime_format,
             currency_code, number_decimal_separator, number_group_separator,
             is_default, is_system, sort_order, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             bcp47_tag = VALUES(bcp47_tag),
             name = VALUES(name),
             native_name = VALUES(native_name),
             date_format = COALESCE(NULLIF(i18n_locales.date_format, ''), VALUES(date_format)),
             datetime_format = COALESCE(NULLIF(i18n_locales.datetime_format, ''), VALUES(datetime_format)),
             currency_code = COALESCE(NULLIF(i18n_locales.currency_code, ''), VALUES(currency_code))`,
          [
            code,
            bcp47Tag,
            loc.name,
            loc.nativeName,
            direction,
            loc.dateFormat,
            loc.datetimeFormat,
            loc.currencyCode.toUpperCase(),
            decimalSep,
            groupSep,
            isDefault,
            isSystem,
            sortOrder,
            status,
          ],
        );
      }
      localesSeeded++;
      affected++;
    }

    const mergedTimezones = new Map<string, I18nTimezoneManifestItem>();
    for (const tz of discoveredI18n.timezones) {
      mergedTimezones.set(tz.code.trim(), tz);
    }
    for (const tz of this.i18nTimezones) {
      mergedTimezones.set(tz.code.trim(), tz);
    }

    let timezonesSeeded = 0;
    for (const tz of mergedTimezones.values()) {
      const code = tz.code.trim();
      const labelsJson = JSON.stringify(tz.labels ?? { vi: tz.name, en: tz.name });
      const region = tz.region ?? (code.includes('/') ? code.split('/')[0]! : 'UTC');
      const isDefault = Boolean(tz.isDefault);
      const isSystem = tz.isSystem ?? true;
      const sortOrder = tz.sortOrder ?? timezonesSeeded + 1;
      const status = tz.status ?? 1;

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO i18n_timezones (
             code, name, labels_json, utc_offset, utc_offset_minutes, region,
             is_default, is_system, sort_order, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name,
             labels_json = COALESCE(i18n_timezones.labels_json, EXCLUDED.labels_json),
             utc_offset = EXCLUDED.utc_offset,
             utc_offset_minutes = EXCLUDED.utc_offset_minutes,
             region = EXCLUDED.region`,
          [
            code,
            tz.name,
            labelsJson,
            tz.utcOffset,
            tz.utcOffsetMinutes,
            region,
            isDefault,
            isSystem,
            sortOrder,
            status,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO i18n_timezones (
             code, name, labels_json, utc_offset, utc_offset_minutes, region,
             is_default, is_system, sort_order, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             labels_json = COALESCE(i18n_timezones.labels_json, VALUES(labels_json)),
             utc_offset = VALUES(utc_offset),
             utc_offset_minutes = VALUES(utc_offset_minutes),
             region = VALUES(region)`,
          [
            code,
            tz.name,
            labelsJson,
            tz.utcOffset,
            tz.utcOffsetMinutes,
            region,
            isDefault,
            isSystem,
            sortOrder,
            status,
          ],
        );
      }
      timezonesSeeded++;
      affected++;
    }

    const mergedTranslations = new Map<string, I18nTranslationManifestItem>();
    for (const tr of discoveredI18n.translations) {
      mergedTranslations.set(`${tr.locale.trim().toLowerCase()}::${tr.key.trim()}`, tr);
    }
    for (const tr of this.i18nTranslations) {
      mergedTranslations.set(`${tr.locale.trim().toLowerCase()}::${tr.key.trim()}`, tr);
    }

    let translationsSeeded = 0;
    for (const tr of mergedTranslations.values()) {
      const locale = tr.locale.trim().toLowerCase();
      const key = tr.key.trim();
      const namespace = (tr.namespace || (key.includes('.') ? key.split('.')[0]! : 'common'))
        .trim()
        .toLowerCase();

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO i18n_translations (
             locale, namespace, translation_key, translation_value, description, is_system, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (locale, translation_key) DO NOTHING`,
          [
            locale,
            namespace,
            key,
            tr.value,
            tr.description ?? null,
            tr.isSystem ?? true,
            tr.status ?? 1,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO i18n_translations (
             locale, namespace, translation_key, translation_value, description, is_system, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             translation_value = COALESCE(NULLIF(i18n_translations.translation_value, ''), VALUES(translation_value))`,
          [
            locale,
            namespace,
            key,
            tr.value,
            tr.description ?? null,
            tr.isSystem ?? true,
            tr.status ?? 1,
          ],
        );
      }
      translationsSeeded++;
      affected++;
    }

    // 7. Đồng bộ Quy tắc Sinh mã Nghiệp vụ (Mục 5.5 — sequence_rules, sequence_counters, sequence_rule_histories)
    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS sequence_rules (
        id ${pkDef},
        sequence_key VARCHAR(150) NOT NULL UNIQUE,
        module VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        prefix VARCHAR(32) NOT NULL DEFAULT '',
        suffix VARCHAR(32) NOT NULL DEFAULT '',
        separator_char VARCHAR(8) NOT NULL DEFAULT '-',
        date_format INT NOT NULL DEFAULT 1,
        template_pattern VARCHAR(255) NULL,
        padding_length INT NOT NULL DEFAULT 6,
        start_value BIGINT NOT NULL DEFAULT 1,
        step INT NOT NULL DEFAULT 1,
        reset_policy INT NOT NULL DEFAULT 2,
        scope_by_unit BOOLEAN NOT NULL DEFAULT FALSE,
        timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        status INT NOT NULL DEFAULT 1,
        updated_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS sequence_counters (
        id ${pkDef},
        sequence_id INT NOT NULL,
        sequence_key VARCHAR(150) NOT NULL,
        period_key VARCHAR(32) NOT NULL DEFAULT 'ALL',
        organization_unit_id INT NULL,
        unit_scope_key VARCHAR(64) NOT NULL DEFAULT 'GLOBAL',
        current_value BIGINT NOT NULL DEFAULT 0,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        CONSTRAINT uq_sequence_counters_scope UNIQUE (sequence_id, period_key, unit_scope_key)
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS sequence_rule_histories (
        id ${pkDef},
        sequence_id INT NOT NULL,
        sequence_key VARCHAR(150) NOT NULL,
        action VARCHAR(32) NOT NULL,
        old_state_json TEXT NULL,
        new_state_json TEXT NOT NULL,
        actor_user_id INT NULL,
        actor_identifier VARCHAR(150) NULL,
        reason VARCHAR(500) NULL,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        request_id VARCHAR(128) NULL,
        correlation_id VARCHAR(128) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const discoveredSequences: SequenceManifestItem[] = discoverManifestSequences();
    let sequencesSeeded = 0;
    for (const seq of discoveredSequences) {
      const key = seq.key.trim().toLowerCase();
      const moduleName = (seq.module ?? key.split('.')[0] ?? 'settings').trim().toLowerCase();
      const validated = validateSequenceRule({
        key,
        name: seq.name,
        prefix: seq.prefix,
        suffix: seq.suffix,
        separator: seq.separator,
        dateFormat: seq.dateFormat,
        templatePattern: seq.templatePattern,
        paddingLength: seq.paddingLength,
        startValue: seq.startValue,
        step: seq.step,
        resetPolicy: seq.resetPolicy,
        scopeByUnit: seq.scopeByUnit,
        timezone: seq.timezone,
      });

      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO sequence_rules (
             sequence_key, module, name, description, prefix, suffix, separator_char,
             date_format, template_pattern, padding_length, start_value, step,
             reset_policy, scope_by_unit, timezone, is_system, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (sequence_key) DO UPDATE SET
             module = EXCLUDED.module,
             name = COALESCE(NULLIF(sequence_rules.name, ''), EXCLUDED.name),
             description = COALESCE(sequence_rules.description, EXCLUDED.description),
             is_system = EXCLUDED.is_system`,
          [
            key,
            moduleName,
            validated.name,
            seq.description ?? null,
            validated.prefix,
            validated.suffix,
            validated.separator,
            validated.dateFormat,
            validated.templatePattern,
            validated.paddingLength,
            validated.startValue,
            validated.step,
            validated.resetPolicy,
            validated.scopeByUnit,
            validated.timezone,
            seq.isSystem ?? true,
            seq.status ?? 1,
          ],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO sequence_rules (
             sequence_key, module, name, description, prefix, suffix, separator_char,
             date_format, template_pattern, padding_length, start_value, step,
             reset_policy, scope_by_unit, timezone, is_system, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             module = VALUES(module),
             name = COALESCE(NULLIF(sequence_rules.name, ''), VALUES(name)),
             description = COALESCE(sequence_rules.description, VALUES(description)),
             is_system = VALUES(is_system)`,
          [
            key,
            moduleName,
            validated.name,
            seq.description ?? null,
            validated.prefix,
            validated.suffix,
            validated.separator,
            validated.dateFormat,
            validated.templatePattern,
            validated.paddingLength,
            validated.startValue,
            validated.step,
            validated.resetPolicy,
            validated.scopeByUnit,
            validated.timezone,
            seq.isSystem ?? true,
            seq.status ?? 1,
          ],
        );
      }
      sequencesSeeded++;
      affected++;
    }

    return {
      affected,
      details: `${this.permissions.length} permissions, ${this.masterSettings.length} master settings, ${mergedCodeTypes.size} code_types (${codeValuesSeeded} code_values), ${mergedSettingGroups.size} setting_groups (${settingsSeeded} system_settings), ${featureFlagsSeeded} feature_flags, ${localesSeeded} i18n_locales, ${timezonesSeeded} i18n_timezones, ${translationsSeeded} i18n_translations, ${sequencesSeeded} sequence_rules synced`,
    };
  }
}
