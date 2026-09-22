export type {
  PackageSummary,
  PackageActionDescriptor,
  PackageStatus,
  PackageCategory,
} from '../../system-ops/types/system-ops.types';

export type ConsoleSectionId =
  | 'overview'
  | 'runtime'
  | 'packages'
  | 'logs'
  | 'worker'
  | 'scheduler'
  | 'database'
  | 'cache'
  | 'security';

export type ConsoleTheme = 'light' | 'dark';

export interface HealthData {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  timestamp: string;
  service?: string;
  version?: string;
}

export interface LatencyDataPoint {
  time: string;
  latencyMs: number;
}

export type EventLogLevel = 'info' | 'warn' | 'error' | 'success';

export interface OpsEventLog {
  id: string;
  timestamp: Date;
  level: EventLogLevel;
  source: string;
  message: string;
  data?: unknown;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

export interface NavigationItem {
  id: ConsoleSectionId;
  icon: string;
  badgeCount?: number;
}

/* ==========================================================================
   OPERATIONAL OVERVIEW DATA MODEL
   Khớp với response của GET /ops/overview (backend/src/modules/system-ops/responses)
   ========================================================================== */

export type SystemEnvironment = 'production' | 'staging' | 'development';
export type SystemHealthStatus = 'healthy' | 'degraded' | 'critical' | 'down';

export interface OverallHealthReport {
  status: SystemHealthStatus;
  title: string;
  message: string;
  healthyServices: number;
  totalServices: number;
  uptimeSeconds: number;
  affectedServices?: string[];
  affectedComponents?: Array<{ name: string; status: string; section: ConsoleSectionId }>;
  actionLabel?: string;
  actionSection?: ConsoleSectionId;
  startedAgo?: string;
  /** ISO 8601 */
  startedAt?: string;
}

export interface KeyMetricItem {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  trendText: string;
  trendDirection: 'up' | 'down' | 'neutral';
  trendIsGood: boolean;
  status: 'normal' | 'warning' | 'critical';
}

export type HealthMapCategory = 'runtime' | 'infrastructure' | 'governance';

export interface HealthMapItem {
  id: string;
  name: string;
  category: HealthMapCategory;
  /** `unknown`: thành phần chưa có health check thật. */
  status: 'healthy' | 'warning' | 'critical' | 'down' | 'unknown';
  subtext: string;
  secondarySubtext?: string;
  /** Chỉ số ngắn gọn nhất của thành phần. */
  metric?: string;
  targetSection: ConsoleSectionId;
  icon: string;
}

export type PerformanceMetricKey = 'requests' | 'latency' | 'errors' | 'cpu' | 'memory';
export type PerformanceTimeRange = '15m' | '1h' | '6h' | '24h';

export interface PerformanceDataPoint {
  time: string;
  value: number;
}

export interface ActiveIncidentItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  startedAgo: string;
  /** ISO 8601 */
  startedAt?: string;
  targetSection: ConsoleSectionId;
  actionLabel: string;
}

export interface InfraSnapshotMetric {
  label: string;
  value: string | number;
  isWarn?: boolean;
}

export interface InfraSnapshotItem {
  id: string;
  title: string;
  icon: string;
  targetSection: ConsoleSectionId;
  metrics: InfraSnapshotMetric[];
  /** Runtime chưa expose số liệu. */
  unavailable?: boolean;
}

export interface RecentActivityEvent {
  id: string;
  /** ISO 8601 */
  time: string;
  level: EventLogLevel;
  source: string;
  message: string;
}

export interface SystemInfo {
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
}

export interface OverviewData {
  /** `null` khi chưa lấy được từ backend. */
  environment: SystemEnvironment | null;
  lastUpdated: Date;
  isOffline: boolean;
  lastSuccessfulSync?: Date | null;
  overallHealth: OverallHealthReport;
  keyMetrics: KeyMetricItem[];
  healthMap: HealthMapItem[];
  incidents: ActiveIncidentItem[];
  infraSnapshots: InfraSnapshotItem[];
  recentActivities: RecentActivityEvent[];
  systemInfo?: SystemInfo;
}


