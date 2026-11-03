import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
} from '../enum/notifications.enum.js';

@Entity('notification_templates')
@Index('uq_notification_templates_code_channel_locale', ['code', 'channel', 'locale'], {
  unique: true,
})
@Index('idx_notification_templates_category', ['category'])
@Index('idx_notification_templates_org_unit_id', ['organizationUnitId'])
export class NotificationTemplateEntity extends TypeOrmBaseEntity {
  @Column({ type: 'varchar', length: 100 })
  public code!: string;

  @Column({ type: 'varchar', length: 200 })
  public name!: string;

  @Column({ type: 'int', default: NOTIFICATION_CHANNEL.EMAIL })
  public channel!: number;

  @Column({ type: 'int', default: NOTIFICATION_CATEGORY.SYSTEM })
  public category!: number;

  @Column({ type: 'varchar', length: 16, default: 'vi' })
  public locale!: string;

  @Column({
    name: 'template_type',
    type: 'varchar',
    length: 32,
    default: NOTIFICATION_TEMPLATE_TYPE.NOTIFICATION,
  })
  public templateType!: string;

  @Column({ name: 'document_format', type: 'varchar', length: 32, nullable: true })
  public documentFormat?: string | null;

  @Column({ type: 'int', default: 1 })
  public version!: number;

  @Column({ name: 'published_version', type: 'int', default: 1 })
  public publishedVersion!: number;

  @Column({
    type: 'varchar',
    length: 24,
    default: NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED,
  })
  public status!: string;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  public publishedAt?: Date | null;

  @Column({ name: 'published_by_user_id', type: 'int', nullable: true })
  public publishedByUserId?: number | null;

  @Column({ name: 'subject_template', type: 'varchar', length: 500, nullable: true })
  public subjectTemplate?: string | null;

  @Column({ name: 'body_template', type: 'text' })
  public bodyTemplate!: string;

  @Column({ name: 'html_template', type: 'text', nullable: true })
  public htmlTemplate?: string | null;

  @Column({ name: 'variables_json', type: 'text', nullable: true })
  public variablesJson?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  public isActive!: boolean;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;
}
