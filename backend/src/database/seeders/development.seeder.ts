import type { SeederContext, SeederContract } from '@packages/database/index.js';

const DEV_SAMPLE_SETTINGS = [
  {
    key: 'dev.seed.initialized',
    value: 'true',
    description: 'Indicates development seed data has been loaded',
  },
  {
    key: 'dev.sandbox.enabled',
    value: 'true',
    description: 'Enable local sandbox testing utilities in development',
  },
];

/**
 * Seeder dữ liệu mẫu chỉ dành cho môi trường Development / Test.
 * Bị chặn tự động bởi `DatabaseSeederService` và chốt kiểm tra nội bộ khi `environment === 'production'`.
 */
export class DevelopmentDataSeeder implements SeederContract {
  public readonly name = 'DevelopmentSampleDataSeeder';
  public readonly scope = 'development' as const;
  public readonly order = 20;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    if (ctx.environment === 'production') {
      throw new Error('DevelopmentDataSeeder is strictly forbidden in production environment');
    }

    const isPostgres = ctx.driver === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

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

    for (const item of DEV_SAMPLE_SETTINGS) {
      if (isPostgres) {
        await ctx.manager.query(
          `INSERT INTO core_master_settings (setting_key, setting_value, description, status)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
          [item.key, item.value, item.description],
        );
      } else {
        await ctx.manager.query(
          `INSERT INTO core_master_settings (setting_key, setting_value, description, status)
           VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [item.key, item.value, item.description],
        );
      }
      affected++;
    }

    return {
      affected,
      details: `${affected} development setting(s) seeded`,
    };
  }
}
