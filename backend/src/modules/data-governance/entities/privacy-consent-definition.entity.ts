import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  DATA_CLASSIFICATION_LEVEL,
  type DataClassificationLevel,
} from '../enum/data-governance.enum.js';

@Entity({ name: 'privacy_consent_definitions' })
@Index('idx_dg_consent_def_purpose_ver', ['purposeCode', 'policyVersion'], { unique: true })
@Index('idx_dg_consent_def_active', ['isActive', 'purposeCode'])
export class PrivacyConsentDefinitionEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'purpose_code', type: 'varchar', length: 64 })
  public purposeCode!: string;

  @Column({ name: 'policy_version', type: 'varchar', length: 32 })
  public policyVersion!: string;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ type: 'varchar', length: 1000 })
  public description!: string;

  @Column({
    name: 'classification_level',
    type: 'varchar',
    length: 24,
    default: DATA_CLASSIFICATION_LEVEL.INTERNAL,
  })
  public classificationLevel!: DataClassificationLevel;

  @Column({ name: 'is_mandatory', type: 'boolean', default: false })
  public isMandatory!: boolean;

  @Column({ name: 'validity_days', type: 'int', nullable: true })
  public validityDays!: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  public isActive!: boolean;

  @Column({ name: 'published_at', type: 'timestamp' })
  public publishedAt!: Date;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
