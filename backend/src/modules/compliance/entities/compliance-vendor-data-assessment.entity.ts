import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import { DATA_CLASSIFICATION_LEVEL, type DataClassificationLevel } from '@packages/kernel/index.js';
import {
  ASSESSMENT_APPROVAL_STATUS,
  COMPLIANCE_RISK_LEVEL,
  DATA_FLOW_DIRECTION,
  type AssessmentApprovalStatus,
  type ComplianceRiskLevel,
  type DataFlowDirection,
} from '../enum/compliance.enum.js';

@Entity({ name: 'compliance_vendor_data_assessments' })
@Index('idx_comp_vda_vendor_status', ['vendorId', 'approvalStatus', 'riskLevel'])
export class ComplianceVendorDataAssessmentEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'vendor_id', type: 'int' })
  public vendorId!: number;

  @Column({ name: 'data_category', type: 'varchar', length: 120 })
  public dataCategory!: string;

  @Column({
    name: 'classification_level',
    type: 'varchar',
    length: 24,
    default: DATA_CLASSIFICATION_LEVEL.INTERNAL,
  })
  public classificationLevel!: DataClassificationLevel;

  @Column({ name: 'allowed_data_fields_json', type: 'text', nullable: true })
  public allowedDataFieldsJson!: string | null;

  @Column({ name: 'prohibited_data_fields_json', type: 'text', nullable: true })
  public prohibitedDataFieldsJson!: string | null;

  @Column({ name: 'processing_purpose', type: 'varchar', length: 500 })
  public processingPurpose!: string;

  @Column({
    name: 'data_flow_direction',
    type: 'varchar',
    length: 24,
    default: DATA_FLOW_DIRECTION.OUTBOUND,
  })
  public dataFlowDirection!: DataFlowDirection;

  @Column({ name: 'storage_regions_json', type: 'text', nullable: true })
  public storageRegionsJson!: string | null;

  @Column({ name: 'cross_border_transfer', type: 'boolean', default: false })
  public crossBorderTransfer!: boolean;

  @Column({ name: 'transfer_mechanism', type: 'varchar', length: 160, nullable: true })
  public transferMechanism!: string | null;

  @Column({ name: 'retention_days', type: 'int', nullable: true })
  public retentionDays!: number | null;

  @Column({ name: 'encryption_in_transit', type: 'boolean', default: true })
  public encryptionInTransit!: boolean;

  @Column({ name: 'encryption_at_rest', type: 'boolean', default: true })
  public encryptionAtRest!: boolean;

  @Column({ name: 'subprocessors_json', type: 'text', nullable: true })
  public subprocessorsJson!: string | null;

  @Column({
    name: 'risk_level',
    type: 'varchar',
    length: 24,
    default: COMPLIANCE_RISK_LEVEL.MEDIUM,
  })
  public riskLevel!: ComplianceRiskLevel;

  @Column({
    name: 'approval_status',
    type: 'varchar',
    length: 24,
    default: ASSESSMENT_APPROVAL_STATUS.PENDING,
  })
  public approvalStatus!: AssessmentApprovalStatus;

  @Column({ name: 'reviewed_by_user_id', type: 'int', nullable: true })
  public reviewedByUserId!: number | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  public reviewedAt!: Date | null;

  @Column({ name: 'next_review_due_at', type: 'timestamp', nullable: true })
  public nextReviewDueAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  public notes!: string | null;
}
