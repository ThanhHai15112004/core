import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import { CONSENT_STATUS, type ConsentStatus } from '../enum/data-governance.enum.js';

@Entity({ name: 'privacy_user_consents' })
@Index('idx_dg_user_consents_user_purpose', ['userId', 'purposeCode', 'policyVersion'])
@Index('idx_dg_user_consents_status_exp', ['consentStatus', 'expiresAt'])
export class PrivacyUserConsentEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ name: 'purpose_code', type: 'varchar', length: 64 })
  public purposeCode!: string;

  @Column({ name: 'policy_version', type: 'varchar', length: 32 })
  public policyVersion!: string;

  @Column({
    name: 'consent_status',
    type: 'varchar',
    length: 24,
    default: CONSENT_STATUS.GRANTED,
  })
  public consentStatus!: ConsentStatus;

  @Column({ name: 'granted_at', type: 'timestamp' })
  public grantedAt!: Date;

  @Column({ name: 'withdrawn_at', type: 'timestamp', nullable: true })
  public withdrawnAt!: Date | null;

  @Column({ name: 'withdraw_reason', type: 'varchar', length: 500, nullable: true })
  public withdrawReason!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  public expiresAt!: Date | null;

  @Column({ name: 'collection_source', type: 'varchar', length: 64, default: 'PORTAL' })
  public collectionSource!: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  public userAgent!: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson!: string | null;

  @Column({ name: 'recorded_by', type: 'int', nullable: true })
  public recordedBy!: number | null;
}
