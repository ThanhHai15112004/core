import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  DSAR_STATUS,
  type DsarExportFormat,
  type DsarRequestType,
  type DsarStatusCode,
} from '../enum/data-governance.enum.js';

@Entity({ name: 'privacy_dsar_requests' })
@Index('idx_dg_dsar_code', ['requestCode'], { unique: true })
@Index('idx_dg_dsar_subject_type', ['subjectUserId', 'requestType'])
@Index('idx_dg_dsar_status_due', ['status', 'dueAt'])
export class PrivacyDsarRequestEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'request_code', type: 'varchar', length: 64 })
  public requestCode!: string;

  @Column({ name: 'request_type', type: 'varchar', length: 24 })
  public requestType!: DsarRequestType;

  @Column({ name: 'subject_user_id', type: 'int' })
  public subjectUserId!: number;

  @Column({ name: 'requested_by', type: 'int' })
  public requestedBy!: number;

  @Column({ type: 'smallint', default: DSAR_STATUS.PENDING })
  public status!: DsarStatusCode;

  @Column({ name: 'export_format', type: 'varchar', length: 16, nullable: true })
  public exportFormat!: DsarExportFormat | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  public reason!: string | null;

  @Column({ name: 'requires_approval', type: 'boolean', default: false })
  public requiresApproval!: boolean;

  @Column({ name: 'approved_by', type: 'int', nullable: true })
  public approvedBy!: number | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  public approvedAt!: Date | null;

  @Column({ name: 'decision_comment', type: 'varchar', length: 500, nullable: true })
  public decisionComment!: string | null;

  @Column({ name: 'exceptions_json', type: 'text', nullable: true })
  public exceptionsJson!: string | null;

  @Column({ name: 'summary_json', type: 'text', nullable: true })
  public summaryJson!: string | null;

  @Column({ name: 'export_token', type: 'varchar', length: 128, nullable: true })
  public exportToken!: string | null;

  @Column({ name: 'export_expires_at', type: 'timestamp', nullable: true })
  public exportExpiresAt!: Date | null;

  @Column({ name: 'due_at', type: 'timestamp' })
  public dueAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;
}
