import type { SeederContext, SeederContract } from '@packages/database/index.js';

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
 * Seeder đồng bộ danh mục Quyền hạn (`permissions`) từ `module.manifest.json` và Master Data nền tảng (`core_master_settings`).
 * Thiết kế Idempotent: chạy nhiều lần trên mọi môi trường (kể cả Production) không sinh dữ liệu trùng.
 */
export class MasterPermissionSeeder implements SeederContract {
  public readonly name = 'MasterPermissionAndSettingsSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 10;

  constructor(
    private readonly permissions: PermissionSeedItem[],
    private readonly masterSettings: MasterSettingSeedItem[] = DEFAULT_MASTER_SETTINGS,
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

    return {
      affected,
      details: `${this.permissions.length} permissions, ${this.masterSettings.length} master settings synced`,
    };
  }
}
