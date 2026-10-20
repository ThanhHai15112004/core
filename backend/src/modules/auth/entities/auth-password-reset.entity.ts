import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('auth_password_resets')
export class AuthPasswordResetEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 128 })
  public tokenHash!: string;

  @Index()
  @Column({ name: 'otp_code_hash', type: 'varchar', length: 128, nullable: true })
  public otpCodeHash?: string | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  public attemptCount?: number;

  @Column({ name: 'max_attempts', type: 'int', default: 5 })
  public maxAttempts?: number;

  @Column({ name: 'expires_at', type: 'timestamp' })
  public expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamp', nullable: true })
  public usedAt?: Date | null;

  @Column({ name: 'requested_ip', type: 'varchar', length: 64, nullable: true })
  public requestedIp?: string | null;
}
