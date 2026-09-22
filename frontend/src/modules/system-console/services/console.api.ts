import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../core/constants/index';
import type { HealthData, PackageSummary, OverviewData } from '../types/console.types';
import { getSystemOpsPackages, executePackageAction } from '../../system-ops/services/system-ops.api';

export interface HealthPayload {
  status: 'ok' | 'degraded' | 'down';
  uptime?: number;
  timestamp?: string;
  service?: string;
  version?: string;
  [key: string]: unknown;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  statusCode?: number;
  timestamp?: string;
}

export async function fetchHealth(): Promise<{ data: HealthData; latencyMs: number }> {
  const start = performance.now();
  try {
    const res = await fetchApi<ApiResponse<HealthPayload> | HealthPayload>(API_ROUTES.HEALTH);
    const latencyMs = Math.round(performance.now() - start);

    // Extract payload whether enveloped by GlobalResponseInterceptor or raw
    const payload: HealthPayload =
      res && typeof res === 'object' && 'data' in res && res.data
        ? (res.data as HealthPayload)
        : (res as HealthPayload);

    return {
      data: {
        status: payload?.status ?? 'ok',
        uptime: typeof payload?.uptime === 'number' ? Math.round(payload.uptime) : 0,
        timestamp: payload?.timestamp ?? new Date().toISOString(),
        service: payload?.service ?? 'core-api',
        version: payload?.version ?? '1.0.0',
      },
      latencyMs,
    };
  } catch (err) {
    console.error('fetchHealth error:', err);
    const latencyMs = Math.round(performance.now() - start);
    return {
      data: {
        status: 'down',
        uptime: 0,
        timestamp: new Date().toISOString(),
      },
      latencyMs,
    };
  }
}

export async function fetchPackages(): Promise<PackageSummary[]> {
  return await getSystemOpsPackages();
}

export async function fetchOverview(): Promise<{ data: OverviewData | null; latencyMs: number }> {
  const start = performance.now();
  try {
    const res = await fetchApi<ApiResponse<OverviewData> | OverviewData>(API_ROUTES.OPS.OVERVIEW);
    const latencyMs = Math.round(performance.now() - start);

    const payload =
      res && typeof res === 'object' && 'data' in res && res.data
        ? (res.data as OverviewData)
        : (res as OverviewData);

    return {
      data: payload,
      latencyMs,
    };
  } catch (err) {
    console.warn('fetchOverview warning (falling back to generated model):', err);
    const latencyMs = Math.round(performance.now() - start);
    return {
      data: null,
      latencyMs,
    };
  }
}

export { executePackageAction };

