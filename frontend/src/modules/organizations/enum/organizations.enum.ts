export const ORG_UNIT_TYPE = {
  HEADQUARTERS: 1,
  BRANCH: 2,
  DEPARTMENT: 3,
  TEAM: 4,
} as const;

export const ORG_UNIT_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  ARCHIVED: 3,
} as const;

export const ORG_UNIT_TYPE_OPTIONS = [
  { code: 1, key: 'HEADQUARTERS', label: 'Trụ sở chính (HEADQUARTERS)', badgeColor: 'var(--primary)' },
  { code: 2, key: 'BRANCH', label: 'Chi nhánh (BRANCH)', badgeColor: 'var(--secondary)' },
  { code: 3, key: 'DEPARTMENT', label: 'Phòng ban (DEPARTMENT)', badgeColor: 'var(--accent)' },
  { code: 4, key: 'TEAM', label: 'Đội nhóm / Tổ chuyên môn (TEAM)', badgeColor: 'var(--status-success)' },
] as const;

export const ORG_UNIT_STATUS_OPTIONS = [
  { code: 1, key: 'ACTIVE', label: 'Đang hoạt động (ACTIVE)' },
  { code: 2, key: 'INACTIVE', label: 'Ngừng hoạt động (INACTIVE)' },
  { code: 3, key: 'ARCHIVED', label: 'Đã lưu trữ / Giải thể (ARCHIVED)' },
] as const;

export type OrgViewMode = 'split' | 'tree' | 'table';

export const ORG_VIEW_MODES: readonly { readonly id: OrgViewMode; readonly label: string }[] = [
  { id: 'split', label: 'Sơ đồ cây & Danh bạ' },
  { id: 'tree', label: 'Chỉ sơ đồ cây' },
  { id: 'table', label: 'Chỉ bảng danh bạ' },
] as const;
