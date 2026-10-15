import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('auth_sessions')
export class AuthSessionEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  public userId!: string;

  @Index({ unique: true })
  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 128 })
  public refreshTokenHash!: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  public userAgent?: string | null;

  @Column({ name: 'device_name', type: 'varchar', length: 128, nullable: true })
  public deviceName?: string | null;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamp' })
  public expiresAt!: Date;

  @Column({ name: 'last_active_at', type: 'timestamp' })
  public lastActiveAt!: Date;

  @Index()
  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  public revokedAt?: Date | null;

  @Column({ name: 'revoke_reason', type: 'varchar', length: 128, nullable: true })
  public revokeReason?: string | null;
}
