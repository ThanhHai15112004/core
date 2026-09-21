import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type {
  HealthData,
  PackageSummary,
  RefreshIntervalMs,
  ToastMessage,
  OpsEventLog,
  EventLogLevel,
  LatencyDataPoint,
} from '../types/console.types';
import { CONSOLE_STORAGE_KEYS } from '../constants/console.constants';
import { fetchHealth, fetchPackages, executePackageAction } from '../services/console.api';
import { useLatencyTracker } from '../hooks/useLatencyTracker';
import { useEventLog } from '../hooks/useEventLog';

interface ConsoleDataContextValue {
  health: HealthData;
  packages: PackageSummary[];
  isLoading: boolean;
  isRefreshing: boolean;
  refreshInterval: RefreshIntervalMs;
  setRefreshInterval: (ms: RefreshIntervalMs) => void;
  refresh: () => Promise<void>;
  executeAction: (packageId: string, actionId: string, params?: unknown) => Promise<{ success: boolean; message: string; data?: unknown }>;
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
}

const ConsoleDataContext = createContext<ConsoleDataContextValue | null>(null);

const DEFAULT_HEALTH: HealthData = {
  status: 'ok',
  uptime: 0,
  timestamp: new Date().toISOString(),
  service: 'core-api',
  version: '1.0.0',
};

export const ConsoleDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [health, setHealth] = useState<HealthData>(DEFAULT_HEALTH);
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [refreshInterval, setRefreshIntervalState] = useState<RefreshIntervalMs>(() => {
    const saved = localStorage.getItem(CONSOLE_STORAGE_KEYS.REFRESH_INTERVAL);
    if (saved) {
      const parsed = Number(saved);
      if ([0, 5000, 10000, 30000].includes(parsed)) {
        return parsed as RefreshIntervalMs;
      }
    }
    return 10000;
  });

  const { latencyHistory, currentLatency, avgLatency, recordLatency } = useLatencyTracker();
  const { events, addEvent, clearEvents } = useEventLog();

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastMessage = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const setRefreshInterval = (ms: RefreshIntervalMs) => {
    setRefreshIntervalState(ms);
    localStorage.setItem(CONSOLE_STORAGE_KEYS.REFRESH_INTERVAL, String(ms));
  };

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const [healthRes, pkgs] = await Promise.all([
        fetchHealth(),
        fetchPackages().catch((err) => {
          console.error('Failed to load packages:', err);
          return [] as PackageSummary[];
        }),
      ]);

      setHealth(healthRes.data);
      recordLatency(healthRes.latencyMs);
      setPackages(pkgs);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('ConsoleData refresh error:', err);
      addToast({
        type: 'error',
        title: 'Connection Error',
        message: 'Could not communicate with the Core API Gateway.',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [addToast, recordLatency]);

  // Initial load
  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // Auto refresh timer
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const interval = setInterval(() => {
      loadData(true);
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, loadData]);

  // Execute Action
  const executeAction = useCallback(
    async (packageId: string, actionId: string, params?: unknown) => {
      try {
        addEvent('info', packageId, `Executing action [${actionId}]...`);
        const result = await executePackageAction(packageId, actionId, params);
        if (result.success) {
          addEvent('success', packageId, `Action [${actionId}] succeeded: ${result.message}`, result.data);
          addToast({
            type: 'success',
            title: `Action Succeeded`,
            message: result.message || `Package [${packageId}] action [${actionId}] executed successfully.`,
          });
        } else {
          addEvent('warn', packageId, `Action [${actionId}] returned warning: ${result.message}`);
          addToast({
            type: 'warning',
            title: 'Action Warning',
            message: result.message,
          });
        }
        // Refresh packages data immediately to show updated status/metrics
        await loadData(true);
        return result;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        addEvent('error', packageId, `Action [${actionId}] failed: ${errorMsg}`);
        addToast({
          type: 'error',
          title: 'Execution Failed',
          message: errorMsg,
        });
        throw err;
      }
    },
    [addEvent, addToast, loadData],
  );

  const value = useMemo(
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
    }),
    [
      health,
      packages,
      isLoading,
      isRefreshing,
      refreshInterval,
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
    ],
  );

  return (
    <ConsoleDataContext.Provider value={value}>
      {children}
    </ConsoleDataContext.Provider>
  );
};

export const useConsoleData = (): ConsoleDataContextValue => {
  const context = useContext(ConsoleDataContext);
  if (!context) {
    throw new Error('useConsoleData must be used within a ConsoleDataProvider');
  }
  return context;
};
