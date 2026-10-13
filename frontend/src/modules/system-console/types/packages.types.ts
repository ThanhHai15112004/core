export type PackageStatus = 'healthy' | 'warning' | 'error' | 'idle';

export type PackageCategory = 'cache' | 'queue' | 'logging' | 'database' | 'storage' | 'custom';

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
