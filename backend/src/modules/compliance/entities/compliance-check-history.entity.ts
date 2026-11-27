import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { ControlCheckResult } from '../enum/compliance.enum.js';

@Entity({ name: 'compliance_check_histories' })
@Index('idx_comp_checks_control_at', ['controlId', 'checkedAt'])
@Index('idx_comp_checks_result', ['result', 'checkedAt'])
export class ComplianceCheckHistoryEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'control_id', type: 'int' })
  public controlId!: number;

  @Column({ name: 'checked_by_user_id', type: 'int' })
  public checkedByUserId!: number;

  @Column({ name: 'checked_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public checkedAt!: Date;

  @Column({ type: 'varchar', length: 24 })
  public result!: ControlCheckResult;

  @Column({ type: 'smallint', nullable: true })
  public score!: number | null;

  @Column({ type: 'text', nullable: true })
  public findings!: string | null;

  @Column({ name: 'remediation_plan', type: 'text', nullable: true })
  public remediationPlan!: string | null;

  @Column({ name: 'remediation_due_at', type: 'timestamp', nullable: true })
  public remediationDueAt!: Date | null;

  @Column({ name: 'evidence_ids_json', type: 'text', nullable: true })
  public evidenceIdsJson!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;
}
