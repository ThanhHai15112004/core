import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { PostmortemStatus } from '../enum/incidents-ops.enum.js';
import {
  incidentBigintTransformer,
  incidentNullableBigintTransformer,
} from '../helpers/incident-bigint.helper.js';

@Entity({ name: 'incident_postmortems' })
@Index('UQ_incident_postmortems_incident', ['incidentId'], { unique: true })
export class IncidentPostmortemEntity extends VersionedTypeOrmEntity {
  @Column({
    name: 'incident_id',
    type: 'bigint',
    transformer: incidentBigintTransformer,
  })
  public incidentId!: number;

  @Column({ name: 'incident_code', type: 'varchar', length: 64 })
  public incidentCode!: string;

  @Column({ type: 'varchar', length: 240 })
  public title!: string;

  @Column({ type: 'text' })
  public summary!: string;

  @Column({ name: 'impact_summary', type: 'text', nullable: true })
  public impactSummary!: string | null;

  @Column({ name: 'root_cause_analysis', type: 'text' })
  public rootCauseAnalysis!: string;

  @Column({ name: 'lessons_learned', type: 'text' })
  public lessonsLearned!: string;

  @Column({ name: 'preventive_actions_json', type: 'text' })
  public preventiveActionsJson!: string;

  @Column({ type: 'varchar', length: 24, default: 'DRAFT' })
  public status!: PostmortemStatus;

  @Column({
    name: 'author_id',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public authorId!: number | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  public publishedAt!: Date | null;
}
