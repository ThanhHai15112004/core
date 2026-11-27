import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreatePrivilegedAccessTables (2026-11-27)
 * Triển khai Section 14.4 — Quyền quản trị đặc biệt (Privileged Access Management — PAM):
 * - `privileged_access_targets`: Đánh dấu vai trò (ROLE) và quyền (PERMISSION) đặc biệt kèm chính sách MFA Step-Up, phê duyệt, thời hạn tối đa, cảnh báo và chu kỳ rà soát.
 * - `privileged_access_grants`: Cấp quyền tạm thời (JIT) có thời hạn, lý do, trạng thái phê duyệt và tự động thu hồi khi hết hạn.
 * - `privileged_break_glass_accounts`: Tài khoản khẩn cấp Break-glass (hỗ trợ liên kết user admin sẵn có hoặc tạo mới), niêm phong/kích hoạt khẩn cấp và tự khóa khi hết hạn.
 * - `privileged_usage_alerts`: Cảnh báo khi sử dụng quyền đặc biệt / Break-glass gửi người phụ trách bảo mật.
 * - `privileged_access_reviews` & `privileged_access_review_items`: Đợt rà soát quyền đặc biệt định kỳ (Giữ hoặc Thu hồi).
 */
export class CreatePrivilegedAccessTables1764000000000 implements MigrationInterface {
  public readonly name = 'CreatePrivilegedAccessTables1764000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS privileged_access_targets (
        id ${pkDef},
        target_type VARCHAR(24) NOT NULL,
        target_code VARCHAR(128) NOT NULL,
        display_name VARCHAR(160) NOT NULL,
        description VARCHAR(500) NULL,
        sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'HIGH',
        require_mfa_step_up BOOLEAN NOT NULL DEFAULT TRUE,
        require_approval BOOLEAN NOT NULL DEFAULT TRUE,
        auto_approve_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        max_grant_minutes INT NOT NULL DEFAULT 120,
        alert_on_use BOOLEAN NOT NULL DEFAULT TRUE,
        review_interval_days INT NOT NULL DEFAULT 90,
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
      CREATE TABLE IF NOT EXISTS privileged_access_grants (
        id ${pkDef},
        grant_code VARCHAR(64) NOT NULL,
        user_id INT NOT NULL,
        target_type VARCHAR(24) NOT NULL,
        target_code VARCHAR(128) NOT NULL,
        role_id INT NULL,
        reason VARCHAR(1000) NOT NULL,
        ticket_ref VARCHAR(120) NULL,
        duration_minutes INT NOT NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
        requested_by INT NOT NULL,
        requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved_by INT NULL,
        approved_at TIMESTAMP NULL,
        approval_comment VARCHAR(500) NULL,
        starts_at TIMESTAMP NULL,
        expires_at TIMESTAMP NULL,
        revoked_by INT NULL,
        revoked_at TIMESTAMP NULL,
        revoke_reason VARCHAR(500) NULL,
        auto_revoked BOOLEAN NOT NULL DEFAULT FALSE,
        step_up_verified BOOLEAN NOT NULL DEFAULT FALSE,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS privileged_break_glass_accounts (
        id ${pkDef},
        code VARCHAR(64) NOT NULL,
        user_id INT NOT NULL,
        label VARCHAR(160) NOT NULL,
        description VARCHAR(500) NULL,
        role_code VARCHAR(64) NOT NULL DEFAULT 'super_admin',
        status SMALLINT NOT NULL DEFAULT 1,
        require_mfa BOOLEAN NOT NULL DEFAULT TRUE,
        max_activation_minutes INT NOT NULL DEFAULT 60,
        alert_recipients_json TEXT NULL,
        last_activated_by INT NULL,
        last_activation_reason VARCHAR(1000) NULL,
        last_ticket_ref VARCHAR(120) NULL,
        activated_at TIMESTAMP NULL,
        expires_at TIMESTAMP NULL,
        sealed_by INT NULL,
        sealed_at TIMESTAMP NULL,
        seal_reason VARCHAR(500) NULL,
        activation_count INT NOT NULL DEFAULT 0,
        last_used_at TIMESTAMP NULL,
        last_used_ip VARCHAR(64) NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS privileged_usage_alerts (
        id ${pkDef},
        event_type VARCHAR(64) NOT NULL,
        severity VARCHAR(16) NOT NULL DEFAULT 'HIGH',
        actor_user_id INT NULL,
        actor_username VARCHAR(128) NULL,
        target_type VARCHAR(24) NULL,
        target_code VARCHAR(128) NULL,
        action VARCHAR(160) NOT NULL,
        endpoint VARCHAR(255) NULL,
        http_method VARCHAR(16) NULL,
        ip_address VARCHAR(64) NULL,
        details_json TEXT NULL,
        notified_recipients_json TEXT NULL,
        notification_dispatch_id INT NULL,
        incident_id INT NULL,
        acknowledged_by INT NULL,
        acknowledged_at TIMESTAMP NULL,
        acknowledge_note VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS privileged_access_reviews (
        id ${pkDef},
        review_code VARCHAR(64) NOT NULL,
        title VARCHAR(200) NOT NULL,
        description VARCHAR(500) NULL,
        trigger_source VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
        status SMALLINT NOT NULL DEFAULT 1,
        due_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP NULL,
        total_items INT NOT NULL DEFAULT 0,
        decided_items INT NOT NULL DEFAULT 0,
        kept_items INT NOT NULL DEFAULT 0,
        revoked_items INT NOT NULL DEFAULT 0,
        created_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS privileged_access_review_items (
        id ${pkDef},
        review_id INT NOT NULL,
        user_id INT NOT NULL,
        username VARCHAR(128) NOT NULL,
        email VARCHAR(255) NULL,
        grant_source VARCHAR(32) NOT NULL,
        target_type VARCHAR(24) NOT NULL,
        target_code VARCHAR(128) NOT NULL,
        role_id INT NULL,
        grant_id INT NULL,
        break_glass_id INT NULL,
        decision SMALLINT NOT NULL DEFAULT 1,
        decided_by INT NULL,
        decided_at TIMESTAMP NULL,
        decision_note VARCHAR(500) NULL,
        enforcement_applied BOOLEAN NOT NULL DEFAULT FALSE,
        enforcement_error VARCHAR(500) NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX idx_pam_targets_type_code ON privileged_access_targets (target_type, target_code)',
      'CREATE INDEX idx_pam_targets_enabled ON privileged_access_targets (is_enabled, target_type)',
      'CREATE UNIQUE INDEX idx_pam_grants_code ON privileged_access_grants (grant_code)',
      'CREATE INDEX idx_pam_grants_user_status ON privileged_access_grants (user_id, status)',
      'CREATE INDEX idx_pam_grants_status_expires ON privileged_access_grants (status, expires_at)',
      'CREATE INDEX idx_pam_grants_target ON privileged_access_grants (target_type, target_code)',
      'CREATE UNIQUE INDEX idx_pam_break_glass_code ON privileged_break_glass_accounts (code)',
      'CREATE UNIQUE INDEX idx_pam_break_glass_user ON privileged_break_glass_accounts (user_id)',
      'CREATE INDEX idx_pam_break_glass_status_exp ON privileged_break_glass_accounts (status, expires_at)',
      'CREATE INDEX idx_pam_alerts_event_created ON privileged_usage_alerts (event_type, created_at)',
      'CREATE INDEX idx_pam_alerts_actor_created ON privileged_usage_alerts (actor_user_id, created_at)',
      'CREATE INDEX idx_pam_alerts_severity_ack ON privileged_usage_alerts (severity, acknowledged_at)',
      'CREATE UNIQUE INDEX idx_pam_reviews_code ON privileged_access_reviews (review_code)',
      'CREATE INDEX idx_pam_reviews_status_due ON privileged_access_reviews (status, due_at)',
      'CREATE INDEX idx_pam_review_items_review_dec ON privileged_access_review_items (review_id, decision)',
      'CREATE INDEX idx_pam_review_items_user_target ON privileged_access_review_items (user_id, target_code)',
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
    await queryRunner.query('DROP TABLE IF EXISTS privileged_access_review_items');
    await queryRunner.query('DROP TABLE IF EXISTS privileged_access_reviews');
    await queryRunner.query('DROP TABLE IF EXISTS privileged_usage_alerts');
    await queryRunner.query('DROP TABLE IF EXISTS privileged_break_glass_accounts');
    await queryRunner.query('DROP TABLE IF EXISTS privileged_access_grants');
    await queryRunner.query('DROP TABLE IF EXISTS privileged_access_targets');
  }
}
