import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateBackupOpsTables (2026-11-26)
 * Triển khai Mục 13.6 — Backup và Khôi phục (`backup-ops`):
 * 1. `backup_policies`: Chính sách & lịch backup định kỳ (DB/Storage), mã hóa, retention, auto-drill, cảnh báo.
 * 2. `backup_records`: Lịch sử từng bản backup (trạng thái, dung lượng, storage key, SHA-256, kết quả verify drill).
 * 3. `backup_restore_histories`: Nhật ký thao tác Restore / Drill (người thực hiện, lý do bắt buộc, môi trường đích, kết quả).
 */
export class CreateBackupOpsTables1763600000000 implements MigrationInterface {
  public readonly name = 'CreateBackupOpsTables1763600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS backup_policies (
        id ${pkDef},
        code VARCHAR(80) NOT NULL,
        name VARCHAR(160) NOT NULL,
        target_type VARCHAR(24) NOT NULL,
        schedule_cron VARCHAR(64) NOT NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        encryption_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        compression_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        retention_days INT NOT NULL DEFAULT 14,
        max_keep_count INT NOT NULL DEFAULT 30,
        auto_verify_drill BOOLEAN NOT NULL DEFAULT TRUE,
        alert_on_failure BOOLEAN NOT NULL DEFAULT TRUE,
        stale_threshold_hours INT NOT NULL DEFAULT 26,
        storage_prefix VARCHAR(160) NOT NULL DEFAULT 'backups',
        options_json TEXT NULL,
        last_run_at TIMESTAMP NULL,
        last_status VARCHAR(24) NULL,
        next_run_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS backup_records (
        id ${pkDef},
        backup_code VARCHAR(64) NOT NULL,
        policy_id BIGINT NULL,
        policy_code VARCHAR(80) NULL,
        target_type VARCHAR(24) NOT NULL,
        trigger_source VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
        status VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
        engine VARCHAR(40) NULL,
        storage_driver VARCHAR(24) NULL,
        storage_key VARCHAR(500) NULL,
        encrypted BOOLEAN NOT NULL DEFAULT TRUE,
        encryption_algorithm VARCHAR(40) NULL,
        compressed BOOLEAN NOT NULL DEFAULT TRUE,
        original_size_bytes BIGINT NULL,
        stored_size_bytes BIGINT NULL,
        plaintext_sha256 VARCHAR(64) NULL,
        artifact_sha256 VARCHAR(64) NULL,
        retention_days INT NOT NULL DEFAULT 14,
        expires_at TIMESTAMP NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        verify_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
        last_verified_at TIMESTAMP NULL,
        verify_summary_json TEXT NULL,
        triggered_by_user_id BIGINT NULL,
        triggered_by_name VARCHAR(160) NULL,
        error_message TEXT NULL,
        metadata_json TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS backup_restore_histories (
        id ${pkDef},
        restore_code VARCHAR(64) NOT NULL,
        backup_record_id BIGINT NULL,
        backup_code VARCHAR(64) NULL,
        operation_type VARCHAR(24) NOT NULL DEFAULT 'DRILL_ISOLATED',
        scope VARCHAR(24) NOT NULL DEFAULT 'DATABASE',
        target_environment VARCHAR(120) NOT NULL,
        target_database VARCHAR(120) NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
        verification_mode VARCHAR(40) NULL,
        actor_user_id BIGINT NULL,
        actor_name VARCHAR(160) NOT NULL,
        reason VARCHAR(1000) NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        verification_result_json TEXT NULL,
        error_message TEXT NULL,
        metadata_json TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_backup_policies_code ON backup_policies (code)',
      'CREATE INDEX IDX_backup_policies_enabled_type ON backup_policies (is_enabled, target_type, deleted_at)',
      'CREATE UNIQUE INDEX UQ_backup_records_code ON backup_records (backup_code)',
      'CREATE INDEX IDX_backup_records_policy_code ON backup_records (policy_code, started_at)',
      'CREATE INDEX IDX_backup_records_type_status_at ON backup_records (target_type, status, started_at)',
      'CREATE INDEX IDX_backup_records_expires_status ON backup_records (expires_at, status)',
      'CREATE UNIQUE INDEX UQ_backup_restore_histories_code ON backup_restore_histories (restore_code)',
      'CREATE INDEX IDX_backup_restore_histories_record ON backup_restore_histories (backup_record_id, started_at)',
      'CREATE INDEX IDX_backup_restore_histories_op_at ON backup_restore_histories (operation_type, started_at)',
    ];

    for (const sql of indexes) {
      if (isPostgres) {
        await queryRunner.query(
          sql
            .replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ')
            .replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '),
        );
      } else {
        await queryRunner.query(sql).catch(() => undefined);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS backup_restore_histories');
    await queryRunner.query('DROP TABLE IF EXISTS backup_records');
    await queryRunner.query('DROP TABLE IF EXISTS backup_policies');
  }
}
