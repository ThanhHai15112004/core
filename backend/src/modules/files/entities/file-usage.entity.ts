import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('file_usages')
@Index('uq_file_usages_target', ['fileId', 'moduleName', 'entityType', 'entityId', 'fieldName'], {
  unique: true,
})
export class FileUsageEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'file_id', type: 'int' })
  public fileId!: number;

  @Column({ name: 'module_name', type: 'varchar', length: 100 })
  public moduleName!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 100 })
  public entityType!: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 100 })
  public entityId!: string;

  @Column({ name: 'field_name', type: 'varchar', length: 100, default: 'default' })
  public fieldName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public note?: string | null;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  public createdByUserId?: number | null;
}
