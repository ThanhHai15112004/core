import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  HealthData,
  PackageSummary,
  RefreshIntervalMs,
  ToastMessage,
  OverviewData,
  PerformanceMetricKey,
  PerformanceTimeRange,
} from '../types/console.types';
import type { PackageActionResult } from '../../system-ops/types/system-ops.types';
import { CONSOLE_STORAGE_KEYS, REFRESH_OPTIONS } from '../constants/console.constants';
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
import { useMetricHistory } from '../hooks/useMetricHistory';
import { buildFallbackOverview } from '../utils/fallback-overview';
import { ConsoleDataContext, type ConsoleDataContextValue } from './console-data-context';

const TOAST_DURATION_MS = 4000;
const DEFAULT_REFRESH_INTERVAL: RefreshIntervalMs = 10000;

const INITIAL_HEALTH: HealthData = {
  status: 'ok',
  uptime: 0,
  timestamp: new Date().toISOString(),
};

function readRefreshInterval(): RefreshIntervalMs {
  try {
    const saved = Number(localStorage.getItem(CONSOLE_STORAGE_KEYS.REFRESH_INTERVAL));
    const match = REFRESH_OPTIONS.find((o) => o.value === saved);
    if (match) return match.value;
  } catch {
    // Ignore
  }
  return DEFAULT_REFRESH_INTERVAL;
}

export const ConsoleDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, formatTime } = useLocale();

  const [health, setHealth] = useState<HealthData>(INITIAL_HEALTH);
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [rawOverview, setRawOverview] = useState<OverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [activePerformanceMetric, setActivePerformanceMetric] = useState<PerformanceMetricKey>('requests');
  const [performanceTimeRange, setPerformanceTimeRange] = useState<PerformanceTimeRange>('15m');
  const [refreshInterval, setRefreshIntervalState] = useState<RefreshIntervalMs>(readRefreshInterval);

  const { latencyHistory, currentLatency, avgLatency, recordLatency } = useLatencyTracker();
  const { events, addEvent, clearEvents } = useEventLog();
  const { recordOverview, buildSeries } = useMetricHistory();

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

  const setRefreshInterval = useCallback((ms: RefreshIntervalMs) => {
    setRefreshIntervalState(ms);
    try {
      localStorage.setItem(CONSOLE_STORAGE_KEYS.REFRESH_INTERVAL, String(ms));
    } catch {
      // Ignore
    }
  }, []);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setIsRefreshing(true);
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
        setRawOverview(overview);
        if (overview) recordOverview({ ...overview, lastUpdated: new Date(), isOffline: false });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    // `t` đổi theo ngôn ngữ → tự tải lại, vì text trong overview do backend dịch sẵn.
    [addToast, recordLatency, recordOverview, t],
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useEffect(() => {
    if (refreshInterval <= 0) return;
    const interval = setInterval(() => void loadData(true), refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, loadData]);

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
        await loadData(true);
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
    () => buildSeries(activePerformanceMetric, performanceTimeRange, (at) => formatTime(at, false)),
    [buildSeries, activePerformanceMetric, performanceTimeRange, formatTime],
  );

  const overviewData = useMemo<OverviewData>(() => {
    if (rawOverview && !isOffline) {
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
      isRefreshing,
      refreshInterval,
      setRefreshInterval,
      refresh: () => loadData(false),
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
    }),
    [
      health,
      packages,
      isLoading,
      isRefreshing,
      refreshInterval,
      setRefreshInterval,
      loadData,
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
    ],
  );

  return <ConsoleDataContext.Provider value={value}>{children}</ConsoleDataContext.Provider>;
};
