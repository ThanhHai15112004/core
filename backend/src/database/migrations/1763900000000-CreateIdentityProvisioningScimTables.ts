import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateIdentityProvisioningScimTables (2026-11-26)
 * Triển khai Section 14.3 — Enterprise SCIM 2.0 Provisioning (`identity-provisioning`):
 * - `scim_clients`: Cấu hình SCIM Client (Bearer token hash, IP allowlist, chế độ deprovision, group->role allowlist/mapping).
 * - `scim_user_links`: Ánh xạ `(client_id, external_id)` <-> `user_id`, quản lý `scim_version` (ETag) & `payload_fingerprint` chống trùng.
 * - `scim_groups`: Nhóm SCIM theo client (`external_id`, `display_name`, `mapped_role_code`, `scim_version`).
 * - `scim_group_members`: Thành viên nhóm SCIM nội bộ của module.
 * - `scim_sync_logs`: Nhật ký đồng bộ SCIM (request/response tóm tắt đã che dữ liệu nhạy cảm, kết quả & lỗi).
 * - `scim_reconciliation_runs`: Lịch sử đối soát dữ liệu người dùng & nhóm với Identity Provider.
 */
export class CreateIdentityProvisioningScimTables1763900000000 implements MigrationInterface {
  public readonly name = 'CreateIdentityProvisioningScimTables1763900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scim_clients (
        id ${pkDef},
        code VARCHAR(64) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        federated_provider_code VARCHAR(64) NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        token_hash VARCHAR(64) NOT NULL,
        token_prefix VARCHAR(24) NOT NULL,
        allowed_ips_json TEXT NULL,
        scopes_json TEXT NULL,
        deprovision_mode VARCHAR(32) NOT NULL DEFAULT 'LOCK_AND_REVOKE',
        group_role_mappings_json TEXT NULL,
        allowed_role_codes_json TEXT NULL,
        denied_role_codes_json TEXT NULL,
        default_role_codes_json TEXT NULL,
        require_if_match BOOLEAN NOT NULL DEFAULT FALSE,
        last_used_at TIMESTAMP NULL,
        last_used_ip VARCHAR(64) NULL,
        rotated_at TIMESTAMP NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scim_user_links (
        id ${pkDef},
        client_id INT NOT NULL,
        user_id INT NOT NULL,
        external_id VARCHAR(255) NOT NULL,
        scim_username VARCHAR(255) NOT NULL,
        scim_version INT NOT NULL DEFAULT 1,
        payload_fingerprint VARCHAR(64) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        raw_attributes_json TEXT NULL,
        last_synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deprovisioned_at TIMESTAMP NULL,
        deprovision_reason VARCHAR(255) NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scim_groups (
        id ${pkDef},
        client_id INT NOT NULL,
        external_id VARCHAR(255) NULL,
        display_name VARCHAR(255) NOT NULL,
        mapped_role_code VARCHAR(64) NULL,
        scim_version INT NOT NULL DEFAULT 1,
        payload_fingerprint VARCHAR(64) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        last_synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scim_group_members (
        id ${pkDef},
        client_id INT NOT NULL,
        scim_group_id INT NOT NULL,
        user_id INT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scim_sync_logs (
        id ${pkDef},
        client_id INT NULL,
        request_id VARCHAR(128) NULL,
        correlation_id VARCHAR(128) NULL,
        operation VARCHAR(40) NOT NULL,
        resource_type VARCHAR(32) NOT NULL,
        resource_id VARCHAR(128) NULL,
        external_id VARCHAR(255) NULL,
        http_method VARCHAR(12) NOT NULL,
        http_path VARCHAR(500) NOT NULL,
        http_status INT NOT NULL,
        outcome VARCHAR(32) NOT NULL,
        idempotency_hit BOOLEAN NOT NULL DEFAULT FALSE,
        request_summary_json TEXT NULL,
        response_summary_json TEXT NULL,
        error_code VARCHAR(80) NULL,
        error_message VARCHAR(500) NULL,
        ip_address VARCHAR(64) NULL,
        duration_ms INT NOT NULL DEFAULT 0,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scim_reconciliation_runs (
        id ${pkDef},
        client_id INT NOT NULL,
        mode VARCHAR(24) NOT NULL DEFAULT 'DRY_RUN',
        status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
        idp_users_count INT NOT NULL DEFAULT 0,
        local_users_count INT NOT NULL DEFAULT 0,
        idp_groups_count INT NOT NULL DEFAULT 0,
        local_groups_count INT NOT NULL DEFAULT 0,
        discrepancies_count INT NOT NULL DEFAULT 0,
        applied_actions_count INT NOT NULL DEFAULT 0,
        summary_json TEXT NULL,
        discrepancies_json TEXT NULL,
        triggered_by BIGINT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_scim_clients_code ON scim_clients (code)',
      'CREATE UNIQUE INDEX UQ_scim_clients_token_hash ON scim_clients (token_hash)',
      'CREATE INDEX IDX_scim_clients_status ON scim_clients (status, deleted_at)',
      'CREATE UNIQUE INDEX UQ_scim_user_links_client_external ON scim_user_links (client_id, external_id)',
      'CREATE UNIQUE INDEX UQ_scim_user_links_client_user ON scim_user_links (client_id, user_id)',
      'CREATE INDEX IDX_scim_user_links_user ON scim_user_links (user_id)',
      'CREATE UNIQUE INDEX UQ_scim_groups_client_display ON scim_groups (client_id, display_name)',
      'CREATE INDEX IDX_scim_groups_client_external ON scim_groups (client_id, external_id)',
      'CREATE UNIQUE INDEX UQ_scim_group_members_group_user ON scim_group_members (scim_group_id, user_id)',
      'CREATE INDEX IDX_scim_group_members_client_user ON scim_group_members (client_id, user_id)',
      'CREATE INDEX IDX_scim_sync_logs_client_created ON scim_sync_logs (client_id, created_at)',
      'CREATE INDEX IDX_scim_sync_logs_outcome ON scim_sync_logs (outcome, created_at)',
      'CREATE INDEX IDX_scim_sync_logs_external ON scim_sync_logs (external_id)',
      'CREATE INDEX IDX_scim_recon_runs_client_created ON scim_reconciliation_runs (client_id, created_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS scim_reconciliation_runs');
    await queryRunner.query('DROP TABLE IF EXISTS scim_sync_logs');
    await queryRunner.query('DROP TABLE IF EXISTS scim_group_members');
    await queryRunner.query('DROP TABLE IF EXISTS scim_groups');
    await queryRunner.query('DROP TABLE IF EXISTS scim_user_links');
    await queryRunner.query('DROP TABLE IF EXISTS scim_clients');
  }
}
