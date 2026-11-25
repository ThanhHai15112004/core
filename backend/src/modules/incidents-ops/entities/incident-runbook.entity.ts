import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { IncidentSeverity } from '../enum/incidents-ops.enum.js';
import { incidentNullableBigintTransformer } from '../helpers/incident-bigint.helper.js';

@Entity({ name: 'incident_runbooks' })
@Index('UQ_incident_runbooks_code', ['code'], { unique: true })
@Index('IDX_incident_runbooks_alert_code', ['alertCode', 'isActive', 'deletedAt'])
export class IncidentRunbookEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 80 })
  public code!: string;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'alert_code', type: 'varchar', length: 100, nullable: true })
  public alertCode!: string | null;

  @Column({ name: 'default_severity', type: 'varchar', length: 8, default: 'P2' })
  public defaultSeverity!: IncidentSeverity;

  @Column({ name: 'triage_steps_json', type: 'text' })
  public triageStepsJson!: string;

  @Column({ name: 'mitigation_steps_json', type: 'text' })
  public mitigationStepsJson!: string;

  @Column({ name: 'verification_steps_json', type: 'text', nullable: true })
  public verificationStepsJson!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  public isActive!: boolean;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public createdBy!: number | null;

  @Column({
    name: 'updated_by',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public updatedBy!: number | null;
}
