import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  DB_ENCRYPTION_ALGO_CODE,
  type DbEncryptionAlgoCode,
  MFA_POLICY_CODE,
  type MfaPolicyCode,
  PASSWORD_HASH_ALGO_CODE,
  type PasswordHashAlgoCode,
} from '../contracts/index.js';

@Entity('auth_security_settings')
export class AuthSecuritySettingEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ name: 'scope_key', type: 'varchar', length: 64, default: 'GLOBAL' })
  public scopeKey!: string;

  /** Thuật toán băm mật khẩu: 1 = SCRYPT, 2 = PBKDF2_SHA512, 3 = PBKDF2_SHA256 */
  @Column({
    name: 'password_hash_algorithm',
    type: 'int',
    default: PASSWORD_HASH_ALGO_CODE.SCRYPT,
  })
  public passwordHashAlgorithm!: PasswordHashAlgoCode;

  /** Thuật toán mã hóa trường nhạy cảm xuống DB: 1 = AES_256_GCM, 2 = CHACHA20_POLY1305, 3 = AES_256_CBC_HMAC */
  @Column({
    name: 'db_encryption_algorithm',
    type: 'int',
    default: DB_ENCRYPTION_ALGO_CODE.AES_256_GCM,
  })
  public dbEncryptionAlgorithm!: DbEncryptionAlgoCode;

  @Column({ name: 'encrypt_fields_at_rest', type: 'boolean', default: true })
  public encryptFieldsAtRest!: boolean;

  /** Chính sách MFA: 1 = OPTIONAL, 2 = REQUIRED_FOR_ADMINS, 3 = REQUIRED_FOR_ALL */
  @Column({ name: 'mfa_policy', type: 'int', default: MFA_POLICY_CODE.OPTIONAL })
  public mfaPolicy!: MfaPolicyCode;

  @Column({
    name: 'allowed_mfa_methods_json',
    type: 'text',
  })
  public allowedMfaMethodsJson!: string;

  @Column({ name: 'max_failed_login_attempts', type: 'int', default: 5 })
  public maxFailedLoginAttempts!: number;

  @Column({ name: 'lockout_duration_minutes', type: 'int', default: 15 })
  public lockoutDurationMinutes!: number;

  @Column({ name: 'password_min_length', type: 'int', default: 8 })
  public passwordMinLength!: number;

  @Column({ name: 'require_uppercase', type: 'boolean', default: true })
  public requireUppercase!: boolean;

  @Column({ name: 'require_numbers', type: 'boolean', default: true })
  public requireNumbers!: boolean;

  @Column({ name: 'require_special_chars', type: 'boolean', default: true })
  public requireSpecialChars!: boolean;

  @Column({ name: 'require_current_password_on_change', type: 'boolean', default: true })
  public requireCurrentPasswordOnChange?: boolean;

  @Column({ name: 'disallowed_passwords_json', type: 'text', nullable: true })
  public disallowedPasswordsJson?: string | null;

  @Column({ name: 'disallow_user_info_in_password', type: 'boolean', default: true })
  public disallowUserInfoInPassword?: boolean;

  @Column({ name: 'prevent_password_reuse', type: 'boolean', default: false })
  public preventPasswordReuse?: boolean;

  @Column({ name: 'password_history_limit', type: 'int', default: 5 })
  public passwordHistoryLimit?: number;

  @Column({ name: 'revoke_sessions_on_password_change', type: 'boolean', default: true })
  public revokeSessionsOnPasswordChange?: boolean;

  @Column({ name: 'allow_email_registration', type: 'boolean', default: true })
  public allowEmailRegistration?: boolean;

  @Column({ name: 'allow_phone_registration', type: 'boolean', default: true })
  public allowPhoneRegistration?: boolean;

  @Column({ name: 'require_email_verification', type: 'boolean', default: false })
  public requireEmailVerification?: boolean;

  @Column({ name: 'require_phone_verification', type: 'boolean', default: false })
  public requirePhoneVerification?: boolean;

  @Column({ name: 'otp_max_send_count', type: 'int', default: 5 })
  public otpMaxSendCount?: number;

  @Column({ name: 'otp_max_attempts', type: 'int', default: 5 })
  public otpMaxAttempts?: number;

  @Column({ name: 'otp_cooldown_seconds', type: 'int', default: 60 })
  public otpCooldownSeconds?: number;

  @Column({ name: 'session_idle_timeout_minutes', type: 'int', default: 30 })
  public sessionIdleTimeoutMinutes?: number;

  @Column({ name: 'session_max_lifetime_minutes', type: 'int', default: 10080 })
  public sessionMaxLifetimeMinutes?: number;

  @Column({ name: 'enable_login_audit_log', type: 'boolean', default: true })
  public enableLoginAuditLog?: boolean;
}
