export type { PackageSummary } from './packages.types';

export type ConsoleSectionId =
  | 'overview'
  | 'runtimes'
  | 'http-traffic'
  | 'performance'
  | 'database'
  | 'cache'
  | 'storage'
  | 'messaging'
  | 'worker'
  | 'scheduler'
  | 'jobs'
  | 'logs'
  | 'security'
  | 'secrets'
  | 'configuration'
  | 'packages';

/** Đường dẫn trong console, vd. `runtimes/worker/metrics` hoặc `logs?runtime=api`. */
export type ConsolePath = string;

export interface HealthData {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  timestamp: string;
  /** Kết quả từng phụ thuộc (database, redis, heap) — không có khi gọi `/health` thất bại. */
  checks?: Record<string, { status: 'up' | 'down' } & Record<string, unknown>>;
  service?: string;
  version?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
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
  healthyServices: number;
  totalServices: number;
  uptimeSeconds: number;
  actionLabel?: string;
  actionSection?: ConsolePath;
}

export interface KeyMetricItem {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  trendText: string;
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
  targetSection: ConsolePath;
}

export interface ActiveIncidentItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  /** ISO 8601 */
  startedAt?: string;
  targetSection: ConsolePath;
}

export interface RecentActivityEvent {
  id: string;
  /** ISO 8601 */
  time: string;
  level: 'info' | 'warn' | 'error' | 'success';
  source: string;
  message: string;
}

export interface OverviewData {
  environment: SystemEnvironment;
  overallHealth: OverallHealthReport;
  keyMetrics: KeyMetricItem[];
  healthMap: HealthMapItem[];
  incidents: ActiveIncidentItem[];
  recentActivities: RecentActivityEvent[];
}

/* ==========================================================================
   DYNAMIC MENU TREE MODEL
   Khớp với response của GET /settings/menus/tree?position=SYSTEM_CONSOLE
   ========================================================================== */

export interface ConsoleMenuTreeNode {
  id: number;
  code: string;
  module: string;
  name: string;
  status: number;
  statusName: 'ACTIVE' | 'INACTIVE';
  link: string | null;
  linkApi: string | null;
  type: number;
  typeName: 'GROUP' | 'ITEM' | 'EXTERNAL' | 'ACTION';
  parent: number | null;
  parentCode: string | null;
  level: number;
  key: string | null;
  numOrder: number;
  icon: string | null;
  position: string;
  children: ConsoleMenuTreeNode[];
}

export interface ConsoleMenuTreeResponse {
  position: string;
  cacheVersion: number;
  fromCache: boolean;
  totalNodes: number;
  items: ConsoleMenuTreeNode[];
}
