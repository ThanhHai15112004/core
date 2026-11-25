import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { IncidentSeverity } from '../enum/incidents-ops.enum.js';

@Entity({ name: 'incident_severity_policies' })
@Index('UQ_incident_severity_policies_severity', ['severity'], { unique: true })
export class IncidentSeverityPolicyEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 8 })
  public severity!: IncidentSeverity;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'response_sla_minutes', type: 'int', default: 60 })
  public responseSlaMinutes!: number;

  @Column({ name: 'resolution_sla_minutes', type: 'int', default: 240 })
  public resolutionSlaMinutes!: number;

  @Column({ name: 'auto_escalate', type: 'boolean', default: true })
  public autoEscalate!: boolean;

  @Column({ name: 'is_system', type: 'boolean', default: true })
  public isSystem!: boolean;
}
