export const ORG_UNIT_TYPE = {
  HEADQUARTERS: 1,
  BRANCH: 2,
  DEPARTMENT: 3,
  TEAM: 4,
} as const;

export const ORGANIZATION_UNIT_TYPE = ORG_UNIT_TYPE;

export const ORG_UNIT_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  ARCHIVED: 3,
} as const;

export const ORGANIZATION_UNIT_STATUS = ORG_UNIT_STATUS;

export const DEFAULT_MAX_HIERARCHY_DEPTH = 10;
export const DEFAULT_INCLUDE_INACTIVE_IN_SCOPE = true;

export const ORGANIZATION_SETTING_KEYS = {
  MAX_DEPTH: 'organizations.hierarchy.max_depth',
  INCLUDE_INACTIVE_IN_SCOPE: 'organizations.hierarchy.include_inactive_in_scope',
} as const;

export const ORGANIZATION_CODE_TYPE_KEYS = {
  UNIT_TYPE: 'organizations.unit_type',
  STATUS: 'organizations.status',
} as const;

export const ORGANIZATION_EXPORT_LIST_HEADERS = [
  'STT',
  'ID',
  'Mã đơn vị',
  'Tên đơn vị / Phòng ban',
  'Loại đơn vị',
  'Mã đơn vị cấp trên',
  'Tên đơn vị cấp trên',
  'ID Người phụ trách',
  'Người phụ trách',
  'Trạng thái',
  'Mô tả chức năng / Địa chỉ',
] as const;

export const ORGANIZATION_EXPORT_TREE_HEADERS = [
  'STT',
  'Cấp độ (Depth)',
  'Sơ đồ phân cấp (Tree)',
  'Mã đơn vị',
  'Tên đơn vị / Phòng ban',
  'Loại đơn vị',
  'Mã đơn vị cấp trên',
  'Đường dẫn phân cấp (Path)',
  'Đơn vị con trực tiếp',
  'Tổng đơn vị nhánh dưới',
  'Người phụ trách',
  'Trạng thái',
  'Mô tả chức năng / Địa chỉ',
] as const;

export const ORGANIZATION_IMPORT_TEMPLATE_HEADERS = [
  'Mã đơn vị (*)',
  'Tên đơn vị / Phòng ban (*)',
  'Loại đơn vị (HEADQUARTERS/BRANCH/DEPARTMENT/TEAM)',
  'Mã đơn vị cấp trên (Parent Code)',
  'Người phụ trách (ID hoặc Username/Email)',
  'Trạng thái (ACTIVE/INACTIVE/ARCHIVED)',
  'Mô tả chức năng / Địa chỉ',
] as const;
