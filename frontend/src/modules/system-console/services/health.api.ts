import { ApiError, fetchApi } from '@core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  DetailedHealthDto,
  HealthSystemSettingDto,
  LivenessCheckDto,
  ReadinessCheckDto,
} from '../types/health.types';
import type { HealthData } from '../types/console.types';

export const healthConsoleApi = {
  getLiveness: async (): Promise<LivenessCheckDto> => {
    try {
      return await fetchApi<LivenessCheckDto>(API_ROUTES.HEALTH_ENDPOINTS.LIVE);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        return { status: 'down', live: false, uptime: 0, timestamp: new Date().toISOString() };
      }
      throw err;
    }
  },

  getReadiness: async (): Promise<ReadinessCheckDto> => {
    try {
      return await fetchApi<ReadinessCheckDto>(API_ROUTES.HEALTH_ENDPOINTS.READY);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        return {
          status: 'down',
          ready: false,
          uptime: 0,
          timestamp: new Date().toISOString(),
          redacted: true,
        };
      }
      throw err;
    }
  },

  getPublicHealth: (): Promise<HealthData> =>
    fetchApi<HealthData>(API_ROUTES.HEALTH_ENDPOINTS.CHECK),

  getDetails: (): Promise<DetailedHealthDto> =>
    fetchApi<DetailedHealthDto>(API_ROUTES.HEALTH_ENDPOINTS.DETAILS),

  listSettings: (): Promise<HealthSystemSettingDto[]> =>
    fetchApi<HealthSystemSettingDto[]>(API_ROUTES.SETTINGS.LIST('groupCode=health')),

  updateSetting: (key: string, value: unknown): Promise<HealthSystemSettingDto> =>
    fetchApi<HealthSystemSettingDto>(API_ROUTES.SETTINGS.DETAIL(key), {
      method: 'PUT',
      body: JSON.stringify({ value, reason: 'Updated from System Console Health Check' }),
    }),
};
