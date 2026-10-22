import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  FILE_CATEGORY,
  FILE_STATUS,
  FILE_VISIBILITY,
  type FileCategoryCode,
  type FileStatusCode,
  type FileVisibilityCode,
} from '../contracts/index.js';

@Entity('files')
export class FileRecordEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Index()
  @Column({ name: 'folder_id', type: 'int', nullable: true })
  public folderId?: number | null;

  /** Tên hiển thị của file (khi đổi tên chỉ sửa trường này, không đổi storage_key) */
  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  public displayName!: string;

  /** Tên file gốc lúc tải lên */
  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  public originalName!: string;

  @Column({ name: 'storage_driver', type: 'varchar', length: 32, default: 'local' })
  public storageDriver!: string;

  /** Khóa đường dẫn vật lý bất biến dưới Storage (`files/YYYY/MM/DD/<uuid>.<ext>`) */
  @Index({ unique: true })
  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  public storageKey!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 150 })
  public mimeType!: string;

  @Column({ type: 'varchar', length: 32 })
  public extension!: string;

  @Index()
  @Column({ type: 'int', default: FILE_CATEGORY.OTHER })
  public category!: FileCategoryCode;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  public sizeBytes!: number | string;

  @Index()
  @Column({ name: 'checksum_sha256', type: 'varchar', length: 64 })
  public checksumSha256!: string;

  @Column({ type: 'int', default: FILE_VISIBILITY.PRIVATE })
  public visibility!: FileVisibilityCode;

  @Index()
  @Column({ type: 'int', default: FILE_STATUS.ACTIVE })
  public status!: FileStatusCode;

  @Index()
  @Column({ name: 'uploaded_by_user_id', type: 'int', nullable: true })
  public uploadedByUserId?: number | null;

  @Index()
  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Column({ name: 'usage_count', type: 'int', default: 0 })
  public usageCount!: number;

  @Column({ name: 'trashed_at', type: 'timestamp', nullable: true })
  public trashedAt?: Date | null;

  @Column({ name: 'trashed_by_user_id', type: 'int', nullable: true })
  public trashedByUserId?: number | null;

  @Index()
  @Column({ name: 'purge_after_at', type: 'timestamp', nullable: true })
  public purgeAfterAt?: Date | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson?: string | null;
}
