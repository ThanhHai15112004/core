import type { SeederContext, SeederContract } from '@packages/database/index.js';

/**
 * Seeder khởi tạo hồ sơ DR mặc định (`DEFAULT`) trong `dr_profiles` cho Mục 13.7.
 * Mặc định `is_enabled = false` để chỉ bật ở các dự án cần mô hình DC–DR;
 * dùng INSERT IGNORE / ON CONFLICT DO NOTHING để không ghi đè cấu hình đã chỉnh.
 */
export class DrOpsSeeder implements SeederContract {
  public readonly name = 'DrOpsSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 18;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    const nextDrillDueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const params = [
      'DEFAULT',
      'Hồ sơ Disaster Recovery mặc định (DC chính ↔ DR dự phòng)',
      false,
      'WARM_STANDBY',
      900,
      1800,
      'dc-primary',
      'Primary Data Center',
      'ap-southeast-1',
      'dc-dr',
      'DR Standby Site',
      'ap-southeast-2',
      'PRIMARY',
      'NORMAL',
      '*/15 * * * *',
      30,
      nextDrillDueAt,
    ];

    let affected = 0;
    if (isPostgres) {
      const res = await ctx.manager.query(
        `INSERT INTO dr_profiles (
          code, name, is_enabled, topology_mode, rpo_target_seconds, rto_target_seconds,
          primary_site_code, primary_site_name, primary_region,
          dr_site_code, dr_site_name, dr_region,
          active_site, operational_state, sync_cron, drill_interval_days, next_drill_due_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (code) DO NOTHING`,
        params,
      );
      affected = Number((res as { rowCount?: number } | undefined)?.rowCount ?? 0);
    } else {
      const res = await ctx.manager.query(
        `INSERT IGNORE INTO dr_profiles (
          code, name, is_enabled, topology_mode, rpo_target_seconds, rto_target_seconds,
          primary_site_code, primary_site_name, primary_region,
          dr_site_code, dr_site_name, dr_region,
          active_site, operational_state, sync_cron, drill_interval_days, next_drill_due_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params,
      );
      affected = Number((res as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
    }

    return {
      affected,
      details: `${affected} default DR profile seeded`,
    };
  }
}
