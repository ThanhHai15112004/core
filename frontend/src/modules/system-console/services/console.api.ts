import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type { ConsoleMenuTreeResponse, HealthData, OverviewData } from '../types/console.types';

export { fetchPackages, executePackageAction } from './packages.api';

/** Gọi `/health` và đo round-trip; không ném lỗi mà trả `status: 'down'` khi mất kết nối. */
export async function fetchHealth(): Promise<{ data: HealthData; latencyMs: number }> {
  const start = performance.now();
  try {
    const data = await fetchApi<HealthData>(API_ROUTES.HEALTH);
    return { data, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    console.error('fetchHealth error:', err);
    return {
      data: { status: 'down', uptime: 0, timestamp: new Date().toISOString() },
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

export function fetchOverview(): Promise<OverviewData> {
  return fetchApi<OverviewData>(API_ROUTES.OPS.OVERVIEW);
}

/** Lấy cây menu động cho System Console (`position=SYSTEM_CONSOLE`). */
export function fetchConsoleMenus(): Promise<ConsoleMenuTreeResponse> {
  return fetchApi<ConsoleMenuTreeResponse>(API_ROUTES.SETTINGS.MENUS.TREE('SYSTEM_CONSOLE'));
}
