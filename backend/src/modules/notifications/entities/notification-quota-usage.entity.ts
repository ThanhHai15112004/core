import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { NOTIFICATION_CHANNEL } from '../enum/notifications.enum.js';

@Entity('notification_quota_usages')
@Index(
  'uq_notification_quota_channel_prov_period',
  ['channel', 'providerCode', 'periodType', 'periodKey'],
  { unique: true },
)
@Index('idx_notification_quota_period', ['periodType', 'periodKey'])
export class NotificationQuotaUsageEntity extends TypeOrmBaseEntity {
  @Column({ type: 'int', default: NOTIFICATION_CHANNEL.SMS })
  public channel!: number;

  @Column({ name: 'provider_code', type: 'varchar', length: 64, default: 'CONSOLE' })
  public providerCode!: string;

  @Column({ name: 'period_type', type: 'varchar', length: 16, default: 'DAILY' })
  public periodType!: 'DAILY' | 'MONTHLY';

  @Column({ name: 'period_key', type: 'varchar', length: 16 })
  public periodKey!: string;

  @Column({ name: 'total_sent', type: 'int', default: 0 })
  public totalSent!: number;

  @Column({ name: 'total_delivered', type: 'int', default: 0 })
  public totalDelivered!: number;

  @Column({ name: 'total_failed', type: 'int', default: 0 })
  public totalFailed!: number;

  @Column({ name: 'total_suppressed', type: 'int', default: 0 })
  public totalSuppressed!: number;

  @Column({ name: 'total_segments', type: 'int', default: 0 })
  public totalSegments!: number;

  @Column({ name: 'total_cost', type: 'decimal', precision: 14, scale: 4, default: '0.0000' })
  public totalCost!: string | number;

  @Column({ type: 'varchar', length: 16, default: 'VND' })
  public currency!: string;
}
