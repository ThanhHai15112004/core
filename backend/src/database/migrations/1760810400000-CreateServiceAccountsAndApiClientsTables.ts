import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateServiceAccountsAndApiClientsTables (2026-10-18)
 * Khởi tạo bảng cơ sở dữ liệu cho Mục 3.6 — Tài khoản hệ thống (Service Account) và API Client:
 * - auth_service_accounts (tài khoản hệ thống/job, không gắn người dùng cá nhân)
 * - auth_api_clients (Client ID, Client Secret SHA-256, Scopes, IP Whitelist/CIDR, Token Version, Usage Tracking)
 */
export class CreateServiceAccountsAndApiClientsTables1760810400000 implements MigrationInterface {
  public readonly name = 'CreateServiceAccountsAndApiClientsTables1760810400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_service_accounts (
        id ${pkDef},
        code VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        description TEXT NULL,
        status INT NOT NULL DEFAULT 1,
        scopes_json TEXT NOT NULL,
        created_by INT NULL,
        last_used_at TIMESTAMP NULL,
        last_used_ip VARCHAR(64) NULL,
        last_used_result VARCHAR(64) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_api_clients (
        id ${pkDef},
        service_account_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        description TEXT NULL,
        client_id VARCHAR(96) NOT NULL UNIQUE,
        client_secret_hash VARCHAR(255) NOT NULL,
        secret_prefix VARCHAR(32) NOT NULL,
        scopes_json TEXT NOT NULL,
        allowed_ips_json TEXT NOT NULL,
        status INT NOT NULL DEFAULT 1,
        token_version INT NOT NULL DEFAULT 1,
        secret_rotated_at TIMESTAMP NULL,
        revoked_at TIMESTAMP NULL,
        revoked_reason VARCHAR(255) NULL,
        last_used_at TIMESTAMP NULL,
        last_used_ip VARCHAR(64) NULL,
        last_used_result VARCHAR(64) NULL,
        last_used_endpoint VARCHAR(255) NULL,
        usage_logs_json TEXT NOT NULL,
        created_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS auth_api_clients');
    await queryRunner.query('DROP TABLE IF EXISTS auth_service_accounts');
  }
}
