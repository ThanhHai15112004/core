export const CODE_ITEM_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type CodeItemStatusCode = (typeof CODE_ITEM_STATUS)[keyof typeof CODE_ITEM_STATUS];

export const CODE_STATUS_META: Record<
  number,
  { label: string; color: string; bg: string }
> = {
  [CODE_ITEM_STATUS.ACTIVE]: {
    label: 'Hoạt động (ACTIVE)',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.14)',
  },
  [CODE_ITEM_STATUS.INACTIVE]: {
    label: 'Ngừng dùng (INACTIVE)',
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.14)',
  },
};

export const CODES_SUGGESTED_COLORS = [
  '#2563EB',
  '#14B8A6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
] as const;

export const CODES_MODULE_FILTERS = [
  { value: '', label: 'Tất cả Module' },
  { value: 'users', label: 'users (Nhân sự)' },
  { value: 'roles', label: 'roles (Vai trò)' },
  { value: 'organizations', label: 'organizations (Tổ chức)' },
  { value: 'auth', label: 'auth (Xác thực)' },
  { value: 'files', label: 'files (Tệp & Media)' },
  { value: 'settings', label: 'settings (Cấu hình)' },
  { value: 'codes', label: 'codes (Danh mục)' },
  { value: 'common', label: 'common (Dùng chung)' },
] as const;

