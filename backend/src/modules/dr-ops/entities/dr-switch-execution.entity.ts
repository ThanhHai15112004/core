import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type {
  DrSiteRole,
  DrSwitchDirection,
  DrSwitchMode,
  DrSwitchStatus,
} from '../enum/dr-ops.enum.js';

@Entity({ name: 'dr_switch_executions' })
@Index('UQ_dr_switch_executions_code', ['switchCode'], { unique: true })
@Index('IDX_dr_switch_executions_profile_at', ['profileCode', 'startedAt'])
@Index('IDX_dr_switch_executions_status', ['status', 'startedAt'])
export class DrSwitchExecutionEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'switch_code', type: 'varchar', length: 64 })
  public switchCode!: string;

  @Column({ name: 'profile_code', type: 'varchar', length: 64, default: 'DEFAULT' })
  public profileCode!: string;

  @Column({ type: 'varchar', length: 24 })
  public direction!: DrSwitchDirection;

  @Column({ type: 'varchar', length: 24, default: 'SIMULATED' })
  public mode!: DrSwitchMode;

  @Column({ name: 'from_site', type: 'varchar', length: 24 })
  public fromSite!: DrSiteRole;

  @Column({ name: 'to_site', type: 'varchar', length: 24 })
  public toSite!: DrSiteRole;

  @Column({ type: 'varchar', length: 24, default: 'IN_PROGRESS' })
  public status!: DrSwitchStatus;

  @Column({ type: 'varchar', length: 1000 })
  public reason!: string;

  @Column({ name: 'checklist_json', type: 'text' })
  public checklistJson!: string;

  @Column({ name: 'rto_target_seconds', type: 'int', default: 1800 })
  public rtoTargetSeconds!: number;

  @Column({ name: 'actual_rto_seconds', type: 'int', nullable: true })
  public actualRtoSeconds!: number | null;

  @Column({ name: 'rto_met', type: 'boolean', nullable: true })
  public rtoMet!: boolean | null;

  @Column({ name: 'reconciliation_report_id', type: 'bigint', nullable: true })
  public reconciliationReportId!: number | null;

  @Column({ name: 'initiated_by_user_id', type: 'bigint', nullable: true })
  public initiatedByUserId!: number | null;

  @Column({ name: 'initiated_by_name', type: 'varchar', length: 160 })
  public initiatedByName!: string;

  @Column({ name: 'completed_by_name', type: 'varchar', length: 160, nullable: true })
  public completedByName!: string | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  public durationMs!: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;
}
