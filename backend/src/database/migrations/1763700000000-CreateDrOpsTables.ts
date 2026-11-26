import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateDrOpsTables (2026-11-26)
 * Triển khai Mục 13.7 — Disaster Recovery (`dr-ops`):
 * 1. `dr_profiles`: Cấu hình DC chính ↔ DR dự phòng, mục tiêu RPO/RTO, trạng thái site đang phục vụ & lịch diễn tập.
 * 2. `dr_sync_runs`: Lịch sử đồng bộ DB & Storage sang DR, đo `actual_rpo_seconds` và đánh giá đạt RPO.
 * 3. `dr_switch_executions`: Phiên Failover / Failback có checklist bắt buộc, chống split-brain và đo `actual_rto_seconds`.
 * 4. `dr_reconciliation_reports`: Đối soát dữ liệu DB & Storage sau chuyển hệ thống (phát hiện thiếu, trùng, lệch).
 * 5. `dr_drills`: Lịch sử diễn tập DR định kỳ, đo RPO/RTO thực tế và chấm Đạt / Không đạt.
 */
export class CreateDrOpsTables1763700000000 implements MigrationInterface {
  public readonly name = 'CreateDrOpsTables1763700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dr_profiles (
        id ${pkDef},
        code VARCHAR(64) NOT NULL,
        name VARCHAR(160) NOT NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        topology_mode VARCHAR(32) NOT NULL DEFAULT 'WARM_STANDBY',
        rpo_target_seconds INT NOT NULL DEFAULT 900,
        rto_target_seconds INT NOT NULL DEFAULT 1800,
        primary_site_code VARCHAR(64) NOT NULL DEFAULT 'dc-primary',
        primary_site_name VARCHAR(160) NOT NULL DEFAULT 'Primary Data Center',
        primary_region VARCHAR(80) NOT NULL DEFAULT 'ap-southeast-1',
        primary_endpoint VARCHAR(255) NULL,
        dr_site_code VARCHAR(64) NOT NULL DEFAULT 'dc-dr',
        dr_site_name VARCHAR(160) NOT NULL DEFAULT 'DR Standby Site',
        dr_region VARCHAR(80) NOT NULL DEFAULT 'ap-southeast-2',
        dr_endpoint VARCHAR(255) NULL,
        active_site VARCHAR(24) NOT NULL DEFAULT 'PRIMARY',
        operational_state VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
        sync_cron VARCHAR(64) NOT NULL DEFAULT '*/15 * * * *',
        drill_interval_days INT NOT NULL DEFAULT 30,
        last_sync_at TIMESTAMP NULL,
        last_rpo_seconds INT NULL,
        last_drill_at TIMESTAMP NULL,
        last_rto_seconds INT NULL,
        next_drill_due_at TIMESTAMP NULL,
        options_json TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dr_sync_runs (
        id ${pkDef},
        sync_code VARCHAR(64) NOT NULL,
        profile_code VARCHAR(64) NOT NULL DEFAULT 'DEFAULT',
        scope VARCHAR(24) NOT NULL DEFAULT 'FULL',
        trigger_source VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
        status VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
        db_lag_seconds INT NULL,
        db_checkpoint VARCHAR(255) NULL,
        storage_synced_count INT NOT NULL DEFAULT 0,
        storage_skipped_count INT NOT NULL DEFAULT 0,
        storage_failed_count INT NOT NULL DEFAULT 0,
        storage_synced_bytes BIGINT NOT NULL DEFAULT 0,
        actual_rpo_seconds INT NULL,
        rpo_target_seconds INT NOT NULL DEFAULT 900,
        rpo_met BOOLEAN NOT NULL DEFAULT FALSE,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        actor_user_id BIGINT NULL,
        actor_name VARCHAR(160) NULL,
        summary_json TEXT NULL,
        error_message TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dr_switch_executions (
        id ${pkDef},
        switch_code VARCHAR(64) NOT NULL,
        profile_code VARCHAR(64) NOT NULL DEFAULT 'DEFAULT',
        direction VARCHAR(24) NOT NULL,
        mode VARCHAR(24) NOT NULL DEFAULT 'SIMULATED',
        from_site VARCHAR(24) NOT NULL,
        to_site VARCHAR(24) NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'IN_PROGRESS',
        reason VARCHAR(1000) NOT NULL,
        checklist_json TEXT NOT NULL,
        rto_target_seconds INT NOT NULL DEFAULT 1800,
        actual_rto_seconds INT NULL,
        rto_met BOOLEAN NULL,
        reconciliation_report_id BIGINT NULL,
        initiated_by_user_id BIGINT NULL,
        initiated_by_name VARCHAR(160) NOT NULL,
        completed_by_name VARCHAR(160) NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        error_message TEXT NULL,
        metadata_json TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dr_reconciliation_reports (
        id ${pkDef},
        report_code VARCHAR(64) NOT NULL,
        profile_code VARCHAR(64) NOT NULL DEFAULT 'DEFAULT',
        switch_execution_id BIGINT NULL,
        scope VARCHAR(24) NOT NULL DEFAULT 'FULL',
        status VARCHAR(24) NOT NULL DEFAULT 'PASSED',
        db_tables_checked INT NOT NULL DEFAULT 0,
        db_missing_count INT NOT NULL DEFAULT 0,
        db_duplicate_count INT NOT NULL DEFAULT 0,
        db_mismatch_count INT NOT NULL DEFAULT 0,
        storage_objects_checked INT NOT NULL DEFAULT 0,
        storage_missing_count INT NOT NULL DEFAULT 0,
        storage_duplicate_count INT NOT NULL DEFAULT 0,
        storage_mismatch_count INT NOT NULL DEFAULT 0,
        total_discrepancies INT NOT NULL DEFAULT 0,
        findings_json TEXT NULL,
        actor_user_id BIGINT NULL,
        actor_name VARCHAR(160) NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        error_message TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dr_drills (
        id ${pkDef},
        drill_code VARCHAR(64) NOT NULL,
        profile_code VARCHAR(64) NOT NULL DEFAULT 'DEFAULT',
        drill_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL_SIMULATION',
        scenario VARCHAR(160) NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
        rpo_target_seconds INT NOT NULL DEFAULT 900,
        rto_target_seconds INT NOT NULL DEFAULT 1800,
        measured_rpo_seconds INT NULL,
        measured_rto_seconds INT NULL,
        rpo_met BOOLEAN NOT NULL DEFAULT FALSE,
        rto_met BOOLEAN NOT NULL DEFAULT FALSE,
        switch_execution_id BIGINT NULL,
        reconciliation_report_id BIGINT NULL,
        steps_json TEXT NULL,
        lessons_learned TEXT NULL,
        actor_user_id BIGINT NULL,
        actor_name VARCHAR(160) NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        error_message TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_dr_profiles_code ON dr_profiles (code)',
      'CREATE UNIQUE INDEX UQ_dr_sync_runs_code ON dr_sync_runs (sync_code)',
      'CREATE INDEX IDX_dr_sync_runs_profile_at ON dr_sync_runs (profile_code, started_at)',
      'CREATE INDEX IDX_dr_sync_runs_status_at ON dr_sync_runs (status, started_at)',
      'CREATE UNIQUE INDEX UQ_dr_switch_executions_code ON dr_switch_executions (switch_code)',
      'CREATE INDEX IDX_dr_switch_executions_profile_at ON dr_switch_executions (profile_code, started_at)',
      'CREATE INDEX IDX_dr_switch_executions_status ON dr_switch_executions (status, started_at)',
      'CREATE UNIQUE INDEX UQ_dr_reconciliation_reports_code ON dr_reconciliation_reports (report_code)',
      'CREATE INDEX IDX_dr_reconciliation_reports_profile_at ON dr_reconciliation_reports (profile_code, started_at)',
      'CREATE UNIQUE INDEX UQ_dr_drills_code ON dr_drills (drill_code)',
      'CREATE INDEX IDX_dr_drills_profile_at ON dr_drills (profile_code, started_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS dr_drills');
    await queryRunner.query('DROP TABLE IF EXISTS dr_reconciliation_reports');
    await queryRunner.query('DROP TABLE IF EXISTS dr_switch_executions');
    await queryRunner.query('DROP TABLE IF EXISTS dr_sync_runs');
    await queryRunner.query('DROP TABLE IF EXISTS dr_profiles');
  }
}
