import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_DISPATCH_STATUS,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
} from '../enum/notifications.enum.js';

@Entity('notifications')
@Index('idx_notifications_category', ['category'])
@Index('idx_notifications_target_type', ['targetType'])
@Index('idx_notifications_org_unit_id', ['organizationUnitId'])
export class NotificationEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 255 })
  public title!: string;

  @Column({ type: 'text' })
  public content!: string;

  @Column({ type: 'int', default: NOTIFICATION_CATEGORY.SYSTEM })
  public category!: number;

  @Column({ type: 'int', default: NOTIFICATION_PRIORITY.NORMAL })
  public priority!: number;

  @Column({ name: 'target_type', type: 'int', default: NOTIFICATION_TARGET_TYPE.SINGLE_USER })
  public targetType!: number;

  @Column({ name: 'target_ids_json', type: 'text' })
  public targetIdsJson!: string;

  @Column({ name: 'channels_json', type: 'varchar', length: 255, default: '["IN_APP"]' })
  public channelsJson!: string;

  @Column({ name: 'action_url', type: 'varchar', length: 500, nullable: true })
  public actionUrl?: string | null;

  @Column({ name: 'reference_module', type: 'varchar', length: 64, nullable: true })
  public referenceModule?: string | null;

  @Column({ name: 'reference_type', type: 'varchar', length: 64, nullable: true })
  public referenceType?: string | null;

  @Column({ name: 'reference_id', type: 'varchar', length: 100, nullable: true })
  public referenceId?: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson?: string | null;

  @Column({ name: 'sender_user_id', type: 'int', nullable: true })
  public senderUserId?: number | null;

  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Column({ name: 'total_targeted', type: 'int', default: 0 })
  public totalTargeted!: number;

  @Column({ name: 'total_delivered', type: 'int', default: 0 })
  public totalDelivered!: number;

  @Column({ name: 'total_skipped_by_pref', type: 'int', default: 0 })
  public totalSkippedByPref!: number;

  @Column({ type: 'int', default: NOTIFICATION_DISPATCH_STATUS.SENT })
  public status!: number;

  @Column({ name: 'dispatched_at', type: 'timestamp' })
  public dispatchedAt!: Date;
}
