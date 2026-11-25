import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { SiemDispatchStatus } from '../enum/incidents-ops.enum.js';
import { incidentNullableBigintTransformer } from '../helpers/incident-bigint.helper.js';

@Entity({ name: 'siem_dispatch_logs' })
@Index('IDX_siem_dispatch_logs_status_at', ['status', 'dispatchedAt'])
@Index('IDX_siem_dispatch_logs_event_type', ['eventType', 'dispatchedAt'])
export class SiemDispatchLogEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  public eventType!: string;

  @Column({ name: 'alert_code', type: 'varchar', length: 100, nullable: true })
  public alertCode!: string | null;

  @Column({ type: 'varchar', length: 16 })
  public severity!: string;

  @Column({ type: 'varchar', length: 32, default: 'internal_log' })
  public driver!: string;

  @Column({ type: 'varchar', length: 255, default: 'internal-siem-logger' })
  public destination!: string;

  @Column({ type: 'varchar', length: 20, default: 'SENT' })
  public status!: SiemDispatchStatus;

  @Column({ name: 'http_status', type: 'int', nullable: true })
  public httpStatus!: number | null;

  @Column({ name: 'attempt_count', type: 'int', default: 1 })
  public attemptCount!: number;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'payload_json', type: 'text', nullable: true })
  public payloadJson!: string | null;

  @Column({
    name: 'incident_id',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public incidentId!: number | null;

  @Column({
    name: 'actor_user_id',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public actorUserId!: number | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress!: string | null;

  @Column({ name: 'dispatched_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public dispatchedAt!: Date;
}
