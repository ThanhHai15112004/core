import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { FILE_PERMISSION_SUBJECT, type FilePermissionSubjectCode } from '../contracts/index.js';

@Entity('file_permissions')
@Index('uq_file_permissions_target', ['fileId', 'subjectType', 'subjectId'], {
  unique: true,
})
export class FilePermissionEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'file_id', type: 'int' })
  public fileId!: number;

  @Index()
  @Column({ name: 'subject_type', type: 'int', default: FILE_PERMISSION_SUBJECT.USER })
  public subjectType!: FilePermissionSubjectCode;

  @Index()
  @Column({ name: 'subject_id', type: 'varchar', length: 100 })
  public subjectId!: string;

  @Column({ name: 'can_view', type: 'boolean', default: true })
  public canView!: boolean;

  @Column({ name: 'can_download', type: 'boolean', default: false })
  public canDownload!: boolean;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  public expiresAt?: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public note?: string | null;

  @Column({ name: 'granted_by_user_id', type: 'int', nullable: true })
  public grantedByUserId?: number | null;
}
