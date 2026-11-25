import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateReconciliationTables (2026-11-25)
 * Triển khai Phase 11.5 — Đối soát và Sửa dữ liệu (`reconciliation`):
 * 1. `reconciliation_jobs`: Cấu hình Job đối soát định kỳ / thủ công giữa dữ liệu nội bộ và nguồn bên ngoài.
 * 2. `reconciliation_runs`: Lịch sử từng phiên chạy đối soát (thủ công/định kỳ, thống kê khớp/lệch).
 * 3. `reconciliation_discrepancies`: Chi tiết từng bản ghi sai lệch (thiếu, trùng, sai trạng thái, sai số tiền), mức độ & người phụ trách.
 * 4. `data_repair_requests`: Yêu cầu sửa dữ liệu & hành động bù (Dry-Run preview, phê duyệt Maker-Checker, before/after).
 * 5. `data_repair_executions`: Nhật ký bất biến (append-only) cho từng lượt DRY_RUN / APPLY / COMPENSATE.
 */
export class CreateReconciliationTables1763300000000 implements MigrationInterface {
  public readonly name = 'CreateReconciliationTables1763300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_jobs (
        id ${pkDef},
        job_code VARCHAR(64) NOT NULL,
        name VARCHAR(160) NOT NULL,
        description VARCHAR(500) NULL,
        adapter_code VARCHAR(64) NOT NULL,
        target_module VARCHAR(64) NOT NULL,
        schedule_cron VARCHAR(64) NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        default_assignee_user_id BIGINT NULL,
        matching_rules_json TEXT NULL,
        config_json TEXT NULL,
        last_run_id BIGINT NULL,
        last_run_at TIMESTAMP NULL,
        next_run_at TIMESTAMP NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_runs (
        id ${pkDef},
        run_code VARCHAR(64) NOT NULL,
        job_id BIGINT NOT NULL,
        job_code VARCHAR(64) NOT NULL,
        adapter_code VARCHAR(64) NOT NULL,
        target_module VARCHAR(64) NOT NULL,
        trigger_mode VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
        status SMALLINT NOT NULL DEFAULT 1,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        total_internal_count INT NOT NULL DEFAULT 0,
        total_external_count INT NOT NULL DEFAULT 0,
        matched_count INT NOT NULL DEFAULT 0,
        discrepancy_count INT NOT NULL DEFAULT 0,
        missing_internal_count INT NOT NULL DEFAULT 0,
        missing_external_count INT NOT NULL DEFAULT 0,
        duplicate_count INT NOT NULL DEFAULT 0,
        status_mismatch_count INT NOT NULL DEFAULT 0,
        amount_mismatch_count INT NOT NULL DEFAULT 0,
        data_mismatch_count INT NOT NULL DEFAULT 0,
        internal_total_amount BIGINT NOT NULL DEFAULT 0,
        external_total_amount BIGINT NOT NULL DEFAULT 0,
        amount_diff_total BIGINT NOT NULL DEFAULT 0,
        currency VARCHAR(12) NULL,
        correlation_id VARCHAR(120) NULL,
        idempotency_key VARCHAR(200) NULL,
        summary_json TEXT NULL,
        error_message VARCHAR(1000) NULL,
        triggered_by BIGINT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
        id ${pkDef},
        discrepancy_code VARCHAR(64) NOT NULL,
        run_id BIGINT NOT NULL,
        job_id BIGINT NOT NULL,
        target_module VARCHAR(64) NOT NULL,
        entity_type VARCHAR(80) NULL,
        entity_id VARCHAR(128) NULL,
        record_key VARCHAR(180) NOT NULL,
        discrepancy_type SMALLINT NOT NULL,
        severity SMALLINT NOT NULL DEFAULT 2,
        status SMALLINT NOT NULL DEFAULT 1,
        assignee_user_id BIGINT NULL,
        internal_status VARCHAR(64) NULL,
        external_status VARCHAR(64) NULL,
        internal_amount BIGINT NULL,
        external_amount BIGINT NULL,
        amount_diff BIGINT NULL,
        currency VARCHAR(12) NULL,
        internal_snapshot_json TEXT NULL,
        external_snapshot_json TEXT NULL,
        diff_fields_json TEXT NULL,
        resolution_note VARCHAR(500) NULL,
        resolved_by BIGINT NULL,
        resolved_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_repair_requests (
        id ${pkDef},
        repair_code VARCHAR(64) NOT NULL,
        discrepancy_id BIGINT NULL,
        parent_repair_id BIGINT NULL,
        action_mode VARCHAR(32) NOT NULL DEFAULT 'DIRECT_REPAIR',
        handler_code VARCHAR(80) NOT NULL,
        target_module VARCHAR(64) NOT NULL,
        target_entity_type VARCHAR(80) NOT NULL,
        target_entity_id VARCHAR(128) NOT NULL,
        is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
        sensitivity_reasons_json TEXT NULL,
        can_rollback BOOLEAN NOT NULL DEFAULT TRUE,
        status SMALLINT NOT NULL DEFAULT 1,
        reason VARCHAR(500) NOT NULL,
        payload_json TEXT NULL,
        dry_run_preview_json TEXT NULL,
        before_snapshot_json TEXT NULL,
        after_snapshot_json TEXT NULL,
        field_diffs_json TEXT NULL,
        compensation_type VARCHAR(64) NULL,
        compensation_details_json TEXT NULL,
        requested_by BIGINT NULL,
        approved_by BIGINT NULL,
        approved_at TIMESTAMP NULL,
        rejected_by BIGINT NULL,
        rejected_at TIMESTAMP NULL,
        approval_note VARCHAR(500) NULL,
        executed_by BIGINT NULL,
        executed_at TIMESTAMP NULL,
        error_message VARCHAR(1000) NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_repair_executions (
        id ${pkDef},
        repair_request_id BIGINT NOT NULL,
        repair_code VARCHAR(64) NOT NULL,
        execution_mode VARCHAR(24) NOT NULL,
        execution_status VARCHAR(24) NOT NULL,
        affected_count INT NOT NULL DEFAULT 0,
        actor_user_id BIGINT NULL,
        summary VARCHAR(500) NULL,
        before_data_json TEXT NULL,
        after_data_json TEXT NULL,
        diff_json TEXT NULL,
        error_message VARCHAR(1000) NULL,
        duration_ms INT NOT NULL DEFAULT 0,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_recon_jobs_code ON reconciliation_jobs (job_code)',
      'CREATE INDEX IDX_recon_jobs_enabled_next ON reconciliation_jobs (is_enabled, next_run_at, deleted_at)',
      'CREATE INDEX IDX_recon_jobs_adapter ON reconciliation_jobs (adapter_code, target_module)',
      'CREATE UNIQUE INDEX UQ_recon_runs_code ON reconciliation_runs (run_code)',
      'CREATE INDEX IDX_recon_runs_job_created ON reconciliation_runs (job_id, created_at)',
      'CREATE INDEX IDX_recon_runs_status_time ON reconciliation_runs (status, started_at)',
      'CREATE UNIQUE INDEX UQ_recon_disc_code ON reconciliation_discrepancies (discrepancy_code)',
      'CREATE INDEX IDX_recon_disc_run_type_status ON reconciliation_discrepancies (run_id, discrepancy_type, status)',
      'CREATE INDEX IDX_recon_disc_severity_assignee ON reconciliation_discrepancies (severity, assignee_user_id, status)',
      'CREATE INDEX IDX_recon_disc_record_key ON reconciliation_discrepancies (record_key, job_id)',
      'CREATE UNIQUE INDEX UQ_data_repair_code ON data_repair_requests (repair_code)',
      'CREATE INDEX IDX_data_repair_status_sensitive ON data_repair_requests (status, is_sensitive, created_at)',
      'CREATE INDEX IDX_data_repair_discrepancy ON data_repair_requests (discrepancy_id)',
      'CREATE INDEX IDX_data_repair_parent ON data_repair_requests (parent_repair_id)',
      'CREATE INDEX IDX_data_repair_exec_req ON data_repair_executions (repair_request_id, executed_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS data_repair_executions');
    await queryRunner.query('DROP TABLE IF EXISTS data_repair_requests');
    await queryRunner.query('DROP TABLE IF EXISTS reconciliation_discrepancies');
    await queryRunner.query('DROP TABLE IF EXISTS reconciliation_runs');
    await queryRunner.query('DROP TABLE IF EXISTS reconciliation_jobs');
  }
}
