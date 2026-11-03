import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
} from '../enum/notifications.enum.js';

@Entity('notification_template_versions')
@Index('uq_notification_tpl_versions_tpl_ver', ['templateId', 'version'], {
  unique: true,
})
@Index('idx_notification_tpl_versions_code_ch_loc', ['code', 'channel', 'locale'])
export class NotificationTemplateVersionEntity extends TypeOrmBaseEntity {
  @Column({ name: 'template_id', type: 'int' })
  public templateId!: number;

  @Column({ type: 'varchar', length: 100 })
  public code!: string;

  @Column({ type: 'int', default: NOTIFICATION_CHANNEL.EMAIL })
  public channel!: number;

  @Column({ type: 'varchar', length: 16, default: 'vi' })
  public locale!: string;

  @Column({ type: 'int', default: 1 })
  public version!: number;

  @Column({
    type: 'varchar',
    length: 24,
    default: NOTIFICATION_TEMPLATE_VERSION_STATUS.DRAFT,
  })
  public status!: string;

  @Column({ type: 'varchar', length: 200 })
  public name!: string;

  @Column({
    name: 'template_type',
    type: 'varchar',
    length: 32,
    default: NOTIFICATION_TEMPLATE_TYPE.NOTIFICATION,
  })
  public templateType!: string;

  @Column({ name: 'document_format', type: 'varchar', length: 32, nullable: true })
  public documentFormat?: string | null;

  @Column({ name: 'subject_template', type: 'varchar', length: 500, nullable: true })
  public subjectTemplate?: string | null;

  @Column({ name: 'body_template', type: 'text' })
  public bodyTemplate!: string;

  @Column({ name: 'html_template', type: 'text', nullable: true })
  public htmlTemplate?: string | null;

  @Column({ name: 'variables_json', type: 'text', nullable: true })
  public variablesJson?: string | null;

  @Column({ name: 'change_note', type: 'varchar', length: 500, nullable: true })
  public changeNote?: string | null;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  public createdByUserId?: number | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  public publishedAt?: Date | null;

  @Column({ name: 'published_by_user_id', type: 'int', nullable: true })
  public publishedByUserId?: number | null;
}
