import { PackageCategory, PackageStatus } from '../types/system-ops.types';

export interface StatusTheme {
  className: string;
  /** Khóa i18n */
  labelKey: string;
}

export const STATUS_THEME_CONFIG: Record<PackageStatus, StatusTheme> = {
  [PackageStatus.HEALTHY]: {
    className: 'ops-status-healthy',
    labelKey: 'console.status.healthy',
  },
  [PackageStatus.WARNING]: {
    className: 'ops-status-warning',
    labelKey: 'console.status.warning',
  },
  [PackageStatus.ERROR]: {
    className: 'ops-status-error',
    labelKey: 'console.status.error',
  },
  [PackageStatus.IDLE]: {
    className: 'ops-status-idle',
    labelKey: 'console.status.idle',
  },
};

export const CATEGORY_ICON_CONFIG: Record<PackageCategory, string> = {
  [PackageCategory.CACHE]: '⚡',
  [PackageCategory.LOGGING]: '📜',
  [PackageCategory.QUEUE]: '📨',
  [PackageCategory.DATABASE]: '🗄️',
  [PackageCategory.STORAGE]: '📦',
  [PackageCategory.CUSTOM]: '🧩',
};
