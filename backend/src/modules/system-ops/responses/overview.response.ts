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

export interface SystemOverviewResponseDto {
  environment: 'production' | 'staging' | 'development';
  overallHealth: OverallHealthReportDto;
  keyMetrics: KeyMetricItemDto[];
  healthMap: HealthMapItemDto[];
  incidents: ActiveIncidentItemDto[];
  recentActivities: RecentActivityEventDto[];
}
