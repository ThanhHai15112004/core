import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { MFA_METHOD_CODE, type MfaMethodCode } from '../contracts/index.js';

@Entity('auth_mfa_configs')
export class AuthMfaConfigEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ name: 'totp_secret', type: 'varchar', length: 255, nullable: true })
  public totpSecret?: string | null;

  @Column({ name: 'totp_enabled', type: 'boolean', default: false })
  public totpEnabled!: boolean;

  @Column({ name: 'email_otp_enabled', type: 'boolean', default: false })
  public emailOtpEnabled!: boolean;

  /** Phương thức MFA ưu tiên: 1 = TOTP, 2 = EMAIL_OTP, 3 = RECOVERY_CODE */
  @Column({ name: 'preferred_method', type: 'int', default: MFA_METHOD_CODE.TOTP })
  public preferredMethod!: MfaMethodCode;

  @Column({ name: 'recovery_codes_hash_json', type: 'text' })
  public recoveryCodesHashJson!: string;

  @Column({ name: 'email_otp_code_hash', type: 'varchar', length: 128, nullable: true })
  public emailOtpCodeHash?: string | null;

  @Column({ name: 'email_otp_expires_at', type: 'timestamp', nullable: true })
  public emailOtpExpiresAt?: Date | null;

  @Column({ name: 'email_otp_failed_attempts', type: 'int', default: 0 })
  public emailOtpFailedAttempts?: number;

  @Column({ name: 'verified_at', type: 'timestamp', nullable: true })
  public verifiedAt?: Date | null;
}
