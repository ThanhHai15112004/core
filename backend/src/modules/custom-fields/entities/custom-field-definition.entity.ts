import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  CUSTOM_FIELD_DATA_TYPE,
  CUSTOM_FIELD_STATUS,
  type CustomFieldDataType,
  type CustomFieldStatusCode,
} from '@packages/kernel/index.js';

@Entity({ name: 'custom_field_definitions' })
@Index('UQ_custom_field_definitions_entity_field_key', ['entityCode', 'fieldKey'], { unique: true })
@Index('IDX_custom_field_definitions_entity_status', ['entityCode', 'status', 'sortOrder'])
export class CustomFieldDefinitionEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'entity_code', type: 'varchar', length: 120 })
  entityCode!: string;

  @Column({ name: 'field_key', type: 'varchar', length: 100 })
  fieldKey!: string;

  @Column({ type: 'varchar', length: 80, default: 'custom' })
  module!: string;

  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({
    name: 'data_type',
    type: 'varchar',
    length: 32,
    default: CUSTOM_FIELD_DATA_TYPE.TEXT,
  })
  dataType!: CustomFieldDataType;

  @Column({ name: 'default_value_json', type: 'text', nullable: true })
  defaultValueJson!: string | null;

  @Column({ name: 'validation_rules_json', type: 'text', nullable: true })
  validationRulesJson!: string | null;

  @Column({ name: 'code_type_code', type: 'varchar', length: 120, nullable: true })
  codeTypeCode!: string | null;

  @Column({ name: 'is_required', type: 'boolean', default: false })
  isRequired!: boolean;

  @Column({ name: 'is_indexed', type: 'boolean', default: false })
  isIndexed!: boolean;

  @Column({ name: 'show_in_api', type: 'boolean', default: true })
  showInApi!: boolean;

  @Column({ name: 'show_in_list', type: 'boolean', default: true })
  showInList!: boolean;

  @Column({ name: 'show_in_detail', type: 'boolean', default: true })
  showInDetail!: boolean;

  @Column({ name: 'is_sensitive', type: 'boolean', default: false })
  isSensitive!: boolean;

  @Column({ name: 'view_permission', type: 'varchar', length: 120, nullable: true })
  viewPermission!: string | null;

  @Column({ name: 'edit_permission', type: 'varchar', length: 120, nullable: true })
  editPermission!: string | null;

  @Column({ name: 'allowed_view_roles_json', type: 'text', nullable: true })
  allowedViewRolesJson!: string | null;

  @Column({ name: 'allowed_edit_roles_json', type: 'text', nullable: true })
  allowedEditRolesJson!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 1 })
  sortOrder!: number;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({
    type: 'smallint',
    default: CUSTOM_FIELD_STATUS.ACTIVE,
  })
  status!: CustomFieldStatusCode;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  updatedBy!: number | null;
}
