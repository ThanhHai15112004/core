import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  ACCESS_REVIEW_DECISION,
  type AccessReviewDecisionCode,
  type PrivilegedReviewSource,
  type PrivilegedTargetType,
} from '../enum/privileged-access.enum.js';

@Entity({ name: 'privileged_access_review_items' })
@Index('idx_pam_review_items_review_dec', ['reviewId', 'decision'])
@Index('idx_pam_review_items_user_target', ['userId', 'targetCode'])
export class PrivilegedAccessReviewItemEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'review_id', type: 'int' })
  public reviewId!: number;

  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ type: 'varchar', length: 128 })
  public username!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public email!: string | null;

  @Column({ name: 'grant_source', type: 'varchar', length: 32 })
  public grantSource!: PrivilegedReviewSource;

  @Column({ name: 'target_type', type: 'varchar', length: 24 })
  public targetType!: PrivilegedTargetType;

  @Column({ name: 'target_code', type: 'varchar', length: 128 })
  public targetCode!: string;

  @Column({ name: 'role_id', type: 'int', nullable: true })
  public roleId!: number | null;

  @Column({ name: 'grant_id', type: 'int', nullable: true })
  public grantId!: number | null;

  @Column({ name: 'break_glass_id', type: 'int', nullable: true })
  public breakGlassId!: number | null;

  @Column({ type: 'smallint', default: ACCESS_REVIEW_DECISION.PENDING })
  public decision!: AccessReviewDecisionCode;

  @Column({ name: 'decided_by', type: 'int', nullable: true })
  public decidedBy!: number | null;

  @Column({ name: 'decided_at', type: 'timestamp', nullable: true })
  public decidedAt!: Date | null;

  @Column({ name: 'decision_note', type: 'varchar', length: 500, nullable: true })
  public decisionNote!: string | null;

  @Column({ name: 'enforcement_applied', type: 'boolean', default: false })
  public enforcementApplied!: boolean;

  @Column({ name: 'enforcement_error', type: 'varchar', length: 500, nullable: true })
  public enforcementError!: string | null;
}
