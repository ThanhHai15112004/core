export const PackageStatus = {
  HEALTHY: 'healthy',
  WARNING: 'warning',
  ERROR: 'error',
  IDLE: 'idle',
} as const;

export type PackageStatus = (typeof PackageStatus)[keyof typeof PackageStatus];

export const PackageCategory = {
  CACHE: 'cache',
  QUEUE: 'queue',
  LOGGING: 'logging',
  DATABASE: 'database',
  STORAGE: 'storage',
  CUSTOM: 'custom',
} as const;

export type PackageCategory = (typeof PackageCategory)[keyof typeof PackageCategory];

export interface PackageActionDescriptor {
  id: string;
  label: string;
  description?: string;
  isDanger?: boolean;
  paramsSchema?: Record<string, unknown>;
}

export interface PackageStatusReport {
  status: PackageStatus;
  summary: string;
  metrics: Record<string, string | number | boolean>;
}

export interface PackageSummary {
  packageId: string;
  displayName: string;
  category: PackageCategory;
  icon: string;
  statusReport: PackageStatusReport;
  actions: PackageActionDescriptor[];
}

export interface PackageActionResult {
  success: boolean;
  message: string;
  data?: unknown;
}
