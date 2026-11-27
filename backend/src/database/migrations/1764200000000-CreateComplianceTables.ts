import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateComplianceTables (2026-11-27)
 * Triển khai Section 14.6 — Compliance và Quản lý nhà cung cấp:
 * - `compliance_controls`: Yêu cầu kiểm soát, người phụ trách, tần suất và framework tags trung lập.
 * - `compliance_check_histories`: Lịch sử kiểm tra control (người kiểm tra, kết quả, điểm, phát hiện & khắc phục).
 * - `compliance_evidences`: Bằng chứng thực hiện kiểm soát (File, Log, Report hoặc Link) kèm thời hạn hiệu lực.
 * - `compliance_vendors`: Danh sách nhà cung cấp (Email, SMS, Cloud, Payment, AI, Other), hợp đồng, chu kỳ rà soát & phương án dự phòng/thay thế.
 * - `compliance_vendor_data_assessments`: Đánh giá phạm vi dữ liệu nhà cung cấp được phép xử lý, luồng dữ liệu, vùng lưu trữ & mức độ rủi ro.
 */
export class CreateComplianceTables1764200000000 implements MigrationInterface {
  public readonly name = 'CreateComplianceTables1764200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS compliance_controls (
        id ${pkDef},
        control_code VARCHAR(64) NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NULL,
        domain VARCHAR(64) NOT NULL DEFAULT 'GENERAL',
        framework_tags_json TEXT NULL,
        owner_user_id INT NULL,
        organization_unit_id INT NULL,
        frequency VARCHAR(24) NOT NULL DEFAULT 'QUARTERLY',
        status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
        last_checked_at TIMESTAMP NULL,
        next_check_due_at TIMESTAMP NULL,
        last_check_result VARCHAR(24) NULL,
        metadata_json TEXT NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS compliance_check_histories (
        id ${pkDef},
        control_id INT NOT NULL,
        checked_by_user_id INT NOT NULL,
        checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        result VARCHAR(24) NOT NULL,
        score SMALLINT NULL,
        findings TEXT NULL,
        remediation_plan TEXT NULL,
        remediation_due_at TIMESTAMP NULL,
        evidence_ids_json TEXT NULL,
        metadata_json TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS compliance_evidences (
        id ${pkDef},
        control_id INT NOT NULL,
        check_history_id INT NULL,
        vendor_id INT NULL,
        evidence_type VARCHAR(24) NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NULL,
        file_id INT NULL,
        audit_log_id INT NULL,
        log_reference VARCHAR(255) NULL,
        report_history_id INT NULL,
        report_code VARCHAR(128) NULL,
        external_url VARCHAR(500) NULL,
        checksum_sha256 VARCHAR(128) NULL,
        collected_by_user_id INT NOT NULL,
        collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        valid_until TIMESTAMP NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'VALID',
        metadata_json TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS compliance_vendors (
        id ${pkDef},
        vendor_code VARCHAR(64) NOT NULL,
        name VARCHAR(160) NOT NULL,
        category VARCHAR(24) NOT NULL,
        criticality VARCHAR(24) NOT NULL DEFAULT 'MEDIUM',
        status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
        provider_entry_id INT NULL,
        website_url VARCHAR(255) NULL,
        contact_email VARCHAR(160) NULL,
        owner_user_id INT NULL,
        organization_unit_id INT NULL,
        contract_start_date TIMESTAMP NULL,
        contract_end_date TIMESTAMP NULL,
        auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
        review_frequency VARCHAR(24) NOT NULL DEFAULT 'SEMI_ANNUAL',
        last_reviewed_at TIMESTAMP NULL,
        next_review_due_at TIMESTAMP NULL,
        dpa_signed BOOLEAN NOT NULL DEFAULT FALSE,
        dpa_file_id INT NULL,
        fallback_vendor_name VARCHAR(160) NULL,
        fallback_strategy TEXT NULL,
        migration_runbook TEXT NULL,
        rto_hours INT NULL,
        exit_plan_tested_at TIMESTAMP NULL,
        metadata_json TEXT NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS compliance_vendor_data_assessments (
        id ${pkDef},
        vendor_id INT NOT NULL,
        data_category VARCHAR(120) NOT NULL,
        classification_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL',
        allowed_data_fields_json TEXT NULL,
        prohibited_data_fields_json TEXT NULL,
        processing_purpose VARCHAR(500) NOT NULL,
        data_flow_direction VARCHAR(24) NOT NULL DEFAULT 'OUTBOUND',
        storage_regions_json TEXT NULL,
        cross_border_transfer BOOLEAN NOT NULL DEFAULT FALSE,
        transfer_mechanism VARCHAR(160) NULL,
        retention_days INT NULL,
        encryption_in_transit BOOLEAN NOT NULL DEFAULT TRUE,
        encryption_at_rest BOOLEAN NOT NULL DEFAULT TRUE,
        subprocessors_json TEXT NULL,
        risk_level VARCHAR(24) NOT NULL DEFAULT 'MEDIUM',
        approval_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
        reviewed_by_user_id INT NULL,
        reviewed_at TIMESTAMP NULL,
        next_review_due_at TIMESTAMP NULL,
        notes TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX idx_comp_controls_code ON compliance_controls (control_code)',
      'CREATE INDEX idx_comp_controls_status_due ON compliance_controls (status, next_check_due_at)',
      'CREATE INDEX idx_comp_controls_owner_status ON compliance_controls (owner_user_id, status)',
      'CREATE INDEX idx_comp_controls_domain ON compliance_controls (domain, status)',
      'CREATE INDEX idx_comp_checks_control_at ON compliance_check_histories (control_id, checked_at)',
      'CREATE INDEX idx_comp_checks_result ON compliance_check_histories (result, checked_at)',
      'CREATE INDEX idx_comp_evidences_control_type ON compliance_evidences (control_id, evidence_type, status)',
      'CREATE INDEX idx_comp_evidences_vendor_status ON compliance_evidences (vendor_id, status)',
      'CREATE INDEX idx_comp_evidences_valid_until ON compliance_evidences (status, valid_until)',
      'CREATE UNIQUE INDEX idx_comp_vendors_code ON compliance_vendors (vendor_code)',
      'CREATE INDEX idx_comp_vendors_cat_status ON compliance_vendors (category, status)',
      'CREATE INDEX idx_comp_vendors_contract_end ON compliance_vendors (status, contract_end_date)',
      'CREATE INDEX idx_comp_vendors_review_due ON compliance_vendors (status, next_review_due_at)',
      'CREATE INDEX idx_comp_vda_vendor_status ON compliance_vendor_data_assessments (vendor_id, approval_status, risk_level)',
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
    await queryRunner.query('DROP TABLE IF EXISTS compliance_vendor_data_assessments');
    await queryRunner.query('DROP TABLE IF EXISTS compliance_vendors');
    await queryRunner.query('DROP TABLE IF EXISTS compliance_evidences');
    await queryRunner.query('DROP TABLE IF EXISTS compliance_check_histories');
    await queryRunner.query('DROP TABLE IF EXISTS compliance_controls');
  }
}
