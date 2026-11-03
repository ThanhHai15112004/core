import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import { CUSTOM_FIELD_STATUS, type CustomFieldStatusCode } from '@packages/kernel/index.js';

@Entity({ name: 'custom_field_options' })
@Index('UQ_custom_field_options_field_code', ['fieldId', 'optionCode'], { unique: true })
@Index('IDX_custom_field_options_field_sort', ['fieldId', 'status', 'sortOrder'])
export class CustomFieldOptionEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'field_id', type: 'bigint' })
  fieldId!: string;

  @Column({ name: 'option_code', type: 'varchar', length: 120 })
  optionCode!: string;

  @Column({ name: 'option_label', type: 'varchar', length: 200 })
  optionLabel!: string;

  @Column({ name: 'labels_json', type: 'text', nullable: true })
  labelsJson!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  color!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 1 })
  sortOrder!: number;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({
    type: 'smallint',
    default: CUSTOM_FIELD_STATUS.ACTIVE,
  })
  status!: CustomFieldStatusCode;
}
