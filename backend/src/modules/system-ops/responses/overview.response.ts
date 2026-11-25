export type SystemHealthStatus = 'healthy' | 'degraded' | 'critical' | 'down';

export interface OverallHealthReportDto {
  status: SystemHealthStatus;
  title: string;
  healthyServices: number;
  totalServices: number;
  uptimeSeconds: number;
  actionLabel?: string;
  actionSection?: string;
}

export interface KeyMetricItemDto {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  trendText: string;
  status: 'normal' | 'warning' | 'critical';
}

export interface HealthMapItemDto {
  id: string;
  name: string;
  category: 'runtime' | 'infrastructure' | 'governance';
  /** `unknown`: thành phần chưa có health check thật. */
  status: 'healthy' | 'warning' | 'critical' | 'down' | 'unknown';
  subtext: string;
  secondarySubtext?: string;
  /** Chỉ số ngắn gọn nhất của thành phần, vd. `12 ms`, `4 keys • 96%`. */
  metric?: string;
  targetSection: string;
}

export interface ActiveIncidentItemDto {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  /** ISO 8601 */
  startedAt?: string;
  targetSection: string;
}

export interface RecentActivityEventDto {
  id: string;
  /** ISO 8601 — client tự format theo locale. */
  time: string;
  level: 'info' | 'warn' | 'error' | 'success';
  source: string;
  message: string;
}

export interface DeploymentInfoDto {
  commit: string | null;
  shortCommit: string | null;
  image: string | null;
  buildTime: string | null;
  nodeVersion: string;
}

export interface SystemModulesSummaryDto {
  total: number;
  enabled: number;
  disabled: number;
  core: number;
  project: number;
}

export interface SystemInfoResponseDto {
  projectName: string;
  coreVersion: string;
  projectVersion: string;
  environment: 'production' | 'staging' | 'development';
  uptimeSeconds: number;
  deployment: DeploymentInfoDto;
  modules: SystemModulesSummaryDto;
}

export interface InstalledModuleDto {
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

export interface InstalledModulesResponseDto {
  summary: SystemModulesSummaryDto;
  items: InstalledModuleDto[];
}

export interface OverviewMigrationSummaryDto {
  status: 'up' | 'degraded' | 'down' | 'unknown';
  enabled: boolean;
  upToDate: boolean;
  applied: number;
  pending: number;
  tampered: number;
}

export interface OverviewBackupSummaryDto {
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  lastBackupAt: string | null;
  lastStatus: 'success' | 'failed' | 'running' | 'unknown';
  sizeBytes: number | null;
  provider: string | null;
  stale: boolean;
}

export interface SystemOverviewResponseDto {
  environment: 'production' | 'staging' | 'development';
  overallHealth: OverallHealthReportDto;
  keyMetrics: KeyMetricItemDto[];
  healthMap: HealthMapItemDto[];
  incidents: ActiveIncidentItemDto[];
  recentActivities: RecentActivityEventDto[];
  systemInfo?: SystemInfoResponseDto;
  migrationStatus?: OverviewMigrationSummaryDto;
  backupStatus?: OverviewBackupSummaryDto;
}
