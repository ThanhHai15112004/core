import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  HealthData,
  PackageSummary,
  ToastMessage,
  OverviewData,
  PerformanceMetricKey,
  PerformanceTimeRange,
} from '../types/console.types';
import type { PackageActionResult } from '../../system-ops/types/system-ops.types';
import { POLL_INTERVAL_MS } from '../constants/console.constants';
import { frontendConfig } from '../../../config/index';
import { useLocale } from '../../../core/i18n/index';
import {
  fetchHealth,
  fetchPackages,
  fetchOverview,
  executePackageAction,
  type OverviewPayload,
} from '../services/console.api';
import { useLatencyTracker } from '../hooks/useLatencyTracker';
import { useEventLog } from '../hooks/useEventLog';
import { KPI_METRIC, useMetricHistory } from '../hooks/useMetricHistory';
import { buildFallbackOverview } from '../utils/fallback-overview';
import { ConsoleDataContext, type ConsoleDataContextValue } from './console-data-context';

const TOAST_DURATION_MS = 4000;

const INITIAL_HEALTH: HealthData = {
  status: 'ok',
  uptime: 0,
  timestamp: new Date().toISOString(),
};

export const ConsoleDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLocale();

  const [health, setHealth] = useState<HealthData>(INITIAL_HEALTH);
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [rawOverview, setRawOverview] = useState<OverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [activePerformanceMetric, setActivePerformanceMetric] = useState<PerformanceMetricKey>('requests');
  const [performanceTimeRange, setPerformanceTimeRange] = useState<PerformanceTimeRange>('15m');

  const { latencyHistory, currentLatency, avgLatency, recordLatency } = useLatencyTracker();
  const { events, addEvent, clearEvents } = useEventLog();
  const { recordOverview, buildSeries, getTrend } = useMetricHistory();

  const isOffline = health.status === 'down';
  const wasOfflineRef = useRef(false);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const loadData = useCallback(
    async () => {
      try {
        const [healthRes, pkgs, overview] = await Promise.all([
          fetchHealth(),
          fetchPackages().catch((err: unknown) => {
            console.error('Failed to load packages:', err);
            return null;
          }),
          fetchOverview().catch((err: unknown) => {
            console.warn('Failed to load overview:', err);
            return null;
          }),
        ]);

        const reachable = healthRes.data.status !== 'down';
        setHealth(healthRes.data);
        setLastUpdated(new Date());

        const justWentOffline = !reachable && !wasOfflineRef.current;
        wasOfflineRef.current = !reachable;

        if (!reachable) {
          if (!justWentOffline) return;
          addToast({
            type: 'error',
            title: t('console.toast.connectionLostTitle'),
            message: t('console.toast.connectionLostMessage'),
          });
          return;
        }

        recordLatency(healthRes.latencyMs);
        setLastSuccessfulSync(new Date());
        if (pkgs) setPackages(pkgs);
        // Giữ bản overview gần nhất nếu lần này lỗi, để UI hiển thị "giá trị gần nhất".
        if (overview) setRawOverview(overview);
        if (overview) recordOverview({ ...overview, lastUpdated: new Date(), isOffline: false });
      } finally {
        setIsLoading(false);
      }
    },
    // `t` đổi theo ngôn ngữ → tự tải lại, vì text trong overview do backend dịch sẵn.
    [addToast, recordLatency, recordOverview, t],
  );

  // Tự cập nhật định kỳ; tạm dừng khi tab bị ẩn và tải lại ngay khi người dùng quay lại.
  useEffect(() => {
    void loadData();
    const interval = setInterval(() => {
      if (!document.hidden) void loadData();
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (!document.hidden) void loadData();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadData]);

  const executeAction = useCallback(
    async (packageId: string, actionId: string, params?: unknown): Promise<PackageActionResult> => {
      const eventParams = { action: actionId };
      try {
        addEvent('info', packageId, t('console.event.executing', eventParams));
        const result = await executePackageAction(packageId, actionId, params);
        if (result.success) {
          addEvent('success', packageId, t('console.event.succeeded', { ...eventParams, message: result.message }), result.data);
          addToast({ type: 'success', title: t('console.toast.actionSucceeded'), message: result.message });
        } else {
          addEvent('warn', packageId, t('console.event.warning', { ...eventParams, message: result.message }));
          addToast({ type: 'warning', title: t('console.toast.actionWarning'), message: result.message });
        }
        await loadData();
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addEvent('error', packageId, t('console.event.failed', { ...eventParams, message }));
        addToast({ type: 'error', title: t('console.toast.actionFailed'), message });
        throw err;
      }
    },
    [addEvent, addToast, loadData, t],
  );

  const { series: performanceSeries, stats: performanceStats } = useMemo(
    () => buildSeries(activePerformanceMetric, performanceTimeRange),
    [buildSeries, activePerformanceMetric, performanceTimeRange],
  );

  const metricTrends = useMemo(
    () => Object.fromEntries(Object.entries(KPI_METRIC).map(([id, metric]) => [id, getTrend(metric)])),
    [getTrend],
  );

  const overviewData = useMemo<OverviewData>(() => {
    if (rawOverview) {
      return { ...rawOverview, lastUpdated, isOffline, lastSuccessfulSync };
    }
    return buildFallbackOverview({
      t,
      isOffline,
      apiBaseUrl: frontendConfig.apiBaseUrl,
      lastUpdated,
      lastSuccessfulSync,
    });
  }, [rawOverview, isOffline, lastUpdated, lastSuccessfulSync, t]);

  const value = useMemo<ConsoleDataContextValue>(
    () => ({
      health,
      packages,
      isLoading,
      executeAction,
      lastUpdated,
      latencyHistory,
      currentLatency,
      avgLatency,
      events,
      addEvent,
      clearEvents,
      toasts,
      addToast,
      removeToast,
      environment: overviewData.environment,
      isOffline,
      lastSuccessfulSync,
      activePerformanceMetric,
      setActivePerformanceMetric,
      performanceTimeRange,
      setPerformanceTimeRange,
      overviewData,
      performanceSeries,
      performanceStats,
      metricTrends,
      isShowingLastKnown: isOffline && rawOverview !== null,
    }),
    [
      health,
      packages,
      isLoading,
      executeAction,
      lastUpdated,
      latencyHistory,
      currentLatency,
      avgLatency,
      events,
      addEvent,
      clearEvents,
      toasts,
      addToast,
      removeToast,
      isOffline,
      lastSuccessfulSync,
      activePerformanceMetric,
      performanceTimeRange,
      overviewData,
      performanceSeries,
      performanceStats,
      metricTrends,
      rawOverview,
    ],
  );

  return <ConsoleDataContext.Provider value={value}>{children}</ConsoleDataContext.Provider>;
};
