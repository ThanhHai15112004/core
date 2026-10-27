import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import { USER_STATUS, type UserStatusCode } from '../contracts/index.js';

@Entity('users')
export class UserEntity extends VersionedTypeOrmEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public username!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public email!: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  public phone?: string | null;

  @Index({ unique: true })
  @Column({ name: 'phone_hash', type: 'varchar', length: 64, nullable: true })
  public phoneHash?: string | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  public passwordHash!: string;

  /** Trạng thái: 1 = ACTIVE, 2 = INACTIVE, 3 = LOCKED, 4 = ARCHIVED */
  @Index()
  @Column({ type: 'int', default: USER_STATUS.ACTIVE })
  public status!: UserStatusCode;

  @Column({ name: 'email_verified_at', type: 'timestamp', nullable: true })
  public emailVerifiedAt?: Date | null;

  @Column({ name: 'phone_verified_at', type: 'timestamp', nullable: true })
  public phoneVerifiedAt?: Date | null;

  @Column({ name: 'locked_until', type: 'timestamp', nullable: true })
  public lockedUntil?: Date | null;

  @Column({ name: 'lock_reason', type: 'varchar', length: 255, nullable: true })
  public lockReason?: string | null;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  public failedLoginAttempts!: number;

  @Column({ name: 'mfa_enabled', type: 'boolean', default: false })
  public mfaEnabled!: boolean;

  @Index()
  @Column({ name: 'primary_organization_unit_id', type: 'int', nullable: true })
  public primaryOrganizationUnitId?: number | null;

  @Index()
  @Column({ name: 'manager_id', type: 'int', nullable: true })
  public managerId?: number | null;

  @Index()
  @Column({ name: 'temporary_manager_id', type: 'int', nullable: true })
  public temporaryManagerId?: number | null;

  @Column({ name: 'temporary_manager_from', type: 'timestamp', nullable: true })
  public temporaryManagerFrom?: Date | null;

  @Column({ name: 'temporary_manager_until', type: 'timestamp', nullable: true })
  public temporaryManagerUntil?: Date | null;

  @Column({ name: 'password_changed_at', type: 'timestamp', nullable: true })
  public passwordChangedAt?: Date | null;

  @Column({ name: 'password_history_hashes_json', type: 'text', nullable: true })
  public passwordHistoryHashesJson?: string | null;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  public lastLoginAt?: Date | null;

  @Column({ name: 'archived_at', type: 'timestamp', nullable: true })
  public archivedAt?: Date | null;
}
