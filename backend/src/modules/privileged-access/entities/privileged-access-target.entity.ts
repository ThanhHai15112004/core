import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  PRIVILEGED_SENSITIVITY_LEVEL,
  type PrivilegedSensitivityLevel,
  type PrivilegedTargetType,
} from '../enum/privileged-access.enum.js';

@Entity({ name: 'privileged_access_targets' })
@Index('idx_pam_targets_type_code', ['targetType', 'targetCode'], { unique: true })
@Index('idx_pam_targets_enabled', ['isEnabled', 'targetType'])
export class PrivilegedAccessTargetEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'target_type', type: 'varchar', length: 24 })
  public targetType!: PrivilegedTargetType;

  @Column({ name: 'target_code', type: 'varchar', length: 128 })
  public targetCode!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  public displayName!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({
    name: 'sensitivity_level',
    type: 'varchar',
    length: 24,
    default: PRIVILEGED_SENSITIVITY_LEVEL.HIGH,
  })
  public sensitivityLevel!: PrivilegedSensitivityLevel;

  @Column({ name: 'require_mfa_step_up', type: 'boolean', default: true })
  public requireMfaStepUp!: boolean;

  @Column({ name: 'require_approval', type: 'boolean', default: true })
  public requireApproval!: boolean;

  @Column({ name: 'auto_approve_allowed', type: 'boolean', default: false })
  public autoApproveAllowed!: boolean;

  @Column({ name: 'max_grant_minutes', type: 'int', default: 120 })
  public maxGrantMinutes!: number;

  @Column({ name: 'alert_on_use', type: 'boolean', default: true })
  public alertOnUse!: boolean;

  @Column({ name: 'review_interval_days', type: 'int', default: 90 })
  public reviewIntervalDays!: number;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  public isEnabled!: boolean;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
