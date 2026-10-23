import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_SUPPRESSION_REASON,
} from '../enum/notifications.enum.js';

@Entity('notification_suppressions')
@Index('uq_notification_suppressions_channel_dest', ['channel', 'destination'], { unique: true })
@Index('idx_notification_suppressions_active', ['channel', 'isActive'])
export class NotificationSuppressionEntity extends TypeOrmBaseEntity {
  @Column({ type: 'int', default: NOTIFICATION_CHANNEL.EMAIL })
  public channel!: number;

  @Column({ type: 'varchar', length: 320 })
  public destination!: string;

  @Column({ type: 'int', default: NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE })
  public reason!: number;

  @Column({ name: 'provider_code', type: 'varchar', length: 64, nullable: true })
  public providerCode?: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  public errorCode?: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  public errorMessage?: string | null;

  @Column({ name: 'source_notification_id', type: 'int', nullable: true })
  public sourceNotificationId?: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  public isActive!: boolean;

  @Column({ name: 'suppressed_at', type: 'timestamp' })
  public suppressedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  public expiresAt?: Date | null;
}
