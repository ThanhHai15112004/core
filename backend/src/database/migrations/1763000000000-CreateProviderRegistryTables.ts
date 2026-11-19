import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateProviderRegistryTables (2026-11-19)
 * Triển khai Phase 10.6 — Quản lý nhà cung cấp (Provider Registry):
 * 1. `provider_registry_entries`: Đăng ký provider theo 5 loại (EMAIL, SMS, PAYMENT, STORAGE, IDENTITY), Primary/Fallback, Pause/Resume, Secret Ref & encrypted secrets tùy chọn, health snapshot.
 * 2. `provider_unit_assignments`: Định tuyến provider chính/dự phòng theo đơn vị (`organization_unit_id`).
 * 3. `provider_health_checks`: Lịch sử kiểm tra sức khỏe (Healthy, Degraded, Down) kèm độ trễ & lỗi.
 * 4. `provider_metric_buckets`: Tổng hợp độ trễ (avg/max/p95) và tỷ lệ lỗi theo cửa sổ thời gian phục vụ Dashboard.
 * 5. `provider_config_histories`: Lịch sử thay đổi cấu hình provider kèm before/after đã redact và ngữ cảnh audit.
 */
export class CreateProviderRegistryTables1763000000000 implements MigrationInterface {
  public readonly name = 'CreateProviderRegistryTables1763000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_registry_entries (
        id ${pkDef},
        provider_code VARCHAR(64) NOT NULL,
        provider_type VARCHAR(24) NOT NULL,
        driver_code VARCHAR(64) NOT NULL,
        display_name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        domain_ref_code VARCHAR(64) NULL,
        http_service_name VARCHAR(80) NULL,
        role VARCHAR(16) NOT NULL DEFAULT 'STANDBY',
        priority INT NOT NULL DEFAULT 100,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        fallback_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        status SMALLINT NOT NULL DEFAULT 1,
        paused_at TIMESTAMP NULL,
        paused_by BIGINT NULL,
        paused_reason VARCHAR(500) NULL,
        secret_ref VARCHAR(160) NULL,
        secrets_encrypted TEXT NULL,
        secret_hint VARCHAR(32) NULL,
        config_json TEXT NULL,
        health_status SMALLINT NOT NULL DEFAULT 0,
        last_health_check_at TIMESTAMP NULL,
        last_health_latency_ms INT NULL,
        last_health_error_code VARCHAR(80) NULL,
        last_health_error_message VARCHAR(500) NULL,
        consecutive_failures INT NOT NULL DEFAULT 0,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_unit_assignments (
        id ${pkDef},
        provider_type VARCHAR(24) NOT NULL,
        organization_unit_id BIGINT NOT NULL,
        primary_provider_id BIGINT NOT NULL,
        fallback_provider_id BIGINT NULL,
        allow_fallback_override BOOLEAN NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        notes VARCHAR(500) NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_health_checks (
        id ${pkDef},
        provider_id BIGINT NOT NULL,
        provider_type VARCHAR(24) NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        health_status SMALLINT NOT NULL,
        latency_ms INT NULL,
        http_status INT NULL,
        error_code VARCHAR(80) NULL,
        error_message VARCHAR(500) NULL,
        check_source VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
        details_json TEXT NULL,
        checked_by BIGINT NULL,
        checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_metric_buckets (
        id ${pkDef},
        provider_id BIGINT NOT NULL,
        provider_type VARCHAR(24) NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        bucket_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        total_count INT NOT NULL DEFAULT 0,
        success_count INT NOT NULL DEFAULT 0,
        error_count INT NOT NULL DEFAULT 0,
        total_latency_ms BIGINT NOT NULL DEFAULT 0,
        min_latency_ms INT NULL,
        max_latency_ms INT NULL,
        p95_latency_ms INT NULL,
        latency_samples_json TEXT NULL,
        last_error_code VARCHAR(80) NULL,
        last_observed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_config_histories (
        id ${pkDef},
        provider_id BIGINT NULL,
        provider_type VARCHAR(24) NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        action VARCHAR(32) NOT NULL,
        before_state_json TEXT NULL,
        after_state_json TEXT NULL,
        changed_fields_json TEXT NULL,
        reason VARCHAR(500) NULL,
        actor_user_id BIGINT NULL,
        actor_identifier VARCHAR(150) NULL,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        request_id VARCHAR(128) NULL,
        correlation_id VARCHAR(128) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_pr_entries_type_code ON provider_registry_entries (provider_type, provider_code)',
      'CREATE INDEX IDX_pr_entries_type_primary ON provider_registry_entries (provider_type, is_primary, status, deleted_at)',
      'CREATE INDEX IDX_pr_entries_health ON provider_registry_entries (provider_type, health_status, status, deleted_at)',
      'CREATE UNIQUE INDEX UQ_pr_unit_type_org ON provider_unit_assignments (provider_type, organization_unit_id)',
      'CREATE INDEX IDX_pr_unit_primary ON provider_unit_assignments (primary_provider_id)',
      'CREATE INDEX IDX_pr_unit_fallback ON provider_unit_assignments (fallback_provider_id)',
      'CREATE INDEX IDX_pr_health_provider_time ON provider_health_checks (provider_id, checked_at)',
      'CREATE INDEX IDX_pr_health_type_status_time ON provider_health_checks (provider_type, health_status, checked_at)',
      'CREATE UNIQUE INDEX UQ_pr_metric_provider_bucket ON provider_metric_buckets (provider_id, bucket_start)',
      'CREATE INDEX IDX_pr_metric_type_bucket ON provider_metric_buckets (provider_type, bucket_start)',
      'CREATE INDEX IDX_pr_history_provider_time ON provider_config_histories (provider_id, created_at)',
      'CREATE INDEX IDX_pr_history_action_time ON provider_config_histories (action, created_at)',
      'CREATE INDEX IDX_pr_history_type_time ON provider_config_histories (provider_type, created_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS provider_config_histories');
    await queryRunner.query('DROP TABLE IF EXISTS provider_metric_buckets');
    await queryRunner.query('DROP TABLE IF EXISTS provider_health_checks');
    await queryRunner.query('DROP TABLE IF EXISTS provider_unit_assignments');
    await queryRunner.query('DROP TABLE IF EXISTS provider_registry_entries');
  }
}
