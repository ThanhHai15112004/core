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
}
