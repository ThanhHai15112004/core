import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  PRIVILEGED_GRANT_STATUS,
  type PrivilegedGrantStatusCode,
  type PrivilegedTargetType,
} from '../enum/privileged-access.enum.js';

@Entity({ name: 'privileged_access_grants' })
@Index('idx_pam_grants_code', ['grantCode'], { unique: true })
@Index('idx_pam_grants_user_status', ['userId', 'status'])
@Index('idx_pam_grants_status_expires', ['status', 'expiresAt'])
@Index('idx_pam_grants_target', ['targetType', 'targetCode'])
export class PrivilegedAccessGrantEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'grant_code', type: 'varchar', length: 64 })
  public grantCode!: string;

  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ name: 'target_type', type: 'varchar', length: 24 })
  public targetType!: PrivilegedTargetType;

  @Column({ name: 'target_code', type: 'varchar', length: 128 })
  public targetCode!: string;

  @Column({ name: 'role_id', type: 'int', nullable: true })
  public roleId!: number | null;

  @Column({ type: 'varchar', length: 1000 })
  public reason!: string;

  @Column({ name: 'ticket_ref', type: 'varchar', length: 120, nullable: true })
  public ticketRef!: string | null;

  @Column({ name: 'duration_minutes', type: 'int' })
  public durationMinutes!: number;

  @Column({ type: 'smallint', default: PRIVILEGED_GRANT_STATUS.PENDING_APPROVAL })
  public status!: PrivilegedGrantStatusCode;

  @Column({ name: 'requires_approval', type: 'boolean', default: true })
  public requiresApproval!: boolean;

  @Column({ name: 'requested_by', type: 'int' })
  public requestedBy!: number;

  @Column({ name: 'requested_at', type: 'timestamp' })
  public requestedAt!: Date;

  @Column({ name: 'approved_by', type: 'int', nullable: true })
  public approvedBy!: number | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  public approvedAt!: Date | null;

  @Column({ name: 'approval_comment', type: 'varchar', length: 500, nullable: true })
  public approvalComment!: string | null;

  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  public startsAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  public expiresAt!: Date | null;

  @Column({ name: 'revoked_by', type: 'int', nullable: true })
  public revokedBy!: number | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  public revokedAt!: Date | null;

  @Column({ name: 'revoke_reason', type: 'varchar', length: 500, nullable: true })
  public revokeReason!: string | null;

  @Column({ name: 'auto_revoked', type: 'boolean', default: false })
  public autoRevoked!: boolean;

  @Column({ name: 'step_up_verified', type: 'boolean', default: false })
  public stepUpVerified!: boolean;
}
