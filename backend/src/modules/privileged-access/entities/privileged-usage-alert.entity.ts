import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { PrivilegedTargetType } from '../enum/privileged-access.enum.js';

@Entity({ name: 'privileged_usage_alerts' })
@Index('idx_pam_alerts_event_created', ['eventType', 'createdAt'])
@Index('idx_pam_alerts_actor_created', ['actorUserId', 'createdAt'])
@Index('idx_pam_alerts_severity_ack', ['severity', 'acknowledgedAt'])
export class PrivilegedUsageAlertEntity extends TypeOrmBaseEntity {
  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  public eventType!: string;

  @Column({ type: 'varchar', length: 16, default: 'HIGH' })
  public severity!: string;

  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  public actorUserId!: number | null;

  @Column({ name: 'actor_username', type: 'varchar', length: 128, nullable: true })
  public actorUsername!: string | null;

  @Column({ name: 'target_type', type: 'varchar', length: 24, nullable: true })
  public targetType!: PrivilegedTargetType | null;

  @Column({ name: 'target_code', type: 'varchar', length: 128, nullable: true })
  public targetCode!: string | null;

  @Column({ type: 'varchar', length: 160 })
  public action!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public endpoint!: string | null;

  @Column({ name: 'http_method', type: 'varchar', length: 16, nullable: true })
  public httpMethod!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress!: string | null;

  @Column({ name: 'details_json', type: 'text', nullable: true })
  public detailsJson!: string | null;

  @Column({ name: 'notified_recipients_json', type: 'text', nullable: true })
  public notifiedRecipientsJson!: string | null;

  @Column({ name: 'notification_dispatch_id', type: 'int', nullable: true })
  public notificationDispatchId!: number | null;

  @Column({ name: 'incident_id', type: 'int', nullable: true })
  public incidentId!: number | null;

  @Column({ name: 'acknowledged_by', type: 'int', nullable: true })
  public acknowledgedBy!: number | null;

  @Column({ name: 'acknowledged_at', type: 'timestamp', nullable: true })
  public acknowledgedAt!: Date | null;

  @Column({ name: 'acknowledge_note', type: 'varchar', length: 500, nullable: true })
  public acknowledgeNote!: string | null;
}
