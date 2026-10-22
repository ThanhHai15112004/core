import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('file_folders')
export class FileFolderEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @Column({ type: 'varchar', length: 255 })
  public slug!: string;

  @Index()
  @Column({ name: 'parent_id', type: 'int', nullable: true })
  public parentId?: number | null;

  @Column({ name: 'folder_path', type: 'varchar', length: 1000, default: '/' })
  public folderPath!: string;

  @Index()
  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Index()
  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  public createdByUserId?: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description?: string | null;
}
