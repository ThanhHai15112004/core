import type { SeederContext, SeederContract } from '@packages/database/index.js';
import { type CodeTypeManifestItem, discoverManifestCodeTypes } from '@packages/kernel/index.js';

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

/**
 * Seeder đồng bộ danh mục Quyền hạn (`permissions`), Danh mục Động & Hybrid (`code_types`, `code_values`)
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

    return {
      affected,
      details: `${this.permissions.length} permissions, ${this.masterSettings.length} master settings, ${mergedCodeTypes.size} code_types (${codeValuesSeeded} code_values) synced`,
    };
  }
}
