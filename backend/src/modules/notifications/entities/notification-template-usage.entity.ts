import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('notification_template_usages')
@Index('idx_notification_tpl_usages_code', ['templateCode'])
@Index('idx_notification_tpl_usages_module', ['moduleName'])
@Index('uq_notification_tpl_usages_code_mod_feat', ['templateCode', 'moduleName', 'featureCode'], {
  unique: true,
})
export class NotificationTemplateUsageEntity extends TypeOrmBaseEntity {
  @Column({ name: 'template_code', type: 'varchar', length: 100 })
  public templateCode!: string;

  @Column({ type: 'int', nullable: true })
  public channel?: number | null;

  @Column({ name: 'module_name', type: 'varchar', length: 64 })
  public moduleName!: string;

  @Column({ name: 'feature_code', type: 'varchar', length: 100 })
  public featureCode!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 64, nullable: true })
  public entityType?: string | null;

  @Column({ name: 'entity_id', type: 'varchar', length: 100, nullable: true })
  public entityId?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public description?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  public isActive!: boolean;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  public createdByUserId?: number | null;
}
