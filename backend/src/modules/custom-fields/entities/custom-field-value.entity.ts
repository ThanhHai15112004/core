import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import { CUSTOM_FIELD_DATA_TYPE, type CustomFieldDataType } from '@packages/kernel/index.js';

@Entity({ name: 'custom_field_values' })
@Index(
  'UQ_custom_field_values_entity_record_field',
  ['entityCode', 'recordId', 'fieldKey'],
  { unique: true },
)
@Index('IDX_custom_field_values_entity_record', ['entityCode', 'recordId'])
@Index('IDX_custom_field_values_indexed_text', ['entityCode', 'fieldKey', 'valueText'])
@Index('IDX_custom_field_values_indexed_number', ['entityCode', 'fieldKey', 'valueNumber'])
@Index('IDX_custom_field_values_indexed_date', ['entityCode', 'fieldKey', 'valueDate'])
@Index('IDX_custom_field_values_indexed_boolean', ['entityCode', 'fieldKey', 'valueBoolean'])
@Index('IDX_custom_field_values_indexed_option', ['entityCode', 'fieldKey', 'optionCode'])
export class CustomFieldValueEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'entity_code', type: 'varchar', length: 120 })
  entityCode!: string;

  @Column({ name: 'record_id', type: 'varchar', length: 120 })
  recordId!: string;

  @Column({ name: 'field_id', type: 'bigint' })
  fieldId!: string;

  @Column({ name: 'field_key', type: 'varchar', length: 100 })
  fieldKey!: string;

  @Column({
    name: 'data_type',
    type: 'varchar',
    length: 32,
    default: CUSTOM_FIELD_DATA_TYPE.TEXT,
  })
  dataType!: CustomFieldDataType;

  @Column({ name: 'value_text', type: 'varchar', length: 500, nullable: true })
  valueText!: string | null;

  @Column({
    name: 'value_number',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  valueNumber!: string | null;

  @Column({ name: 'value_date', type: 'varchar', length: 40, nullable: true })
  valueDate!: string | null;

  @Column({ name: 'value_boolean', type: 'boolean', nullable: true })
  valueBoolean!: boolean | null;

  @Column({ name: 'option_code', type: 'varchar', length: 120, nullable: true })
  optionCode!: string | null;

  @Column({ name: 'option_label', type: 'varchar', length: 200, nullable: true })
  optionLabel!: string | null;

  @Column({ name: 'value_json', type: 'text', nullable: true })
  valueJson!: string | null;

  @Column({ name: 'encrypted_value', type: 'text', nullable: true })
  encryptedValue!: string | null;

  @Column({ name: 'updated_by_user_id', type: 'bigint', nullable: true })
  updatedByUserId!: string | null;
}
