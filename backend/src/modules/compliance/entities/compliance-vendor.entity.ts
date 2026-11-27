import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  COMPLIANCE_RISK_LEVEL,
  CONTROL_FREQUENCY,
  VENDOR_STATUS,
  type ComplianceRiskLevel,
  type ControlFrequency,
  type VendorCategory,
  type VendorStatus,
} from '../enum/compliance.enum.js';

@Entity({ name: 'compliance_vendors' })
@Index('idx_comp_vendors_code', ['vendorCode'], { unique: true })
@Index('idx_comp_vendors_cat_status', ['category', 'status'])
@Index('idx_comp_vendors_contract_end', ['status', 'contractEndDate'])
@Index('idx_comp_vendors_review_due', ['status', 'nextReviewDueAt'])
export class ComplianceVendorEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'vendor_code', type: 'varchar', length: 64 })
  public vendorCode!: string;

  @Column({ type: 'varchar', length: 160 })
  public name!: string;

  @Column({ type: 'varchar', length: 24 })
  public category!: VendorCategory;

  @Column({ type: 'varchar', length: 24, default: COMPLIANCE_RISK_LEVEL.MEDIUM })
  public criticality!: ComplianceRiskLevel;

  @Column({ type: 'varchar', length: 24, default: VENDOR_STATUS.ACTIVE })
  public status!: VendorStatus;

  @Column({ name: 'provider_entry_id', type: 'int', nullable: true })
  public providerEntryId!: number | null;

  @Column({ name: 'website_url', type: 'varchar', length: 255, nullable: true })
  public websiteUrl!: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 160, nullable: true })
  public contactEmail!: string | null;

  @Column({ name: 'owner_user_id', type: 'int', nullable: true })
  public ownerUserId!: number | null;

  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId!: number | null;

  @Column({ name: 'contract_start_date', type: 'timestamp', nullable: true })
  public contractStartDate!: Date | null;

  @Column({ name: 'contract_end_date', type: 'timestamp', nullable: true })
  public contractEndDate!: Date | null;

  @Column({ name: 'auto_renew', type: 'boolean', default: false })
  public autoRenew!: boolean;

  @Column({ name: 'review_frequency', type: 'varchar', length: 24, default: CONTROL_FREQUENCY.SEMI_ANNUAL })
  public reviewFrequency!: ControlFrequency;

  @Column({ name: 'last_reviewed_at', type: 'timestamp', nullable: true })
  public lastReviewedAt!: Date | null;

  @Column({ name: 'next_review_due_at', type: 'timestamp', nullable: true })
  public nextReviewDueAt!: Date | null;

  @Column({ name: 'dpa_signed', type: 'boolean', default: false })
  public dpaSigned!: boolean;

  @Column({ name: 'dpa_file_id', type: 'int', nullable: true })
  public dpaFileId!: number | null;

  @Column({ name: 'fallback_vendor_name', type: 'varchar', length: 160, nullable: true })
  public fallbackVendorName!: string | null;

  @Column({ name: 'fallback_strategy', type: 'text', nullable: true })
  public fallbackStrategy!: string | null;

  @Column({ name: 'migration_runbook', type: 'text', nullable: true })
  public migrationRunbook!: string | null;

  @Column({ name: 'rto_hours', type: 'int', nullable: true })
  public rtoHours!: number | null;

  @Column({ name: 'exit_plan_tested_at', type: 'timestamp', nullable: true })
  public exitPlanTestedAt!: Date | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  public updatedBy!: number | null;
}
