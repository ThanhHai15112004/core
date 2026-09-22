import type { NavigationItem } from '../types/console.types';

export const CONSOLE_STORAGE_KEYS = {
  THEME: 'core_sys_console_theme',
  REFRESH_INTERVAL: 'core_sys_console_refresh_ms',
  LAST_SECTION: 'core_sys_console_last_section',
} as const;

export const CONSOLE_NAV_ITEMS: NavigationItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'overview',
    description: 'System-wide health, runtimes status, and metrics summary',
  },
  {
    id: 'runtime',
    label: 'Runtime Monitor',
    icon: 'runtime',
    description: 'API, Worker, Scheduler, and CLI execution runtimes',
  },
  {
    id: 'packages',
    label: 'Packages',
    icon: 'packages',
    description: 'Manageable infrastructure packages and live actions',
  },
  {
    id: 'logs',
    label: 'Log Viewer',
    icon: 'logs',
    description: 'Structured log inspection, level filters, and live stream',
  },
  {
    id: 'worker',
    label: 'Worker & Queue',
    icon: 'worker',
    description: 'Job processors, queue depth, message dispatching',
  },
  {
    id: 'scheduler',
    label: 'Scheduler (Cron)',
    icon: 'scheduler',
    description: 'Scheduled cron tasks, execution frequency, triggers',
  },
  {
    id: 'database',
    label: 'Database',
    icon: 'database',
    description: 'TypeORM connection pool, ping latency, entity status',
  },
  {
    id: 'cache',
    label: 'Cache (Redis)',
    icon: 'cache',
    description: 'Redis memory, connection state, keyspace, flush controls',
  },
  {
    id: 'security',
    label: 'Security & Auth',
    icon: 'security',
    description: 'JWT policies, global guards, security headers, token inspection',
  },
];

export const REFRESH_OPTIONS: { label: string; value: number }[] = [
  { label: 'Manual', value: 0 },
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
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
