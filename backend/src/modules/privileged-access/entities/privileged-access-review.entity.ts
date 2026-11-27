import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  ACCESS_REVIEW_STATUS,
  type AccessReviewStatusCode,
} from '../enum/privileged-access.enum.js';

@Entity({ name: 'privileged_access_reviews' })
@Index('idx_pam_reviews_code', ['reviewCode'], { unique: true })
@Index('idx_pam_reviews_status_due', ['status', 'dueAt'])
export class PrivilegedAccessReviewEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'review_code', type: 'varchar', length: 64 })
  public reviewCode!: string;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'trigger_source', type: 'varchar', length: 24, default: 'MANUAL' })
  public triggerSource!: string;

  @Column({ type: 'smallint', default: ACCESS_REVIEW_STATUS.OPEN })
  public status!: AccessReviewStatusCode;

  @Column({ name: 'due_at', type: 'timestamp' })
  public dueAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'total_items', type: 'int', default: 0 })
  public totalItems!: number;

  @Column({ name: 'decided_items', type: 'int', default: 0 })
  public decidedItems!: number;

  @Column({ name: 'kept_items', type: 'int', default: 0 })
  public keptItems!: number;

  @Column({ name: 'revoked_items', type: 'int', default: 0 })
  public revokedItems!: number;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  public createdBy!: number | null;
}
