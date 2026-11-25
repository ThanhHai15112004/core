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

export interface InstalledModule {
  name: string;
  displayName: string;
  version: string;
  type: 'core' | 'project';
  category: string;
  description: string | null;
  status: 'enabled' | 'disabled';
  dependencies: string[];
  hasMigrations: boolean;
  tablesCount: number;
}

export interface InstalledModulesResponse {
  summary: {
    total: number;
    enabled: number;
    disabled: number;
    core: number;
    project: number;
  };
  items: InstalledModule[];
}
