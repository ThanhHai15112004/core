import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { NOTIFICATION_CATEGORY } from '../enum/notifications.enum.js';

@Entity('notification_preferences')
@Index('uq_notification_preferences_user_category', ['userId', 'category'], { unique: true })
export class NotificationPreferenceEntity extends TypeOrmBaseEntity {
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ type: 'int', default: NOTIFICATION_CATEGORY.SYSTEM })
  public category!: number;

  @Column({ name: 'in_app_enabled', type: 'boolean', default: true })
  public inAppEnabled!: boolean;

  @Column({ name: 'email_enabled', type: 'boolean', default: true })
  public emailEnabled!: boolean;

  @Column({ name: 'sms_enabled', type: 'boolean', default: false })
  public smsEnabled!: boolean;

  @Column({ name: 'push_enabled', type: 'boolean', default: true })
  public pushEnabled!: boolean;

  @Column({ name: 'muted_until', type: 'timestamp', nullable: true })
  public mutedUntil?: Date | null;
}
