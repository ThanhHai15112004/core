import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast as sonnerToast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import type { HealthData, ToastMessage } from '../types/console.types';
import type { PackageActionResult } from '../types/packages.types';
import { fetchHealth, fetchPackages, fetchOverview, fetchConsoleMenus, executePackageAction } from '../services/console.api';
import { ConsoleDataContext, consoleKeys, type ConsoleDataContextValue } from './console-data-context';

const INITIAL_HEALTH: HealthData = { status: 'ok', uptime: 0, timestamp: new Date().toISOString() };

/**
 * Dữ liệu chung của cả console (health, packages, overview, menus) — dùng cho thanh trên, sidebar và trang Tổng quan.
 * Làm mới theo bộ điều khiển chung trên thanh trên cùng.
 */
export const ConsoleDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();

  const healthQ = useLiveQuery(consoleKeys.health, fetchHealth);
  const health = healthQ.data?.data ?? INITIAL_HEALTH;
  const isOffline = health.status === 'down';
  const reachable = healthQ.data !== undefined && !isOffline;

  const packagesQ = useLiveQuery(consoleKeys.packages, fetchPackages, { tier: 'slow', enabled: reachable });
  const menusQ = useLiveQuery(consoleKeys.menus, fetchConsoleMenus, { tier: 'slow', enabled: reachable });
  const overviewQ = useLiveQuery(consoleKeys.overview(locale), fetchOverview, { enabled: reachable });

  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(null);
  useEffect(() => {
    if (reachable) setLastSuccessfulSync(new Date(healthQ.dataUpdatedAt));
  }, [reachable, healthQ.dataUpdatedAt]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const notify = toast.type === 'warning' ? sonnerToast.warning : sonnerToast[toast.type];
    notify(toast.title, { description: toast.message });
  }, []);

  /* Báo một lần khi vừa mất kết nối. */
  const wasOffline = useRef(false);
  useEffect(() => {
    if (isOffline && !wasOffline.current) {
      addToast({ type: 'error', title: t('console.toast.connectionLostTitle'), message: t('console.toast.connectionLostMessage') });
    }
    wasOffline.current = isOffline;
  }, [isOffline, addToast, t]);

  const executeAction = useCallback(
    async (packageId: string, actionId: string, params?: unknown): Promise<PackageActionResult> => {
      try {
        const result = await executePackageAction(packageId, actionId, params);
        addToast(
          result.success
            ? { type: 'success', title: t('console.toast.actionSucceeded'), message: result.message }
            : { type: 'warning', title: t('console.toast.actionWarning'), message: result.message },
        );
        await queryClient.invalidateQueries({ queryKey: ['console'] });
        return result;
      } catch (err: unknown) {
        addToast({ type: 'error', title: t('console.toast.actionFailed'), message: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
    [addToast, queryClient, t],
  );

  const overview = overviewQ.data ?? null;
  const menuTree = menusQ.data?.items ?? null;
  const refetchOverview = overviewQ.refetch;
  const value = useMemo<ConsoleDataContextValue>(
    () => ({
      health,
      packages: packagesQ.data ?? [],
      menuTree,
      executeAction,
      currentLatency: healthQ.data?.latencyMs ?? 0,
      addToast,
      environment: overview?.environment ?? null,
      isOffline,
      lastSuccessfulSync,
      overview,
      overviewLoading: overviewQ.isPending,
      overviewError: overviewQ.error,
      refetchOverview: () => void refetchOverview(),
    }),
    [health, packagesQ.data, menuTree, executeAction, healthQ.data, addToast, overview, isOffline, lastSuccessfulSync, overviewQ.isPending, overviewQ.error, refetchOverview],
  );

  return <ConsoleDataContext.Provider value={value}>{children}</ConsoleDataContext.Provider>;
};
