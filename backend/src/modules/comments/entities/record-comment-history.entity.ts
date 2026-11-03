import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('record_comment_histories')
@Index(['commentId', 'editedAt'])
export class RecordCommentHistoryEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'comment_id', type: 'int' })
  public commentId!: number;

  @Column({ name: 'previous_content', type: 'text' })
  public previousContent!: string;

  @Column({ name: 'previous_attachment_file_ids_json', type: 'text', nullable: true })
  public previousAttachmentFileIdsJson?: string | null;

  @Column({ name: 'edited_by_user_id', type: 'int' })
  public editedByUserId!: number;

  @Column({ name: 'edit_reason', type: 'varchar', length: 500, nullable: true })
  public editReason?: string | null;

  @Column({ name: 'edited_at', type: 'timestamp' })
  public editedAt!: Date;
}
