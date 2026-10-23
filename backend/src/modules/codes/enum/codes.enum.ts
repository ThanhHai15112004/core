export const CODES_EXPORT_HEADERS = [
  'STT',
  'Mã nhóm danh mục',
  'Tên nhóm danh mục',
  'Mã số',
  'Mã mục',
  'Mã hành vi',
  'Tên hiển thị (VI)',
  'Tên tiếng Anh (EN)',
  'Từ đồng nghĩa',
  'Thứ tự',
  'Trạng thái',
  'Nguồn',
] as const;

export const CODES_EXPORT_FORMAT = {
  CSV: 'csv',
  XLSX: 'xlsx',
} as const;

export type CodesExportFormatType = (typeof CODES_EXPORT_FORMAT)[keyof typeof CODES_EXPORT_FORMAT];

export const CODES_SETTING_KEYS = {
  IMPORT_MAX_ROWS: 'codes.import.max_rows',
  IMPORT_AUTO_CREATE_MISSING_TYPE: 'codes.import.auto_create_missing_type',
  EXPORT_DEFAULT_REPORT_TITLE: 'codes.export.default_report_title',
} as const;

export const CODES_AUDIT_META = {
  MODULE: 'codes',
  FEATURES: {
    TYPE_MANAGEMENT: 'code-type-management',
    VALUE_MANAGEMENT: 'code-value-management',
    LOOKUP_SYNC: 'code-lookup-sync',
    IMPORT: 'code-import',
    EXPORT: 'code-export',
  },
  ACTIONS: {
    CREATE_TYPE: 'codes.type.create',
    UPDATE_TYPE: 'codes.type.update',
    SYNC_MANIFESTS: 'codes.sync_manifests',
    CREATE_VALUE: 'codes.value.create',
    UPDATE_VALUE: 'codes.value.update',
    REORDER_VALUES: 'codes.value.reorder',
    DELETE_VALUE: 'codes.value.delete',
    BULK_IMPORT: 'codes.value.bulk_import',
    EXPORT: 'codes.export',
  },
} as const;
