import { createContext, useContext } from 'react';
import type {
  EventLogLevel,
  HealthData,
  LatencyDataPoint,
  OpsEventLog,
  OverviewData,
  PackageSummary,
  PerformanceDataPoint,
  PerformanceMetricKey,
  PerformanceTimeRange,
  RefreshIntervalMs,
  SystemEnvironment,
  ToastMessage,
} from '../types/console.types';
import type { PackageActionResult } from '../../system-ops/types/system-ops.types';
import type { PerformanceStats } from '../hooks/useMetricHistory';

export interface ConsoleDataContextValue {
  health: HealthData;
  packages: PackageSummary[];
  isLoading: boolean;
  isRefreshing: boolean;
  refreshInterval: RefreshIntervalMs;
  setRefreshInterval: (ms: RefreshIntervalMs) => void;
  refresh: () => Promise<void>;
  executeAction: (packageId: string, actionId: string, params?: unknown) => Promise<PackageActionResult>;
  lastUpdated: Date;
  latencyHistory: LatencyDataPoint[];
  currentLatency: number;
  avgLatency: number;
  events: OpsEventLog[];
  addEvent: (level: EventLogLevel, source: string, message: string, data?: unknown) => void;
  clearEvents: () => void;
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;

  /** Môi trường do backend báo; `null` khi chưa kết nối được. */
  environment: SystemEnvironment | null;
  isOffline: boolean;
  lastSuccessfulSync: Date | null;
  activePerformanceMetric: PerformanceMetricKey;
  setActivePerformanceMetric: (metric: PerformanceMetricKey) => void;
  performanceTimeRange: PerformanceTimeRange;
  setPerformanceTimeRange: (range: PerformanceTimeRange) => void;
  overviewData: OverviewData;
  performanceSeries: PerformanceDataPoint[];
  performanceStats: PerformanceStats;
}

export const ConsoleDataContext = createContext<ConsoleDataContextValue | null>(null);

export const useConsoleData = (): ConsoleDataContextValue => {
  const context = useContext(ConsoleDataContext);
  if (!context) {
    throw new Error('useConsoleData must be used within a ConsoleDataProvider');
  }
  return context;
};
