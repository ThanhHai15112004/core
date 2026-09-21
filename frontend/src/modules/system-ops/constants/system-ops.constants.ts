import { PackageCategory, PackageStatus } from '../types/system-ops.types';

export const SYSTEM_OPS_ENDPOINTS = {
  PACKAGES: '/ops/packages',
  PACKAGE_DETAIL: (packageId: string) => `/ops/packages/${packageId}`,
  EXECUTE_ACTION: (packageId: string, actionId: string) =>
    `/ops/packages/${packageId}/actions/${actionId}`,
} as const;

export interface StatusTheme {
  className: string;
  label: string;
}

export const STATUS_THEME_CONFIG: Record<PackageStatus, StatusTheme> = {
  [PackageStatus.HEALTHY]: {
    className: 'ops-status-healthy',
    label: 'Hoạt động tốt',
  },
  [PackageStatus.WARNING]: {
    className: 'ops-status-warning',
    label: 'Cảnh báo',
  },
  [PackageStatus.ERROR]: {
    className: 'ops-status-error',
    label: 'Lỗi',
  },
  [PackageStatus.IDLE]: {
    className: 'ops-status-idle',
    label: 'Chờ',
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
