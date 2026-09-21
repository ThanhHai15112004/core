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

export type RefreshIntervalMs = 0 | 5000 | 10000 | 30000;

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
  label: string;
  icon: string;
  badgeCount?: number;
  description: string;
}
