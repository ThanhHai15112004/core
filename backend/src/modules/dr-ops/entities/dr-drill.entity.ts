import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { DrDrillStatus, DrDrillType } from '../enum/dr-ops.enum.js';

@Entity({ name: 'dr_drills' })
@Index('UQ_dr_drills_code', ['drillCode'], { unique: true })
@Index('IDX_dr_drills_profile_at', ['profileCode', 'startedAt'])
export class DrDrillEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'drill_code', type: 'varchar', length: 64 })
  public drillCode!: string;

  @Column({ name: 'profile_code', type: 'varchar', length: 64, default: 'DEFAULT' })
  public profileCode!: string;

  @Column({ name: 'drill_type', type: 'varchar', length: 32, default: 'MANUAL_SIMULATION' })
  public drillType!: DrDrillType;

  @Column({ type: 'varchar', length: 160 })
  public scenario!: string;

  @Column({ type: 'varchar', length: 24, default: 'RUNNING' })
  public status!: DrDrillStatus;

  @Column({ name: 'rpo_target_seconds', type: 'int', default: 900 })
  public rpoTargetSeconds!: number;

  @Column({ name: 'rto_target_seconds', type: 'int', default: 1800 })
  public rtoTargetSeconds!: number;

  @Column({ name: 'measured_rpo_seconds', type: 'int', nullable: true })
  public measuredRpoSeconds!: number | null;

  @Column({ name: 'measured_rto_seconds', type: 'int', nullable: true })
  public measuredRtoSeconds!: number | null;

  @Column({ name: 'rpo_met', type: 'boolean', default: false })
  public rpoMet!: boolean;

  @Column({ name: 'rto_met', type: 'boolean', default: false })
  public rtoMet!: boolean;

  @Column({ name: 'switch_execution_id', type: 'bigint', nullable: true })
  public switchExecutionId!: number | null;

  @Column({ name: 'reconciliation_report_id', type: 'bigint', nullable: true })
  public reconciliationReportId!: number | null;

  @Column({ name: 'steps_json', type: 'text', nullable: true })
  public stepsJson!: string | null;

  @Column({ name: 'lessons_learned', type: 'text', nullable: true })
  public lessonsLearned!: string | null;

  @Column({ name: 'actor_user_id', type: 'bigint', nullable: true })
  public actorUserId!: number | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 160 })
  public actorName!: string;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  public durationMs!: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage!: string | null;
}
