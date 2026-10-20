export const CODES_ROUTES = {
  PREFIX: 'codes',
  BOOTSTRAP: 'bootstrap',
  SYNC: 'sync',
  EXPORT: 'export',
  IMPORT_TEMPLATE: 'import/template',
  IMPORT: 'import',
  BY_TYPE: ':typeCode',
  BY_TYPE_VALUES: ':typeCode/values',
  BY_TYPE_VALUES_REORDER: ':typeCode/values/reorder',
  BY_TYPE_VALUES_IMPORT: ':typeCode/values/import',
  BY_TYPE_VALUE_NUMERIC: ':typeCode/values/:numericCode',
  BY_TYPE_VALUE_USAGE: ':typeCode/values/:numericCode/usage',
} as const;
