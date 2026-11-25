import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type {
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
} from '../enum/incidents-ops.enum.js';
import {
  incidentBigintTransformer,
  incidentNullableBigintTransformer,
} from '../helpers/incident-bigint.helper.js';

@Entity({ name: 'incidents' })
@Index('UQ_incidents_incident_code', ['incidentCode'], { unique: true })
@Index('IDX_incidents_fingerprint_status', ['fingerprint', 'status', 'deletedAt'])
@Index('IDX_incidents_severity_status', ['severity', 'status', 'lastSeenAt'])
@Index('IDX_incidents_owner_status', ['ownerUserId', 'status', 'deletedAt'])
@Index('IDX_incidents_repeated', ['isRepeated', 'occurrenceCount', 'lastSeenAt'])
export class IncidentEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'incident_code', type: 'varchar', length: 64 })
  public incidentCode!: string;

  @Column({ type: 'varchar', length: 240 })
  public title!: string;

  @Column({ type: 'text', nullable: true })
  public description!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'SIEM' })
  public source!: IncidentSource;

  @Column({ name: 'alert_code', type: 'varchar', length: 100 })
  public alertCode!: string;

  @Column({ type: 'varchar', length: 191 })
  public fingerprint!: string;

  @Column({ type: 'varchar', length: 8, default: 'P2' })
  public severity!: IncidentSeverity;

  @Column({ type: 'varchar', length: 24, default: 'OPEN' })
  public status!: IncidentStatus;

  @Column({
    name: 'owner_user_id',
    type: 'bigint',
    transformer: incidentBigintTransformer,
  })
  public ownerUserId!: number;

  @Column({
    name: 'runbook_id',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public runbookId!: number | null;

  @Column({ name: 'occurrence_count', type: 'int', default: 1 })
  public occurrenceCount!: number;

  @Column({ name: 'suppressed_count', type: 'int', default: 0 })
  public suppressedCount!: number;

  @Column({ name: 'is_repeated', type: 'boolean', default: false })
  public isRepeated!: boolean;

  @Column({ name: 'first_seen_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public firstSeenAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public lastSeenAt!: Date;

  @Column({ name: 'sla_due_at', type: 'timestamp', nullable: true })
  public slaDueAt!: Date | null;

  @Column({ name: 'sla_breached', type: 'boolean', default: false })
  public slaBreached!: boolean;

  @Column({ name: 'acknowledged_at', type: 'timestamp', nullable: true })
  public acknowledgedAt!: Date | null;

  @Column({
    name: 'acknowledged_by',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public acknowledgedBy!: number | null;

  @Column({ name: 'mitigated_at', type: 'timestamp', nullable: true })
  public mitigatedAt!: Date | null;

  @Column({
    name: 'mitigated_by',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public mitigatedBy!: number | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  public resolvedAt!: Date | null;

  @Column({
    name: 'resolved_by',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public resolvedBy!: number | null;

  @Column({ name: 'recovery_seconds', type: 'int', nullable: true })
  public recoverySeconds!: number | null;

  @Column({ name: 'root_cause', type: 'text', nullable: true })
  public rootCause!: string | null;

  @Column({ name: 'mitigation_summary', type: 'text', nullable: true })
  public mitigationSummary!: string | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  public resolutionNote!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;

  @Column({ name: 'timeline_json', type: 'text', nullable: true })
  public timelineJson!: string | null;

  @Column({ name: 'siem_delivery_status_json', type: 'text', nullable: true })
  public siemDeliveryStatusJson!: string | null;
}
