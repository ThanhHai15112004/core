import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  DATA_CLASSIFICATION_LEVEL,
  type DataClassificationLevel,
  SENSITIVE_FIELD_MASK_STRATEGY,
  type SensitiveFieldMaskStrategy,
} from '../enum/data-governance.enum.js';

@Entity({ name: 'data_sensitive_fields' })
@Index('idx_dg_sensitive_fields_res_path', ['resourceType', 'fieldPath'], { unique: true })
@Index('idx_dg_sensitive_fields_enabled', ['isEnabled', 'resourceType'])
export class DataSensitiveFieldEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'resource_type', type: 'varchar', length: 96 })
  public resourceType!: string;

  @Column({ name: 'field_path', type: 'varchar', length: 128 })
  public fieldPath!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  public displayName!: string;

  @Column({
    name: 'classification_level',
    type: 'varchar',
    length: 24,
    default: DATA_CLASSIFICATION_LEVEL.CONFIDENTIAL,
  })
  public classificationLevel!: DataClassificationLevel;

  @Column({
    name: 'mask_strategy',
    type: 'varchar',
    length: 24,
    default: SENSITIVE_FIELD_MASK_STRATEGY.FULL,
  })
  public maskStrategy!: SensitiveFieldMaskStrategy;

  @Column({ name: 'redact_in_log', type: 'boolean', default: true })
  public redactInLog!: boolean;

  @Column({ name: 'mask_in_export', type: 'boolean', default: true })
  public maskInExport!: boolean;

  @Column({ name: 'required_permission', type: 'varchar', length: 128, nullable: true })
  public requiredPermission!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  public isEnabled!: boolean;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
