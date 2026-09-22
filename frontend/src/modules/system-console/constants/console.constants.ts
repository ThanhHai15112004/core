import type { NavigationItem } from '../types/console.types';

export const CONSOLE_STORAGE_KEYS = {
  THEME: 'core_sys_console_theme',
  LAST_SECTION: 'core_sys_console_last_section',
} as const;

/** Nhãn lấy qua i18n: `nav.<id>`. */
export const CONSOLE_NAV_ITEMS: NavigationItem[] = [
  {
    id: 'overview',
    icon: 'overview',
  },
  {
    id: 'runtime',
    icon: 'runtime',
  },
  {
    id: 'packages',
    icon: 'packages',
  },
  {
    id: 'logs',
    icon: 'logs',
  },
  {
    id: 'worker',
    icon: 'worker',
  },
  {
    id: 'scheduler',
    icon: 'scheduler',
  },
  {
    id: 'database',
    icon: 'database',
  },
  {
    id: 'cache',
    icon: 'cache',
  },
  {
    id: 'security',
    icon: 'security',
  },
];

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
