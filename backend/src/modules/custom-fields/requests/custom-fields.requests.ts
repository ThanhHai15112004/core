import { z } from 'zod';
import {
  booleanQueryParam,
  createPaginationQuerySchema,
  optionalQueryParam,
} from '@packages/http/index.js';
import {
  CUSTOM_FIELD_DATA_TYPE,
  CUSTOM_FIELD_STATUS,
  type CustomFieldDataType,
  type CustomFieldStatusCode,
} from '@packages/kernel/index.js';

export const CustomFieldDataTypeSchema = z.preprocess(
  (v) => {
    if (typeof v === 'number') {
      const map: Record<number, CustomFieldDataType> = {
        1: CUSTOM_FIELD_DATA_TYPE.TEXT,
        2: CUSTOM_FIELD_DATA_TYPE.NUMBER,
        3: CUSTOM_FIELD_DATA_TYPE.DATE,
        4: CUSTOM_FIELD_DATA_TYPE.BOOLEAN,
        5: CUSTOM_FIELD_DATA_TYPE.SELECT,
      };
      return map[v] ?? v;
    }
    return typeof v === 'string' ? v.trim().toUpperCase() : v;
  },
  z.enum([
    CUSTOM_FIELD_DATA_TYPE.TEXT,
    CUSTOM_FIELD_DATA_TYPE.NUMBER,
    CUSTOM_FIELD_DATA_TYPE.DATE,
    CUSTOM_FIELD_DATA_TYPE.BOOLEAN,
    CUSTOM_FIELD_DATA_TYPE.SELECT,
  ]),
);

export const CustomFieldStatusSchema = z.preprocess(
  (v) => (v !== undefined ? Number(v) : undefined),
  z.union([z.literal(CUSTOM_FIELD_STATUS.ACTIVE), z.literal(CUSTOM_FIELD_STATUS.INACTIVE)]),
);

export const CustomFieldOptionItemSchema = z
  .object({
    optionCode: z.string().min(1).max(120).optional(),
    value: z.string().min(1).max(120).optional(),
    label: z.string().min(1).max(200),
    labels: z.record(z.string(), z.string()).optional(),
    color: z.string().max(40).nullable().optional(),
    sortOrder: z.coerce.number().int().min(1).optional(),
    isDefault: z.boolean().optional(),
    status: CustomFieldStatusSchema.optional().default(CUSTOM_FIELD_STATUS.ACTIVE),
  })
  .transform((item) => ({
    optionCode: (item.optionCode ?? item.value ?? 'OPT_1').trim(),
    label: item.label.trim(),
    ...(item.labels ? { labels: item.labels } : {}),
    color: item.color ?? null,
    sortOrder: item.sortOrder ?? 1,
    isDefault: Boolean(item.isDefault),
    status: (item.status ?? CUSTOM_FIELD_STATUS.ACTIVE) as CustomFieldStatusCode,
  }));

export const CustomFieldValidationRulesSchema = z
  .object({
    minLength: z.coerce.number().int().min(0).optional(),
    maxLength: z.coerce.number().int().min(1).optional(),
    pattern: z.string().max(500).optional(),
    min: z.coerce.number().optional(),
    max: z.coerce.number().optional(),
    integerOnly: z.boolean().optional(),
    minDate: z.string().max(40).optional(),
    maxDate: z.string().max(40).optional(),
  })
  .nullable()
  .optional();

export const ListCustomFieldDefinitionsQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  countMode: optionalQueryParam(z.enum(['exact', 'estimated', 'none'])),
  entityCode: optionalQueryParam(z.string().min(1).max(120)),
  module: optionalQueryParam(z.string().min(1).max(80)),
  dataType: optionalQueryParam(CustomFieldDataTypeSchema),
  isIndexed: booleanQueryParam(),
  isSensitive: booleanQueryParam(),
  showInApi: booleanQueryParam(),
  status: optionalQueryParam(z.coerce.number().int()),
  includeInactive: booleanQueryParam(),
  search: optionalQueryParam(z.string().max(150)),
});

export const CreateCustomFieldDefinitionRequestSchema = z.object({
  entityCode: z.string().min(1).max(120),
  fieldKey: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  module: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(180),
  description: z.string().max(500).nullable().optional(),
  dataType: CustomFieldDataTypeSchema,
  defaultValue: z.unknown().optional(),
  validationRules: CustomFieldValidationRulesSchema,
  options: z.array(CustomFieldOptionItemSchema).optional(),
  codeTypeCode: z.string().max(120).nullable().optional(),
  isRequired: z.boolean().optional(),
  isIndexed: z.boolean().optional(),
  showInApi: z.boolean().optional(),
  showInList: z.boolean().optional(),
  showInDetail: z.boolean().optional(),
  isSensitive: z.boolean().optional(),
  viewPermission: z.string().max(120).nullable().optional(),
  editPermission: z.string().max(120).nullable().optional(),
  allowedViewRoles: z.array(z.string().min(1)).optional(),
  allowedEditRoles: z.array(z.string().min(1)).optional(),
  sortOrder: z.coerce.number().int().optional(),
  status: CustomFieldStatusSchema.optional(),
  reason: z.string().max(500).nullable().optional(),
});

export const UpdateCustomFieldDefinitionRequestSchema = z.object({
  name: z.string().min(1).max(180).optional(),
  description: z.string().max(500).nullable().optional(),
  dataType: CustomFieldDataTypeSchema.optional(),
  defaultValue: z.unknown().optional(),
  validationRules: CustomFieldValidationRulesSchema,
  options: z.array(CustomFieldOptionItemSchema).optional(),
  codeTypeCode: z.string().max(120).nullable().optional(),
  isRequired: z.boolean().optional(),
  isIndexed: z.boolean().optional(),
  showInApi: z.boolean().optional(),
  showInList: z.boolean().optional(),
  showInDetail: z.boolean().optional(),
  isSensitive: z.boolean().optional(),
  viewPermission: z.string().max(120).nullable().optional(),
  editPermission: z.string().max(120).nullable().optional(),
  allowedViewRoles: z.array(z.string().min(1)).optional(),
  allowedEditRoles: z.array(z.string().min(1)).optional(),
  sortOrder: z.coerce.number().int().optional(),
  status: CustomFieldStatusSchema.optional(),
  reason: z.string().max(500).nullable().optional(),
});

export const UpdateCustomFieldOptionsRequestSchema = z.object({
  options: z.array(CustomFieldOptionItemSchema).min(1),
  reason: z.string().max(500).nullable().optional(),
});

export const SaveCustomFieldValuesRequestSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  mode: z.enum(['create', 'update']).optional().default('update'),
});

export const CustomFieldFilterConditionSchema = z.object({
  fieldKey: z.string().min(1).max(100),
  operator: z
    .enum(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'in'])
    .optional()
    .default('eq'),
  value: z.unknown(),
});

export const FilterRecordsByCustomFieldsRequestSchema = z.object({
  entityCode: z.string().min(1).max(120),
  filters: z.array(CustomFieldFilterConditionSchema).default([]),
});

export const ListCustomFieldHistoriesQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  countMode: optionalQueryParam(z.enum(['exact', 'estimated', 'none'])),
  fieldId: optionalQueryParam(z.coerce.number().int().min(1)),
  entityCode: optionalQueryParam(z.string().min(1)),
  fieldKey: optionalQueryParam(z.string().min(1)),
  actionType: optionalQueryParam(z.string().min(1)),
});

export type ListCustomFieldDefinitionsQuery = z.infer<
  typeof ListCustomFieldDefinitionsQuerySchema
>;
export type CreateCustomFieldDefinitionRequest = z.infer<
  typeof CreateCustomFieldDefinitionRequestSchema
>;
export type UpdateCustomFieldDefinitionRequest = z.infer<
  typeof UpdateCustomFieldDefinitionRequestSchema
>;
export type UpdateCustomFieldOptionsRequest = z.infer<
  typeof UpdateCustomFieldOptionsRequestSchema
>;
export type SaveCustomFieldValuesRequest = z.infer<typeof SaveCustomFieldValuesRequestSchema>;
export type FilterRecordsByCustomFieldsRequest = z.infer<
  typeof FilterRecordsByCustomFieldsRequestSchema
>;
export type ListCustomFieldHistoriesQuery = z.infer<typeof ListCustomFieldHistoriesQuerySchema>;
