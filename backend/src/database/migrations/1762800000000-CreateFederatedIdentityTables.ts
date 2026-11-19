import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateFederatedIdentityTables (2026-11-19)
 * Triển khai Phase 10.4 — Federated Identity / OAuth Login (`federated-identity`):
 * 1. `federated_identity_providers`: Cấu hình nhà cung cấp OAuth/OIDC (Google, Microsoft...), secret mã hóa AES-256-GCM và override chính sách liên kết/đăng ký.
 * 2. `federated_identities`: Liên kết tài khoản ngoài với người dùng theo mã định danh ổn định `(provider_code, issuer_url, provider_subject)` (không dựa vào email).
 * 3. `federated_auth_transactions`: Lưu giao dịch ngắn hạn `state` / `nonce` / `PKCE code_verifier` (single-use atomic consume, chống giả mạo & replay).
 * 4. `federated_auth_events`: Nhật ký kiểm soát lỗi và độ trễ từ nhà cung cấp phục vụ Monitoring & Diagnostics (đã redact dữ liệu nhạy cảm).
 */
export class CreateFederatedIdentityTables1762800000000 implements MigrationInterface {
  public readonly name = 'CreateFederatedIdentityTables1762800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS federated_identity_providers (
        id ${pkDef},
        provider_code VARCHAR(64) NOT NULL,
        driver_code VARCHAR(64) NOT NULL,
        display_name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        status SMALLINT NOT NULL DEFAULT 2,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        client_id VARCHAR(255) NULL,
        client_secret_encrypted TEXT NULL,
        client_secret_hint VARCHAR(32) NULL,
        tenant_id VARCHAR(120) NULL,
        issuer_url VARCHAR(255) NULL,
        authorization_endpoint VARCHAR(500) NULL,
        token_endpoint VARCHAR(500) NULL,
        jwks_uri VARCHAR(500) NULL,
        userinfo_endpoint VARCHAR(500) NULL,
        scopes_json TEXT NULL,
        allowed_redirect_uris_json TEXT NULL,
        allow_auto_register_override BOOLEAN NULL,
        auto_link_verified_email_override BOOLEAN NULL,
        extra_config_json TEXT NULL,
        last_success_at TIMESTAMP NULL,
        last_error_at TIMESTAMP NULL,
        last_error_code VARCHAR(80) NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS federated_identities (
        id ${pkDef},
        user_id BIGINT NOT NULL,
        provider_id BIGINT NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        issuer_url VARCHAR(255) NOT NULL,
        provider_subject VARCHAR(255) NOT NULL,
        provider_tenant_id VARCHAR(120) NULL,
        email_at_provider VARCHAR(255) NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        display_name VARCHAR(255) NULL,
        avatar_url VARCHAR(1000) NULL,
        profile_metadata_json TEXT NULL,
        linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        linked_by BIGINT NULL,
        last_login_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS federated_auth_transactions (
        id ${pkDef},
        state_hash VARCHAR(64) NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        flow_type VARCHAR(16) NOT NULL,
        user_id BIGINT NULL,
        nonce_hash VARCHAR(64) NOT NULL,
        code_verifier_encrypted TEXT NOT NULL,
        redirect_uri VARCHAR(1000) NOT NULL,
        device_name VARCHAR(255) NULL,
        ip_address_masked VARCHAR(64) NULL,
        user_agent VARCHAR(500) NULL,
        expires_at TIMESTAMP NOT NULL,
        consumed_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS federated_auth_events (
        id ${pkDef},
        event_uid VARCHAR(64) NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        flow_type VARCHAR(16) NOT NULL,
        stage VARCHAR(40) NOT NULL,
        outcome VARCHAR(16) NOT NULL,
        error_code VARCHAR(80) NULL,
        provider_error VARCHAR(120) NULL,
        error_message VARCHAR(1000) NULL,
        http_status SMALLINT NULL,
        duration_ms INT NOT NULL DEFAULT 0,
        user_id BIGINT NULL,
        identity_id BIGINT NULL,
        request_id VARCHAR(120) NULL,
        correlation_id VARCHAR(120) NULL,
        source_ip_masked VARCHAR(64) NULL,
        metadata_redacted_json TEXT NULL,
        occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_fed_providers_code ON federated_identity_providers (provider_code)',
      'CREATE INDEX IDX_fed_providers_enabled ON federated_identity_providers (is_enabled, status, deleted_at)',
      'CREATE UNIQUE INDEX UQ_fed_identities_subject ON federated_identities (provider_code, issuer_url, provider_subject)',
      'CREATE INDEX IDX_fed_identities_user ON federated_identities (user_id, provider_code)',
      'CREATE UNIQUE INDEX UQ_fed_tx_state_hash ON federated_auth_transactions (state_hash)',
      'CREATE INDEX IDX_fed_tx_expires ON federated_auth_transactions (expires_at, consumed_at)',
      'CREATE UNIQUE INDEX UQ_fed_events_uid ON federated_auth_events (event_uid)',
      'CREATE INDEX IDX_fed_events_provider_outcome_time ON federated_auth_events (provider_code, outcome, occurred_at)',
      'CREATE INDEX IDX_fed_events_stage_error ON federated_auth_events (stage, error_code, occurred_at)',
      'CREATE INDEX IDX_fed_events_user_time ON federated_auth_events (user_id, occurred_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS federated_auth_events');
    await queryRunner.query('DROP TABLE IF EXISTS federated_auth_transactions');
    await queryRunner.query('DROP TABLE IF EXISTS federated_identities');
    await queryRunner.query('DROP TABLE IF EXISTS federated_identity_providers');
  }
}
