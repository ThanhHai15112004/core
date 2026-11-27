import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  DATA_CLASSIFICATION_LEVEL,
  type DataClassificationLevel,
  RETENTION_ACTION,
  type RetentionAction,
} from '../enum/data-governance.enum.js';

@Entity({ name: 'data_classifications' })
@Index('idx_dg_classifications_code', ['dataTypeCode'], { unique: true })
@Index('idx_dg_classifications_level_mod', ['classificationLevel', 'moduleName'])
@Index('idx_dg_classifications_enabled_ret', ['isEnabled', 'retentionDays'])
export class DataClassificationEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'data_type_code', type: 'varchar', length: 96 })
  public dataTypeCode!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  public displayName!: string;

  @Column({ name: 'module_name', type: 'varchar', length: 64 })
  public moduleName!: string;

  @Column({
    name: 'classification_level',
    type: 'varchar',
    length: 24,
    default: DATA_CLASSIFICATION_LEVEL.INTERNAL,
  })
  public classificationLevel!: DataClassificationLevel;

  @Column({ name: 'contains_pii', type: 'boolean', default: false })
  public containsPii!: boolean;

  @Column({ name: 'retention_days', type: 'int', default: 365 })
  public retentionDays!: number;

  @Column({
    name: 'retention_action',
    type: 'varchar',
    length: 24,
    default: RETENTION_ACTION.PURGE,
  })
  public retentionAction!: RetentionAction;

  @Column({ name: 'legal_basis', type: 'varchar', length: 160, nullable: true })
  public legalBasis!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  public isEnabled!: boolean;

  @Column({ name: 'last_enforced_at', type: 'timestamp', nullable: true })
  public lastEnforcedAt!: Date | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
