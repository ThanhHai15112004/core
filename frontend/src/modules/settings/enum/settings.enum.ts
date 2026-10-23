export const SETTINGS_TAB = {
  SYSTEM_SETTINGS: 'SYSTEM_SETTINGS',
  FEATURE_FLAGS: 'FEATURE_FLAGS',
  I18N: 'I18N',
  SEQUENCES: 'SEQUENCES',
  MENUS: 'MENUS',
} as const;

export type SettingsTabId = (typeof SETTINGS_TAB)[keyof typeof SETTINGS_TAB];

export const SETTING_VALUE_TYPE = {
  TEXT: 1,
  NUMBER: 2,
  BOOLEAN: 3,
  JSON: 4,
} as const;

export const SETTING_VALUE_TYPE_OPTIONS = [
  { value: 1, code: 'TEXT', label: 'TEXT (Chuỗi ký tự)' },
  { value: 2, code: 'NUMBER', label: 'NUMBER (Số nguyên / Số thực)' },
  { value: 3, code: 'BOOLEAN', label: 'BOOLEAN (Bật / Tắt)' },
  { value: 4, code: 'JSON', label: 'JSON (Cấu trúc đối tượng / mảng)' },
] as const;

export const SETTING_ENVIRONMENT_OPTIONS = [
  { value: '', label: 'Toàn cục (GLOBAL — Không lọc môi trường)' },
  { value: 'development', label: 'Development (Môi trường phát triển)' },
  { value: 'staging', label: 'Staging (Môi trường kiểm thử)' },
  { value: 'production', label: 'Production (Môi trường vận hành thật)' },
] as const;

export const SEQUENCE_DATE_FORMAT_OPTIONS = [
  { value: 0, code: 'NONE', label: '0 - NONE (Không kèm ngày tháng)' },
  { value: 1, code: 'YYYY', label: '1 - YYYY (Ví dụ: 2026)' },
  { value: 2, code: 'YY', label: '2 - YY (Ví dụ: 26)' },
  { value: 3, code: 'YYYYMM', label: '3 - YYYYMM (Ví dụ: 202610)' },
  { value: 4, code: 'YYMM', label: '4 - YYMM (Ví dụ: 2610)' },
  { value: 5, code: 'YYYYMMDD', label: '5 - YYYYMMDD (Ví dụ: 20261023)' },
  { value: 6, code: 'YYMMDD', label: '6 - YYMMDD (Ví dụ: 261023)' },
] as const;

export const SEQUENCE_RESET_POLICY_OPTIONS = [
  { value: 1, code: 'NEVER', label: '1 - NEVER (Tăng liên tục vĩnh viễn)' },
  { value: 2, code: 'YEARLY', label: '2 - YEARLY (Reset mỗi đầu năm)' },
  { value: 3, code: 'MONTHLY', label: '3 - MONTHLY (Reset mỗi đầu tháng)' },
  { value: 4, code: 'DAILY', label: '4 - DAILY (Reset mỗi đầu ngày)' },
] as const;

export const MENU_POSITION_OPTIONS = [
  { value: 'SIDEBAR', label: 'SIDEBAR (Thanh điều hướng bên trái)' },
  { value: 'TOPBAR', label: 'TOPBAR (Thanh điều hướng phía trên)' },
  { value: 'FOOTER', label: 'FOOTER (Chân trang)' },
  { value: 'SYSTEM_CONSOLE', label: 'SYSTEM_CONSOLE (Bảng điều khiển vận hành)' },
] as const;

export const MENU_TYPE_OPTIONS = [
  { value: 1, code: 'GROUP', label: '1 - GROUP (Nhóm phân mục)' },
  { value: 2, code: 'ITEM', label: '2 - ITEM (Mục điều hướng nội bộ)' },
  { value: 3, code: 'EXTERNAL', label: '3 - EXTERNAL (Liên kết ngoài)' },
  { value: 4, code: 'ACTION', label: '4 - ACTION (Nút hành động nhanh)' },
] as const;

export const I18N_SUB_TAB = {
  LOCALES: 'LOCALES',
  TIMEZONES: 'TIMEZONES',
  TRANSLATIONS: 'TRANSLATIONS',
} as const;

export type I18nSubTabId = (typeof I18N_SUB_TAB)[keyof typeof I18N_SUB_TAB];

