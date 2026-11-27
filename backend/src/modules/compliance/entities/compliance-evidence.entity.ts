import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  EVIDENCE_STATUS,
  type EvidenceStatus,
  type EvidenceType,
} from '../enum/compliance.enum.js';

@Entity({ name: 'compliance_evidences' })
@Index('idx_comp_evidences_control_type', ['controlId', 'evidenceType', 'status'])
@Index('idx_comp_evidences_vendor_status', ['vendorId', 'status'])
@Index('idx_comp_evidences_valid_until', ['status', 'validUntil'])
export class ComplianceEvidenceEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'control_id', type: 'int' })
  public controlId!: number;

  @Column({ name: 'check_history_id', type: 'int', nullable: true })
  public checkHistoryId!: number | null;

  @Column({ name: 'vendor_id', type: 'int', nullable: true })
  public vendorId!: number | null;

  @Column({ name: 'evidence_type', type: 'varchar', length: 24 })
  public evidenceType!: EvidenceType;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ type: 'text', nullable: true })
  public description!: string | null;

  @Column({ name: 'file_id', type: 'int', nullable: true })
  public fileId!: number | null;

  @Column({ name: 'audit_log_id', type: 'int', nullable: true })
  public auditLogId!: number | null;

  @Column({ name: 'log_reference', type: 'varchar', length: 255, nullable: true })
  public logReference!: string | null;

  @Column({ name: 'report_history_id', type: 'int', nullable: true })
  public reportHistoryId!: number | null;

  @Column({ name: 'report_code', type: 'varchar', length: 128, nullable: true })
  public reportCode!: string | null;

  @Column({ name: 'external_url', type: 'varchar', length: 500, nullable: true })
  public externalUrl!: string | null;

  @Column({ name: 'checksum_sha256', type: 'varchar', length: 128, nullable: true })
  public checksumSha256!: string | null;

  @Column({ name: 'collected_by_user_id', type: 'int' })
  public collectedByUserId!: number;

  @Column({ name: 'collected_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public collectedAt!: Date;

  @Column({ name: 'valid_until', type: 'timestamp', nullable: true })
  public validUntil!: Date | null;

  @Column({ type: 'varchar', length: 24, default: EVIDENCE_STATUS.VALID })
  public status!: EvidenceStatus;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;
}
