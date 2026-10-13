import { createContext, useContext } from 'react';
import type { HealthData, PackageSummary, SystemEnvironment, ToastMessage } from '../types/console.types';
import type { PackageActionResult } from '../types/packages.types';
import type { OverviewPayload } from '../services/console.api';

export interface ConsoleDataContextValue {
  health: HealthData;
  packages: PackageSummary[];
  executeAction: (packageId: string, actionId: string, params?: unknown) => Promise<PackageActionResult>;
  /** Round-trip lần gọi `/health` gần nhất (ms). */
  currentLatency: number;
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;

  /** Môi trường do backend báo; `null` khi chưa kết nối được. */
  environment: SystemEnvironment | null;
  isOffline: boolean;
  lastSuccessfulSync: Date | null;
  /** `/ops/overview` gần nhất lấy được (giữ lại khi lần sau lỗi); `null` = chưa lấy được lần nào. */
  overview: OverviewPayload | null;
  overviewLoading: boolean;
  overviewError: unknown;
  refetchOverview: () => void;
}

export const consoleKeys = {
  health: ['console', 'health'] as const,
  packages: ['console', 'packages'] as const,
  /** Text trong overview do backend dịch sẵn → key theo ngôn ngữ. */
  overview: (locale: string) => ['console', 'overview', locale] as const,
};

export const ConsoleDataContext = createContext<ConsoleDataContextValue | null>(null);

export const useConsoleData = (): ConsoleDataContextValue => {
  const context = useContext(ConsoleDataContext);
  if (!context) {
    throw new Error('useConsoleData must be used within a ConsoleDataProvider');
  }
  return context;
};
