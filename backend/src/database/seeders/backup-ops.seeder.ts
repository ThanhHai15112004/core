import type { SeederContext, SeederContract } from '@packages/database/index.js';

interface DefaultBackupPolicySeed {
  code: string;
  name: string;
  targetType: 'DATABASE' | 'STORAGE';
  scheduleCron: string;
  timezone: string;
  isEnabled: boolean;
  encryptionEnabled: boolean;
  compressionEnabled: boolean;
  retentionDays: number;
  maxKeepCount: number;
  autoVerifyDrill: boolean;
  alertOnFailure: boolean;
  staleThresholdHours: number;
  storagePrefix: string;
}

const DEFAULT_BACKUP_POLICIES: readonly DefaultBackupPolicySeed[] = [
  {
    code: 'DAILY_DATABASE_BACKUP',
    name: 'Sao lưu Database tự động hằng ngày',
    targetType: 'DATABASE',
    scheduleCron: '0 2 * * *',
    timezone: 'Asia/Ho_Chi_Minh',
    isEnabled: true,
    encryptionEnabled: true,
    compressionEnabled: true,
    retentionDays: 14,
    maxKeepCount: 30,
    autoVerifyDrill: true,
    alertOnFailure: true,
    staleThresholdHours: 26,
    storagePrefix: 'backups',
  },
  {
    code: 'WEEKLY_STORAGE_SNAPSHOT',
    name: 'Snapshot Object Storage định kỳ hằng tuần',
    targetType: 'STORAGE',
    scheduleCron: '30 2 * * 0',
    timezone: 'Asia/Ho_Chi_Minh',
    isEnabled: true,
    encryptionEnabled: true,
    compressionEnabled: true,
    retentionDays: 30,
    maxKeepCount: 12,
    autoVerifyDrill: false,
    alertOnFailure: true,
    staleThresholdHours: 192,
    storagePrefix: 'backups',
  },
];

/**
 * Seeder khởi tạo 2 chính sách Backup mặc định (`backup_policies`) cho Mục 13.6.
 * Dùng INSERT IGNORE / ON CONFLICT DO NOTHING để giữ nguyên cấu hình người vận hành đã chỉnh.
 */
export class BackupOpsSeeder implements SeederContract {
  public readonly name = 'BackupOpsSeeder';
  public readonly scope = 'master' as const;
  public readonly order = 17;

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    const isPostgres = ctx.driver === 'postgres';
    let affected = 0;

    for (const p of DEFAULT_BACKUP_POLICIES) {
      const params = [
        p.code,
        p.name,
        p.targetType,
        p.scheduleCron,
        p.timezone,
        p.isEnabled,
        p.encryptionEnabled,
        p.compressionEnabled,
        p.retentionDays,
        p.maxKeepCount,
        p.autoVerifyDrill,
        p.alertOnFailure,
        p.staleThresholdHours,
        p.storagePrefix,
      ];

      if (isPostgres) {
        const res = await ctx.manager.query(
          `INSERT INTO backup_policies (
            code, name, target_type, schedule_cron, timezone, is_enabled,
            encryption_enabled, compression_enabled, retention_days, max_keep_count,
            auto_verify_drill, alert_on_failure, stale_threshold_hours, storage_prefix
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (code) DO NOTHING`,
          params,
        );
        affected += Number((res as { rowCount?: number } | undefined)?.rowCount ?? 0);
      } else {
        const res = await ctx.manager.query(
          `INSERT IGNORE INTO backup_policies (
            code, name, target_type, schedule_cron, timezone, is_enabled,
            encryption_enabled, compression_enabled, retention_days, max_keep_count,
            auto_verify_drill, alert_on_failure, stale_threshold_hours, storage_prefix
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        );
        affected += Number((res as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
      }
    }

    return {
      affected,
      details: `${affected} default backup polic(ies) seeded`,
    };
  }
}
