import type { SeederContext, SeederContract } from '@packages/database/index.js';

export interface PermissionSeedItem {
  code: string;
  module: string;
  description: string;
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
 * Seeder đồng bộ danh mục Quyền hạn (Permissions) từ `module.manifest.json` và Master Data nền tảng.
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
    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS core_permissions (
        code VARCHAR(128) PRIMARY KEY,
        module VARCHAR(64) NOT NULL,
        description VARCHAR(255) NOT NULL
      )
    `);

    await ctx.manager.query(`
      CREATE TABLE IF NOT EXISTS core_master_settings (
        setting_key VARCHAR(128) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description VARCHAR(255) NOT NULL
      )
    `);

    let affected = 0;
    const isPostgres = ctx.driver === 'postgres';

    for (const perm of this.permissions) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO core_permissions (code, module, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`,
          [perm.code, perm.module, perm.description],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO core_permissions (code, module, description)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE module = VALUES(module), description = VALUES(description)`,
          [perm.code, perm.module, perm.description],
        );
      }
      affected++;
    }

    for (const setting of this.masterSettings) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO core_master_settings (setting_key, setting_value, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (setting_key) DO NOTHING`,
          [setting.key, setting.value, setting.description],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO core_master_settings (setting_key, setting_value, description)
           VALUES (?, ?, ?)
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
