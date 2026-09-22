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
  SystemEnvironment,
  ToastMessage,
} from '../types/console.types';
import type { PackageActionResult } from '../../system-ops/types/system-ops.types';
import type { MetricTrend, PerformanceStats } from '../hooks/useMetricHistory';

export interface ConsoleDataContextValue {
  health: HealthData;
  packages: PackageSummary[];
  isLoading: boolean;
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
  /** Xu hướng theo KPI id (`req_sec`, `p95_lat`...), `null` khi chưa đủ dữ liệu. */
  metricTrends: Record<string, MetricTrend | null>;
  /** `true` khi đang offline nhưng vẫn hiển thị giá trị lần đồng bộ gần nhất. */
  isShowingLastKnown: boolean;
}

export const ConsoleDataContext = createContext<ConsoleDataContextValue | null>(null);

export const useConsoleData = (): ConsoleDataContextValue => {
  const context = useContext(ConsoleDataContext);
  if (!context) {
    throw new Error('useConsoleData must be used within a ConsoleDataProvider');
  }
  return context;
};
