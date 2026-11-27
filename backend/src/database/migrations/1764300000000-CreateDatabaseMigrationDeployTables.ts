import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateDatabaseMigrationDeployTables (2026-11-27)
 * Triển khai Section 15.4 — Triển khai Database an toàn:
 * - `db_migration_rollouts`: Lịch sử triển khai migration Production/Staging (phiên bản, người duyệt, backup, preflight, lock duration, post-check).
 * - `db_backfill_jobs`: Theo dõi tiến độ các job Backfill dữ liệu lớn chạy qua Queue (batch, cursor checkpoint, dry-run, cancel).
 */
export class CreateDatabaseMigrationDeployTables1764300000000 implements MigrationInterface {
  public readonly name = 'CreateDatabaseMigrationDeployTables1764300000000';
  public readonly phase = 'expand' as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS db_migration_rollouts (
        id ${pkDef},
        rollout_code VARCHAR(64) NOT NULL,
        release_version VARCHAR(80) NOT NULL,
        git_commit VARCHAR(64) NULL,
        environment VARCHAR(32) NOT NULL,
        phase VARCHAR(24) NOT NULL DEFAULT 'standard',
        risk_level VARCHAR(24) NOT NULL DEFAULT 'LOW',
        status VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
        executed_migrations_json TEXT NULL,
        checksum_snapshot_json TEXT NULL,
        approved_by VARCHAR(120) NULL,
        approval_ticket VARCHAR(80) NULL,
        executed_by VARCHAR(120) NOT NULL,
        backup_record_id INT NULL,
        backup_code VARCHAR(64) NULL,
        backup_verified BOOLEAN NOT NULL DEFAULT FALSE,
        lock_timeout_ms INT NULL,
        max_migration_duration_ms INT NULL,
        duration_ms INT NOT NULL DEFAULT 0,
        preflight_report_json TEXT NULL,
        post_check_report_json TEXT NULL,
        error_message TEXT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS db_backfill_jobs (
        id ${pkDef},
        job_code VARCHAR(64) NOT NULL,
        job_name VARCHAR(120) NOT NULL,
        migration_name VARCHAR(180) NULL,
        queue_job_id VARCHAR(120) NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
        batch_size INT NOT NULL DEFAULT 500,
        throttle_ms INT NOT NULL DEFAULT 100,
        processed_rows BIGINT NOT NULL DEFAULT 0,
        updated_rows BIGINT NOT NULL DEFAULT 0,
        total_rows BIGINT NULL,
        percent INT NOT NULL DEFAULT 0,
        last_cursor VARCHAR(255) NULL,
        dry_run BOOLEAN NOT NULL DEFAULT FALSE,
        cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
        triggered_by VARCHAR(120) NOT NULL,
        error_message TEXT NULL,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    if (isPostgres) {
      await queryRunner.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_db_migration_rollouts_code" ON db_migration_rollouts (rollout_code)',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS "IDX_db_migration_rollouts_env_started" ON db_migration_rollouts (environment, started_at)',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS "IDX_db_migration_rollouts_status" ON db_migration_rollouts (status, started_at)',
      );
      await queryRunner.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_db_backfill_jobs_code" ON db_backfill_jobs (job_code)',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS "IDX_db_backfill_jobs_name_status" ON db_backfill_jobs (job_name, status)',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS db_backfill_jobs');
    await queryRunner.query('DROP TABLE IF EXISTS db_migration_rollouts');
  }
}
