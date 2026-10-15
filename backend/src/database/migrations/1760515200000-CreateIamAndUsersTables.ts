import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateIamAndUsersTables (2026-10-15)
 * Khởi tạo lược đồ cơ sở dữ liệu cho 4 module IAM & Quản lý người dùng:
 * - organization_units
 * - roles, role_permissions
 * - users, user_roles, user_organization_units
 * - auth_sessions, auth_mfa_configs, auth_password_resets
 * Quy tắc: Tuyệt đối KHÔNG sửa đổi tệp migration này sau khi đã chạy trên môi trường Production.
 */
export class CreateIamAndUsersTables1760515200000 implements MigrationInterface {
  public readonly name = 'CreateIamAndUsersTables1760515200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS organization_units (
        id VARCHAR(36) PRIMARY KEY,
        code VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(32) NOT NULL DEFAULT 'BRANCH',
        parent_id VARCHAR(36) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        description TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id VARCHAR(36) PRIMARY KEY,
        code VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        description TEXT NULL,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id VARCHAR(36) PRIMARY KEY,
        role_id VARCHAR(36) NOT NULL,
        permission_code VARCHAR(128) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        UNIQUE (role_id, permission_code)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        phone VARCHAR(32) NULL,
        full_name VARCHAR(255) NOT NULL,
        avatar_url VARCHAR(500) NULL,
        password_hash VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        locked_until TIMESTAMP NULL,
        lock_reason VARCHAR(255) NULL,
        failed_login_attempts INT NOT NULL DEFAULT 0,
        mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        primary_organization_unit_id VARCHAR(36) NULL,
        password_changed_at TIMESTAMP NULL,
        last_login_at TIMESTAMP NULL,
        archived_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        role_id VARCHAR(36) NOT NULL,
        assigned_by VARCHAR(36) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        UNIQUE (user_id, role_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_organization_units (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        organization_unit_id VARCHAR(36) NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        position_title VARCHAR(128) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        UNIQUE (user_id, organization_unit_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(500) NULL,
        device_name VARCHAR(128) NULL,
        expires_at TIMESTAMP NOT NULL,
        last_active_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL,
        revoke_reason VARCHAR(128) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_mfa_configs (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL UNIQUE,
        totp_secret VARCHAR(255) NULL,
        totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        email_otp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        preferred_method VARCHAR(32) NOT NULL DEFAULT 'TOTP',
        recovery_codes_hash_json TEXT NOT NULL,
        email_otp_code_hash VARCHAR(128) NULL,
        email_otp_expires_at TIMESTAMP NULL,
        verified_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_password_resets (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP NULL,
        requested_ip VARCHAR(64) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_security_settings (
        id VARCHAR(36) PRIMARY KEY,
        scope_key VARCHAR(64) NOT NULL UNIQUE DEFAULT 'GLOBAL',
        password_hash_algorithm VARCHAR(32) NOT NULL DEFAULT 'SCRYPT',
        db_encryption_algorithm VARCHAR(32) NOT NULL DEFAULT 'AES_256_GCM',
        encrypt_fields_at_rest BOOLEAN NOT NULL DEFAULT TRUE,
        mfa_policy VARCHAR(32) NOT NULL DEFAULT 'OPTIONAL',
        allowed_mfa_methods_json TEXT NOT NULL,
        max_failed_login_attempts INT NOT NULL DEFAULT 5,
        lockout_duration_minutes INT NOT NULL DEFAULT 15,
        password_min_length INT NOT NULL DEFAULT 8,
        require_uppercase BOOLEAN NOT NULL DEFAULT TRUE,
        require_numbers BOOLEAN NOT NULL DEFAULT TRUE,
        require_special_chars BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS auth_security_settings');
    await queryRunner.query('DROP TABLE IF EXISTS auth_password_resets');
    await queryRunner.query('DROP TABLE IF EXISTS auth_mfa_configs');
    await queryRunner.query('DROP TABLE IF EXISTS auth_sessions');
    await queryRunner.query('DROP TABLE IF EXISTS user_organization_units');
    await queryRunner.query('DROP TABLE IF EXISTS user_roles');
    await queryRunner.query('DROP TABLE IF EXISTS users');
    await queryRunner.query('DROP TABLE IF EXISTS role_permissions');
    await queryRunner.query('DROP TABLE IF EXISTS roles');
    await queryRunner.query('DROP TABLE IF EXISTS organization_units');
  }
}
