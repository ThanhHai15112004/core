import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  CONTROL_FREQUENCY,
  CONTROL_STATUS,
  type ControlCheckResult,
  type ControlFrequency,
  type ControlStatus,
} from '../enum/compliance.enum.js';

@Entity({ name: 'compliance_controls' })
@Index('idx_comp_controls_code', ['controlCode'], { unique: true })
@Index('idx_comp_controls_status_due', ['status', 'nextCheckDueAt'])
@Index('idx_comp_controls_owner_status', ['ownerUserId', 'status'])
@Index('idx_comp_controls_domain', ['domain', 'status'])
export class ComplianceControlEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'control_code', type: 'varchar', length: 64 })
  public controlCode!: string;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ type: 'text', nullable: true })
  public description!: string | null;

  @Column({ type: 'varchar', length: 64, default: 'GENERAL' })
  public domain!: string;

  @Column({ name: 'framework_tags_json', type: 'text', nullable: true })
  public frameworkTagsJson!: string | null;

  @Column({ name: 'owner_user_id', type: 'int', nullable: true })
  public ownerUserId!: number | null;

  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId!: number | null;

  @Column({ type: 'varchar', length: 24, default: CONTROL_FREQUENCY.QUARTERLY })
  public frequency!: ControlFrequency;

  @Column({ type: 'varchar', length: 24, default: CONTROL_STATUS.ACTIVE })
  public status!: ControlStatus;

  @Column({ name: 'last_checked_at', type: 'timestamp', nullable: true })
  public lastCheckedAt!: Date | null;

  @Column({ name: 'next_check_due_at', type: 'timestamp', nullable: true })
  public nextCheckDueAt!: Date | null;

  @Column({ name: 'last_check_result', type: 'varchar', length: 24, nullable: true })
  public lastCheckResult!: ControlCheckResult | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
