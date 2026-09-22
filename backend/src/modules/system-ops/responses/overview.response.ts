export type SystemHealthStatus = 'healthy' | 'degraded' | 'critical' | 'down';

export interface OverallHealthReportDto {
  status: SystemHealthStatus;
  title: string;
  message: string;
  healthyServices: number;
  totalServices: number;
  uptimeSeconds: number;
  affectedServices?: string[];
  /** Thành phần đang có vấn đề, kèm trạng thái và section để drill-down. */
  affectedComponents?: AffectedComponentDto[];
  actionLabel?: string;
  actionSection?: string;
  startedAgo?: string;
  /** ISO 8601 — thời điểm sự cố sớm nhất đang diễn ra bắt đầu. */
  startedAt?: string;
}

export interface AffectedComponentDto {
  name: string;
  status: string;
  section: string;
}

export interface KeyMetricItemDto {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  trendText: string;
  trendDirection: 'up' | 'down' | 'neutral';
  trendIsGood: boolean;
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
  icon: string;
}

export interface ActiveIncidentItemDto {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  startedAgo: string;
  /** ISO 8601 */
  startedAt?: string;
  targetSection: string;
  actionLabel: string;
}

export interface InfraSnapshotMetricDto {
  label: string;
  value: string | number;
  isWarn?: boolean;
}

export interface InfraSnapshotItemDto {
  id: string;
  title: string;
  icon: string;
  targetSection: string;
  metrics: InfraSnapshotMetricDto[];
  /** `true` khi runtime chưa expose số liệu cho API. */
  unavailable?: boolean;
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
  timestamp: string;
  overallHealth: OverallHealthReportDto;
  keyMetrics: KeyMetricItemDto[];
  healthMap: HealthMapItemDto[];
  incidents: ActiveIncidentItemDto[];
  infraSnapshots: InfraSnapshotItemDto[];
  recentActivities: RecentActivityEventDto[];
  systemInfo: {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    uptimeSeconds: number;
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    totalMemGb: number;
    freeMemGb: number;
    cpuCores: number;
    loadAvg: number[];
  };
}
