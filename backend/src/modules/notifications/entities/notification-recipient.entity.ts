import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { NOTIFICATION_CHANNEL, NOTIFICATION_INBOX_STATUS } from '../enum/notifications.enum.js';

@Entity('notification_recipients')
@Index('idx_notification_recipients_user_inbox', ['recipientUserId', 'inboxStatus', 'isRead'])
@Index('idx_notification_recipients_notification_id', ['notificationId'])
@Index(
  'uq_notification_recipients_notif_user_channel',
  ['notificationId', 'recipientUserId', 'channel'],
  { unique: true },
)
export class NotificationRecipientEntity extends TypeOrmBaseEntity {
  @Column({ name: 'notification_id', type: 'int' })
  public notificationId!: number;

  @Column({ name: 'recipient_user_id', type: 'int' })
  public recipientUserId!: number;

  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Column({ type: 'int', default: NOTIFICATION_CHANNEL.IN_APP })
  public channel!: number;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  public isRead!: boolean;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  public readAt?: Date | null;

  @Column({ name: 'inbox_status', type: 'int', default: NOTIFICATION_INBOX_STATUS.ACTIVE })
  public inboxStatus!: number;

  @Column({ name: 'archived_at', type: 'timestamp', nullable: true })
  public archivedAt?: Date | null;

  @Column({ name: 'recipient_deleted_at', type: 'timestamp', nullable: true })
  public recipientDeletedAt?: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamp' })
  public deliveredAt!: Date;
}
