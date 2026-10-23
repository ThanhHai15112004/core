export type FileManagerNavSection =
  | 'overview'
  | 'my_files'
  | 'recent'
  | 'shared'
  | 'starred'
  | 'pending_scan'
  | 'quarantined'
  | 'missing'
  | 'trash';

export const FOLDER_CARD_PALETTE: ReadonlyArray<{
  readonly main: string;
  readonly tab: string;
  readonly bg: string;
}> = [
  { main: '#3b82f6', tab: '#93c5fd', bg: '#eff6ff' },
  { main: '#f59e0b', tab: '#fcd34d', bg: '#fffbeb' },
  { main: '#8b5cf6', tab: '#c4b5fd', bg: '#f5f3ff' },
  { main: '#10b981', tab: '#6ee7b7', bg: '#ecfdf5' },
  { main: '#ec4899', tab: '#f9a8d4', bg: '#fdf2f8' },
  { main: '#06b6d4', tab: '#67e8f9', bg: '#ecfeff' },
];

export const FOLDER_COLORS: readonly string[] = [
  '#f59e0b',
  '#f97316',
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#ec4899',
];

export const FILE_CATEGORY_FILTER_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly label: string;
}> = [
  { value: '', label: 'Tất cả loại' },
  { value: '1', label: 'Hình ảnh' },
  { value: '2', label: 'Video' },
  { value: '3', label: 'Âm thanh' },
  { value: '4', label: 'Tài liệu' },
  { value: '5', label: 'Bảng tính' },
  { value: '6', label: 'Tệp nén' },
];

export const UPLOAD_MODULE_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly label: string;
}> = [
  { value: '', label: 'Module: Mặc định' },
  { value: 'users', label: 'Module: users' },
  { value: 'courses', label: 'Module: courses' },
  { value: 'organizations', label: 'Module: organizations' },
];
