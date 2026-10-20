import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('user_profiles')
export class UserProfileEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  public firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 150 })
  public lastName!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  public fullName!: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  public avatarUrl?: string | null;

  @Column({ name: 'date_of_birth', type: 'varchar', length: 32, nullable: true })
  public dateOfBirth?: string | null;

  /** Giới tính: 1 = MALE, 2 = FEMALE, 3 = OTHER */
  @Column({ type: 'int', nullable: true })
  public gender?: number | null;

  @Column({ name: 'identity_number', type: 'varchar', length: 128, nullable: true })
  public identityNumber?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public address?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  public city?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  public country?: string | null;

  @Column({ type: 'text', nullable: true })
  public bio?: string | null;

  @Column({ name: 'preferred_locale', type: 'varchar', length: 16, default: 'vi' })
  public preferredLocale!: string;

  @Column({
    name: 'preferred_timezone',
    type: 'varchar',
    length: 64,
    default: 'Asia/Ho_Chi_Minh',
  })
  public preferredTimezone!: string;
}
