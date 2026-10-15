import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('auth_mfa_configs')
export class AuthMfaConfigEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  public userId!: string;

  @Column({ name: 'totp_secret', type: 'varchar', length: 255, nullable: true })
  public totpSecret?: string | null;

  @Column({ name: 'totp_enabled', type: 'boolean', default: false })
  public totpEnabled!: boolean;

  @Column({ name: 'email_otp_enabled', type: 'boolean', default: false })
  public emailOtpEnabled!: boolean;

  @Column({ name: 'preferred_method', type: 'varchar', length: 32, default: 'TOTP' })
  public preferredMethod!: 'TOTP' | 'EMAIL_OTP';

  @Column({ name: 'recovery_codes_hash_json', type: 'text', default: '[]' })
  public recoveryCodesHashJson!: string;

  @Column({ name: 'email_otp_code_hash', type: 'varchar', length: 128, nullable: true })
  public emailOtpCodeHash?: string | null;

  @Column({ name: 'email_otp_expires_at', type: 'timestamp', nullable: true })
  public emailOtpExpiresAt?: Date | null;

  @Column({ name: 'verified_at', type: 'timestamp', nullable: true })
  public verifiedAt?: Date | null;
}
