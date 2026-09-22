import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type { HealthData, OverviewData } from '../types/console.types';

export { getSystemOpsPackages as fetchPackages, executePackageAction } from '../../system-ops/services/system-ops.api';

/** Overview từ backend chưa có các trường client-side (`lastUpdated`, `isOffline`...). */
export type OverviewPayload = Omit<OverviewData, 'lastUpdated' | 'isOffline' | 'lastSuccessfulSync'>;

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

export function fetchOverview(): Promise<OverviewPayload> {
  return fetchApi<OverviewPayload>(API_ROUTES.OPS.OVERVIEW);
}
