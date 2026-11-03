import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('record_comments')
@Index(['entityType', 'entityId', 'createdAt'])
export class RecordCommentEntity extends TypeOrmBaseEntity {
  @Column({ name: 'entity_type', type: 'varchar', length: 64 })
  public entityType!: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 128 })
  public entityId!: string;

  @Index()
  @Column({ name: 'workflow_instance_id', type: 'int', nullable: true })
  public workflowInstanceId?: number | null;

  @Index()
  @Column({ name: 'parent_comment_id', type: 'int', nullable: true })
  public parentCommentId?: number | null;

  @Column({ type: 'text' })
  public content!: string;

  @Column({ name: 'is_internal', type: 'boolean', default: false })
  public isInternal!: boolean;

  @Column({ name: 'author_user_id', type: 'int' })
  public authorUserId!: number;

  @Column({ name: 'mentioned_user_ids_json', type: 'text', nullable: true })
  public mentionedUserIdsJson?: string | null;

  @Column({ name: 'attachment_file_ids_json', type: 'text', nullable: true })
  public attachmentFileIdsJson?: string | null;

  @Column({ name: 'is_edited', type: 'boolean', default: false })
  public isEdited!: boolean;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  public isDeleted!: boolean;

  @Column({ name: 'deleted_by_user_id', type: 'int', nullable: true })
  public deletedByUserId?: number | null;
}
