import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateIamAndUsersTables (2026-10-15)
 * Khởi tạo lược đồ cơ sở dữ liệu cho các module IAM & Quản lý người dùng (sử dụng STT INT AUTO_INCREMENT cho ID và INT cho Status/Type):
 * - organization_units (type: 1=HEADQUARTERS, 2=BRANCH, 3=DEPARTMENT, 4=TEAM; status: 1=ACTIVE, 2=INACTIVE, 3=ARCHIVED)
 * - permissions (status: 1=ACTIVE, 2=INACTIVE)
 * - roles, role_permissions (role_id INT, permission_id INT)
 * - users (first_name, last_name, full_name, status: 1=ACTIVE, 2=INACTIVE, 3=LOCKED, 4=ARCHIVED)
 * - user_roles, user_organization_units, user_status_histories
 * - auth_sessions, auth_mfa_configs, auth_password_resets, auth_security_settings
 * - core_master_settings
 */
export class CreateIamAndUsersTables1760515200000 implements MigrationInterface {
  public readonly name = 'CreateIamAndUsersTables1760515200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS organization_units (
        id ${pkDef},
        code VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        type INT NOT NULL DEFAULT 2,
        parent_id INT NULL,
        status INT NOT NULL DEFAULT 1,
        description TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id ${pkDef},
        code VARCHAR(128) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        module VARCHAR(64) NOT NULL,
        description TEXT NULL,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id ${pkDef},
        code VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        description TEXT NULL,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id ${pkDef},
        role_id INT NOT NULL,
        permission_id INT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        UNIQUE (role_id, permission_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id ${pkDef},
        username VARCHAR(64) NOT NULL UNIQUE,
        email VARCHAR(255) NULL UNIQUE,
        phone VARCHAR(255) NULL,
        phone_hash VARCHAR(64) NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        status INT NOT NULL DEFAULT 1,
        email_verified_at TIMESTAMP NULL,
        phone_verified_at TIMESTAMP NULL,
        locked_until TIMESTAMP NULL,
        lock_reason VARCHAR(255) NULL,
        failed_login_attempts INT NOT NULL DEFAULT 0,
        mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        primary_organization_unit_id INT NULL,
        password_changed_at TIMESTAMP NULL,
        password_history_hashes_json TEXT NULL,
        last_login_at TIMESTAMP NULL,
        archived_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id ${pkDef},
        user_id INT NOT NULL UNIQUE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(150) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        avatar_url VARCHAR(500) NULL,
        date_of_birth DATE NULL,
        gender INT NULL,
        identity_number VARCHAR(128) NULL,
        address VARCHAR(255) NULL,
        city VARCHAR(100) NULL,
        country VARCHAR(100) NULL,
        bio TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id ${pkDef},
        user_id INT NOT NULL,
        role_id INT NOT NULL,
        assigned_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        UNIQUE (user_id, role_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_organization_units (
        id ${pkDef},
        user_id INT NOT NULL,
        organization_unit_id INT NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        position_title VARCHAR(128) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        UNIQUE (user_id, organization_unit_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_status_histories (
        id ${pkDef},
        user_id INT NOT NULL,
        from_status INT NULL,
        to_status INT NOT NULL,
        reason VARCHAR(255) NULL,
        changed_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id ${pkDef},
        user_id INT NOT NULL,
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
        id ${pkDef},
        user_id INT NOT NULL UNIQUE,
        totp_secret VARCHAR(255) NULL,
        totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        email_otp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        preferred_method INT NOT NULL DEFAULT 1,
        recovery_codes_hash_json TEXT NOT NULL,
        email_otp_code_hash VARCHAR(128) NULL,
        email_otp_expires_at TIMESTAMP NULL,
        email_otp_failed_attempts INT NOT NULL DEFAULT 0,
        verified_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_password_resets (
        id ${pkDef},
        user_id INT NOT NULL,
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        otp_code_hash VARCHAR(128) NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP NULL,
        requested_ip VARCHAR(64) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_verification_codes (
        id ${pkDef},
        user_id INT NOT NULL,
        channel INT NOT NULL DEFAULT 1,
        purpose INT NOT NULL DEFAULT 1,
        target VARCHAR(255) NOT NULL,
        code_hash VARCHAR(128) NOT NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
        send_count INT NOT NULL DEFAULT 1,
        max_sends INT NOT NULL DEFAULT 5,
        last_sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        verified_at TIMESTAMP NULL,
        requested_ip VARCHAR(64) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_login_histories (
        id ${pkDef},
        user_id INT NULL,
        session_id INT NULL,
        identifier VARCHAR(255) NULL,
        event_type INT NOT NULL DEFAULT 1,
        status INT NOT NULL DEFAULT 1,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(500) NULL,
        device_name VARCHAR(128) NULL,
        reason VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_security_settings (
        id ${pkDef},
        scope_key VARCHAR(64) NOT NULL UNIQUE DEFAULT 'GLOBAL',
        password_hash_algorithm INT NOT NULL DEFAULT 1,
        db_encryption_algorithm INT NOT NULL DEFAULT 1,
        encrypt_fields_at_rest BOOLEAN NOT NULL DEFAULT TRUE,
        mfa_policy INT NOT NULL DEFAULT 1,
        allowed_mfa_methods_json TEXT NOT NULL,
        max_failed_login_attempts INT NOT NULL DEFAULT 5,
        lockout_duration_minutes INT NOT NULL DEFAULT 15,
        password_min_length INT NOT NULL DEFAULT 8,
        require_uppercase BOOLEAN NOT NULL DEFAULT TRUE,
        require_numbers BOOLEAN NOT NULL DEFAULT TRUE,
        require_special_chars BOOLEAN NOT NULL DEFAULT TRUE,
        require_current_password_on_change BOOLEAN NOT NULL DEFAULT TRUE,
        disallowed_passwords_json TEXT NULL,
        disallow_user_info_in_password BOOLEAN NOT NULL DEFAULT TRUE,
        prevent_password_reuse BOOLEAN NOT NULL DEFAULT FALSE,
        password_history_limit INT NOT NULL DEFAULT 5,
        revoke_sessions_on_password_change BOOLEAN NOT NULL DEFAULT TRUE,
        allow_email_registration BOOLEAN NOT NULL DEFAULT TRUE,
        allow_phone_registration BOOLEAN NOT NULL DEFAULT TRUE,
        require_email_verification BOOLEAN NOT NULL DEFAULT FALSE,
        require_phone_verification BOOLEAN NOT NULL DEFAULT FALSE,
        otp_max_send_count INT NOT NULL DEFAULT 5,
        otp_max_attempts INT NOT NULL DEFAULT 5,
        otp_cooldown_seconds INT NOT NULL DEFAULT 60,
        session_idle_timeout_minutes INT NOT NULL DEFAULT 30,
        session_max_lifetime_minutes INT NOT NULL DEFAULT 10080,
        enable_login_audit_log BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS core_master_settings (
        id ${pkDef},
        setting_key VARCHAR(128) NOT NULL UNIQUE,
        setting_value TEXT NOT NULL,
        description VARCHAR(255) NOT NULL,
        status INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS core_master_settings');
    await queryRunner.query('DROP TABLE IF EXISTS auth_security_settings');
    await queryRunner.query('DROP TABLE IF EXISTS auth_login_histories');
    await queryRunner.query('DROP TABLE IF EXISTS auth_verification_codes');
    await queryRunner.query('DROP TABLE IF EXISTS auth_password_resets');
    await queryRunner.query('DROP TABLE IF EXISTS auth_mfa_configs');
    await queryRunner.query('DROP TABLE IF EXISTS auth_sessions');
    await queryRunner.query('DROP TABLE IF EXISTS user_status_histories');
    await queryRunner.query('DROP TABLE IF EXISTS user_organization_units');
    await queryRunner.query('DROP TABLE IF EXISTS user_roles');
    await queryRunner.query('DROP TABLE IF EXISTS user_profiles');
    await queryRunner.query('DROP TABLE IF EXISTS users');
    await queryRunner.query('DROP TABLE IF EXISTS role_permissions');
    await queryRunner.query('DROP TABLE IF EXISTS roles');
    await queryRunner.query('DROP TABLE IF EXISTS permissions');
    await queryRunner.query('DROP TABLE IF EXISTS organization_units');
  }
}

