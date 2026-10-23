import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { NOTIFICATION_PUSH_PLATFORM } from '../enum/notifications.enum.js';

@Entity('notification_push_subscriptions')
@Index('uq_notification_push_subs_user_token', ['userId', 'deviceToken'], { unique: true })
@Index('idx_notification_push_subs_user_active', ['userId', 'isActive'])
export class NotificationPushSubscriptionEntity extends TypeOrmBaseEntity {
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ type: 'int', default: NOTIFICATION_PUSH_PLATFORM.WEB_PUSH })
  public platform!: number;

  @Column({ name: 'device_token', type: 'varchar', length: 320 })
  public deviceToken!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public endpoint?: string | null;

  @Column({ name: 'p256dh_key', type: 'varchar', length: 255, nullable: true })
  public p256dhKey?: string | null;

  @Column({ name: 'auth_key', type: 'varchar', length: 255, nullable: true })
  public authKey?: string | null;

  @Column({ name: 'device_name', type: 'varchar', length: 120, nullable: true })
  public deviceName?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  public isActive!: boolean;

  @Column({ name: 'invalidated_at', type: 'timestamp', nullable: true })
  public invalidatedAt?: Date | null;

  @Column({ name: 'failure_reason', type: 'varchar', length: 255, nullable: true })
  public failureReason?: string | null;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  public lastUsedAt?: Date | null;
}
