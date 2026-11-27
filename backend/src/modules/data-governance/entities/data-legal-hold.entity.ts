import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  LEGAL_HOLD_STATUS,
  type LegalHoldScopeType,
  type LegalHoldStatusCode,
} from '../enum/data-governance.enum.js';

@Entity({ name: 'data_legal_holds' })
@Index('idx_dg_legal_holds_code', ['holdCode'], { unique: true })
@Index('idx_dg_legal_holds_status_scope', ['holdStatus', 'scopeType'])
@Index('idx_dg_legal_holds_user', ['targetUserId', 'holdStatus'])
@Index('idx_dg_legal_holds_resource', ['resourceType', 'resourceId', 'holdStatus'])
@Index('idx_dg_legal_holds_datatype', ['dataTypeCode', 'holdStatus'])
export class DataLegalHoldEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'hold_code', type: 'varchar', length: 64 })
  public holdCode!: string;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ name: 'case_reference', type: 'varchar', length: 120, nullable: true })
  public caseReference!: string | null;

  @Column({ type: 'varchar', length: 1000 })
  public reason!: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 24 })
  public scopeType!: LegalHoldScopeType;

  @Column({ name: 'target_user_id', type: 'int', nullable: true })
  public targetUserId!: number | null;

  @Column({ name: 'data_type_code', type: 'varchar', length: 96, nullable: true })
  public dataTypeCode!: string | null;

  @Column({ name: 'resource_type', type: 'varchar', length: 96, nullable: true })
  public resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'varchar', length: 128, nullable: true })
  public resourceId!: string | null;

  @Column({ name: 'hold_status', type: 'smallint', default: LEGAL_HOLD_STATUS.ACTIVE })
  public holdStatus!: LegalHoldStatusCode;

  @Column({ name: 'starts_at', type: 'timestamp' })
  public startsAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  public expiresAt!: Date | null;

  @Column({ name: 'created_by', type: 'int' })
  public createdBy!: number;

  @Column({ name: 'released_by', type: 'int', nullable: true })
  public releasedBy!: number | null;

  @Column({ name: 'released_at', type: 'timestamp', nullable: true })
  public releasedAt!: Date | null;

  @Column({ name: 'release_reason', type: 'varchar', length: 500, nullable: true })
  public releaseReason!: string | null;
}
