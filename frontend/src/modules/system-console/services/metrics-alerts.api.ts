import { fetchApi, fetchApiWithMeta } from '@core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  AlertEvaluationSummaryDto,
  AlertEventDto,
  AlertRuleDto,
  CreateAlertRuleInput,
  MetricsOverviewDto,
  PaginatedDto,
  UpdateAlertRuleInput,
} from '../types/metrics-alerts.types';

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  return sp.toString();
}

export const metricsAlertsApi = {
  overview: (range: string): Promise<MetricsOverviewDto> =>
    fetchApi<MetricsOverviewDto>(API_ROUTES.OPS.METRICS.path('overview', qs({ range }))),

  listRules: async (params: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedDto<AlertRuleDto>> => {
    const res = await fetchApiWithMeta<AlertRuleDto[]>(
      API_ROUTES.OPS.METRICS.path('alerts/rules', qs({ page: params.page ?? 1, limit: params.limit ?? 50, search: params.search })),
    );
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? 1,
        limit: res.meta?.limit ?? 50,
        total: res.meta?.total ?? null,
        totalPages: res.meta?.totalPages ?? null,
      },
    };
  },

  createRule: (input: CreateAlertRuleInput): Promise<AlertRuleDto> =>
    fetchApi<AlertRuleDto>(API_ROUTES.OPS.METRICS.path('alerts/rules'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateRule: (id: number, input: UpdateAlertRuleInput): Promise<AlertRuleDto> =>
    fetchApi<AlertRuleDto>(API_ROUTES.OPS.METRICS.path(`alerts/rules/${id}`), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteRule: (id: number): Promise<{ deleted: boolean; id: number }> =>
    fetchApi<{ deleted: boolean; id: number }>(API_ROUTES.OPS.METRICS.path(`alerts/rules/${id}`), {
      method: 'DELETE',
    }),

  testRule: (
    id: number,
    dispatch = false,
  ): Promise<{ ruleId: number; ruleCode: string; matched: boolean; samples: unknown[] }> =>
    fetchApi(API_ROUTES.OPS.METRICS.path(`alerts/rules/${id}/test`), {
      method: 'POST',
      body: JSON.stringify({ dispatch }),
    }),

  listEvents: async (params: {
    page?: number;
    limit?: number;
    status?: string;
    severity?: string;
  }): Promise<PaginatedDto<AlertEventDto>> => {
    const res = await fetchApiWithMeta<AlertEventDto[]>(
      API_ROUTES.OPS.METRICS.path(
        'alerts/events',
        qs({
          page: params.page ?? 1,
          limit: params.limit ?? 50,
          status: params.status,
          severity: params.severity,
        }),
      ),
    );
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? 1,
        limit: res.meta?.limit ?? 50,
        total: res.meta?.total ?? null,
        totalPages: res.meta?.totalPages ?? null,
      },
    };
  },

  acknowledgeEvent: (id: number): Promise<AlertEventDto> =>
    fetchApi<AlertEventDto>(API_ROUTES.OPS.METRICS.path(`alerts/events/${id}/acknowledge`), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  resolveEvent: (id: number): Promise<AlertEventDto> =>
    fetchApi<AlertEventDto>(API_ROUTES.OPS.METRICS.path(`alerts/events/${id}/resolve`), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  evaluateNow: (): Promise<AlertEvaluationSummaryDto> =>
    fetchApi<AlertEvaluationSummaryDto>(API_ROUTES.OPS.METRICS.path('alerts/evaluate'), {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
