import type { NavigationItem, RefreshIntervalMs } from '../types/console.types';

export const CONSOLE_STORAGE_KEYS = {
  THEME: 'core_sys_console_theme',
  REFRESH_INTERVAL: 'core_sys_console_refresh_ms',
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

export const REFRESH_OPTIONS: { value: RefreshIntervalMs }[] = [
  { value: 0 },
  { value: 5000 },
  { value: 10000 },
  { value: 30000 },
];

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
