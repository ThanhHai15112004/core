import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';

@Entity({ name: 'custom_field_histories' })
@Index('IDX_custom_field_histories_field_created', ['fieldId', 'createdAt'])
@Index('IDX_custom_field_histories_entity_field', ['entityCode', 'fieldKey', 'createdAt'])
export class CustomFieldHistoryEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'field_id', type: 'bigint' })
  fieldId!: string;

  @Column({ name: 'entity_code', type: 'varchar', length: 120 })
  entityCode!: string;

  @Column({ name: 'field_key', type: 'varchar', length: 100 })
  fieldKey!: string;

  @Column({ name: 'action_type', type: 'varchar', length: 60 })
  actionType!: string;

  @Column({ name: 'changed_fields_json', type: 'text', nullable: true })
  changedFieldsJson!: string | null;

  @Column({ name: 'before_snapshot_json', type: 'text', nullable: true })
  beforeSnapshotJson!: string | null;

  @Column({ name: 'after_snapshot_json', type: 'text', nullable: true })
  afterSnapshotJson!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ name: 'actor_user_id', type: 'bigint', nullable: true })
  actorUserId!: string | null;
}
