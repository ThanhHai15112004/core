import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateDataGovernanceTables (2026-11-27)
 * Triển khai Section 14.5 — Quyền riêng tư và Quản trị dữ liệu (Data Privacy & Governance):
 * - `data_classifications`: Phân loại dữ liệu (PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED) và thiết lập thời gian lưu dữ liệu (Retention) theo loại dữ liệu.
 * - `data_sensitive_fields`: Đánh dấu trường dữ liệu nhạy cảm dùng cho Log, Export và Phân quyền.
 * - `privacy_dsar_requests`: Yêu cầu Xem (ACCESS), Xuất máy đọc được (EXPORT) và Xóa dữ liệu cá nhân có ngoại lệ & phê duyệt (ERASURE).
 * - `privacy_consent_definitions` & `privacy_user_consents`: Quản lý sự đồng ý của người dùng theo mục đích, phiên bản và thời gian.
 * - `data_legal_holds`: Tạm giữ dữ liệu pháp lý không được xóa (Legal Hold) theo người dùng, loại dữ liệu hoặc bản ghi cụ thể.
 */
export class CreateDataGovernanceTables1764100000000 implements MigrationInterface {
  public readonly name = 'CreateDataGovernanceTables1764100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_classifications (
        id ${pkDef},
        data_type_code VARCHAR(96) NOT NULL,
        display_name VARCHAR(160) NOT NULL,
        module_name VARCHAR(64) NOT NULL,
        classification_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL',
        contains_pii BOOLEAN NOT NULL DEFAULT FALSE,
        retention_days INT NOT NULL DEFAULT 365,
        retention_action VARCHAR(24) NOT NULL DEFAULT 'PURGE',
        legal_basis VARCHAR(160) NULL,
        description VARCHAR(500) NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        last_enforced_at TIMESTAMP NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_sensitive_fields (
        id ${pkDef},
        resource_type VARCHAR(96) NOT NULL,
        field_path VARCHAR(128) NOT NULL,
        display_name VARCHAR(160) NOT NULL,
        classification_level VARCHAR(24) NOT NULL DEFAULT 'CONFIDENTIAL',
        mask_strategy VARCHAR(24) NOT NULL DEFAULT 'FULL',
        redact_in_log BOOLEAN NOT NULL DEFAULT TRUE,
        mask_in_export BOOLEAN NOT NULL DEFAULT TRUE,
        required_permission VARCHAR(128) NULL,
        description VARCHAR(500) NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS privacy_dsar_requests (
        id ${pkDef},
        request_code VARCHAR(64) NOT NULL,
        request_type VARCHAR(24) NOT NULL,
        subject_user_id INT NOT NULL,
        requested_by INT NOT NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        export_format VARCHAR(16) NULL,
        reason VARCHAR(1000) NULL,
        requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
        approved_by INT NULL,
        approved_at TIMESTAMP NULL,
        decision_comment VARCHAR(500) NULL,
        exceptions_json TEXT NULL,
        summary_json TEXT NULL,
        export_token VARCHAR(128) NULL,
        export_expires_at TIMESTAMP NULL,
        due_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS privacy_consent_definitions (
        id ${pkDef},
        purpose_code VARCHAR(64) NOT NULL,
        policy_version VARCHAR(32) NOT NULL,
        title VARCHAR(200) NOT NULL,
        description VARCHAR(1000) NOT NULL,
        classification_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL',
        is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
        validity_days INT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS privacy_user_consents (
        id ${pkDef},
        user_id INT NOT NULL,
        purpose_code VARCHAR(64) NOT NULL,
        policy_version VARCHAR(32) NOT NULL,
        consent_status VARCHAR(24) NOT NULL DEFAULT 'GRANTED',
        granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        withdrawn_at TIMESTAMP NULL,
        withdraw_reason VARCHAR(500) NULL,
        expires_at TIMESTAMP NULL,
        collection_source VARCHAR(64) NOT NULL DEFAULT 'PORTAL',
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        metadata_json TEXT NULL,
        recorded_by INT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_legal_holds (
        id ${pkDef},
        hold_code VARCHAR(64) NOT NULL,
        title VARCHAR(200) NOT NULL,
        case_reference VARCHAR(120) NULL,
        reason VARCHAR(1000) NOT NULL,
        scope_type VARCHAR(24) NOT NULL,
        target_user_id INT NULL,
        data_type_code VARCHAR(96) NULL,
        resource_type VARCHAR(96) NULL,
        resource_id VARCHAR(128) NULL,
        hold_status SMALLINT NOT NULL DEFAULT 1,
        starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NULL,
        created_by INT NOT NULL,
        released_by INT NULL,
        released_at TIMESTAMP NULL,
        release_reason VARCHAR(500) NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX idx_dg_classifications_code ON data_classifications (data_type_code)',
      'CREATE INDEX idx_dg_classifications_level_mod ON data_classifications (classification_level, module_name)',
      'CREATE INDEX idx_dg_classifications_enabled_ret ON data_classifications (is_enabled, retention_days)',
      'CREATE UNIQUE INDEX idx_dg_sensitive_fields_res_path ON data_sensitive_fields (resource_type, field_path)',
      'CREATE INDEX idx_dg_sensitive_fields_enabled ON data_sensitive_fields (is_enabled, resource_type)',
      'CREATE UNIQUE INDEX idx_dg_dsar_code ON privacy_dsar_requests (request_code)',
      'CREATE INDEX idx_dg_dsar_subject_type ON privacy_dsar_requests (subject_user_id, request_type)',
      'CREATE INDEX idx_dg_dsar_status_due ON privacy_dsar_requests (status, due_at)',
      'CREATE UNIQUE INDEX idx_dg_consent_def_purpose_ver ON privacy_consent_definitions (purpose_code, policy_version)',
      'CREATE INDEX idx_dg_consent_def_active ON privacy_consent_definitions (is_active, purpose_code)',
      'CREATE INDEX idx_dg_user_consents_user_purpose ON privacy_user_consents (user_id, purpose_code, policy_version)',
      'CREATE INDEX idx_dg_user_consents_status_exp ON privacy_user_consents (consent_status, expires_at)',
      'CREATE UNIQUE INDEX idx_dg_legal_holds_code ON data_legal_holds (hold_code)',
      'CREATE INDEX idx_dg_legal_holds_status_scope ON data_legal_holds (hold_status, scope_type)',
      'CREATE INDEX idx_dg_legal_holds_user ON data_legal_holds (target_user_id, hold_status)',
      'CREATE INDEX idx_dg_legal_holds_resource ON data_legal_holds (resource_type, resource_id, hold_status)',
      'CREATE INDEX idx_dg_legal_holds_datatype ON data_legal_holds (data_type_code, hold_status)',
    ];

    for (const sql of indexes) {
      try {
        await queryRunner.query(sql);
      } catch {
        // Ignore duplicate index errors across idempotent re-runs
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS data_legal_holds');
    await queryRunner.query('DROP TABLE IF EXISTS privacy_user_consents');
    await queryRunner.query('DROP TABLE IF EXISTS privacy_consent_definitions');
    await queryRunner.query('DROP TABLE IF EXISTS privacy_dsar_requests');
    await queryRunner.query('DROP TABLE IF EXISTS data_sensitive_fields');
    await queryRunner.query('DROP TABLE IF EXISTS data_classifications');
  }
}
