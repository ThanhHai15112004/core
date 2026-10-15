import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { DbEncryptionAlgorithm, PasswordHashAlgorithm } from '@packages/security/index.js';

export type MfaEnforcementPolicy = 'OPTIONAL' | 'REQUIRED_FOR_ADMINS' | 'REQUIRED_FOR_ALL';

@Entity('auth_security_settings')
export class AuthSecuritySettingEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ name: 'scope_key', type: 'varchar', length: 64, default: 'GLOBAL' })
  public scopeKey!: string;

  @Column({ name: 'password_hash_algorithm', type: 'varchar', length: 32, default: 'SCRYPT' })
  public passwordHashAlgorithm!: PasswordHashAlgorithm;

  @Column({ name: 'db_encryption_algorithm', type: 'varchar', length: 32, default: 'AES_256_GCM' })
  public dbEncryptionAlgorithm!: DbEncryptionAlgorithm;

  @Column({ name: 'encrypt_fields_at_rest', type: 'boolean', default: true })
  public encryptFieldsAtRest!: boolean;

  @Column({ name: 'mfa_policy', type: 'varchar', length: 32, default: 'OPTIONAL' })
  public mfaPolicy!: MfaEnforcementPolicy;

  @Column({
    name: 'allowed_mfa_methods_json',
    type: 'text',
    default: '["TOTP","EMAIL_OTP","RECOVERY_CODE"]',
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
