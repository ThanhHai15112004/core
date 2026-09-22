export const CONSOLE_STORAGE_KEYS = {
  THEME: 'core_sys_console_theme',
  LAST_SECTION: 'core_sys_console_last_section',
  NAV_COLLAPSED: 'core_sys_console_nav_collapsed',
} as const;

/** Chu kỳ tự cập nhật số liệu; người dùng không cần bấm làm mới. */
export const POLL_INTERVAL_MS = 5000;

export const resolvePackageIcon = (pkg?: { category?: string; icon?: string } | null): string => {
  if (!pkg) return 'packages';
  switch (pkg.category) {
    case 'cache':
      return 'cache';
    case 'logging':
      return 'logs';
    case 'queue':
      return 'messaging';
    case 'database':
      return 'database';
    case 'storage':
      return 'storage';
    case 'custom':
      return 'packages';
    default:
      return 'packages';
  }
};
