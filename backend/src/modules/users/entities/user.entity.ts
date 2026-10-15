import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import { USER_STATUS, type UserStatusCode } from '../contracts/index.js';

@Entity('users')
export class UserEntity extends VersionedTypeOrmEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public username!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  public email!: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  public phone?: string | null;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  public firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 150 })
  public lastName!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  public fullName!: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  public avatarUrl?: string | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  public passwordHash!: string;

  /** Trạng thái: 1 = ACTIVE, 2 = INACTIVE, 3 = LOCKED, 4 = ARCHIVED */
  @Index()
  @Column({ type: 'int', default: USER_STATUS.ACTIVE })
  public status!: UserStatusCode;

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

  @Column({ name: 'password_changed_at', type: 'timestamp', nullable: true })
  public passwordChangedAt?: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  public lastLoginAt?: Date | null;

  @Column({ name: 'archived_at', type: 'timestamp', nullable: true })
  public archivedAt?: Date | null;
}
