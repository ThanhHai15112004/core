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

  @Column({ name: 'expires_at', type: 'timestamp' })
  public expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamp', nullable: true })
  public usedAt?: Date | null;

  @Column({ name: 'requested_ip', type: 'varchar', length: 64, nullable: true })
  public requestedIp?: string | null;
}
