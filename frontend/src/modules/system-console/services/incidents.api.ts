import { fetchApi, fetchApiWithMeta } from '@core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  AlertOwnerMappingDto,
  IncidentDetailDto,
  IncidentDto,
  IncidentPostmortemDto,
  IncidentRunbookDto,
  IncidentSeverityPolicyDto,
  IncidentsOverviewDto,
  PaginatedResultDto,
  PreventiveActionDto,
  SiemDispatchLogDto,
} from '../types/incidents.types';

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  return sp.toString();
}

export const incidentsApi = {
  overview: (): Promise<IncidentsOverviewDto> =>
    fetchApi<IncidentsOverviewDto>(API_ROUTES.OPS.INCIDENTS.path('overview')),

  listIncidents: async (params: {
    page?: number;
    limit?: number;
    status?: string;
    severity?: string;
    isRepeated?: boolean;
  }): Promise<PaginatedResultDto<IncidentDto>> => {
    const res = await fetchApiWithMeta<IncidentDto[]>(
      API_ROUTES.OPS.INCIDENTS.path(
        '',
        qs({
          page: params.page ?? 1,
          limit: params.limit ?? 50,
          status: params.status,
          severity: params.severity,
          isRepeated: params.isRepeated,
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

  getIncidentDetail: (id: number): Promise<IncidentDetailDto> =>
    fetchApi<IncidentDetailDto>(API_ROUTES.OPS.INCIDENTS.path(String(id))),

  acknowledgeIncident: (id: number): Promise<IncidentDto> =>
    fetchApi<IncidentDto>(API_ROUTES.OPS.INCIDENTS.path(`${id}/acknowledge`), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  resolveIncident: (
    id: number,
    input: { rootCause: string; mitigationSummary: string },
  ): Promise<IncidentDto> =>
    fetchApi<IncidentDto>(API_ROUTES.OPS.INCIDENTS.path(`${id}/resolve`), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  upsertPostmortem: (
    incidentId: number,
    input: {
      title: string;
      summary: string;
      rootCauseAnalysis: string;
      lessonsLearned: string;
      preventiveActions: Omit<PreventiveActionDto, 'id'>[];
    },
  ): Promise<IncidentPostmortemDto> =>
    fetchApi<IncidentPostmortemDto>(API_ROUTES.OPS.INCIDENTS.path(`${incidentId}/postmortem`), {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  publishPostmortem: (incidentId: number): Promise<IncidentPostmortemDto> =>
    fetchApi<IncidentPostmortemDto>(
      API_ROUTES.OPS.INCIDENTS.path(`${incidentId}/postmortem/publish`),
      { method: 'POST', body: JSON.stringify({}) },
    ),

  listOwners: async (): Promise<PaginatedResultDto<AlertOwnerMappingDto>> => {
    const res = await fetchApiWithMeta<AlertOwnerMappingDto[]>(
      API_ROUTES.OPS.INCIDENTS.path('owners', qs({ limit: 50 })),
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

  listRunbooks: async (): Promise<PaginatedResultDto<IncidentRunbookDto>> => {
    const res = await fetchApiWithMeta<IncidentRunbookDto[]>(
      API_ROUTES.OPS.INCIDENTS.path('runbooks', qs({ limit: 50 })),
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

  listPolicies: (): Promise<IncidentSeverityPolicyDto[]> =>
    fetchApi<IncidentSeverityPolicyDto[]>(API_ROUTES.OPS.INCIDENTS.path('policies')),

  listSiemLogs: async (): Promise<PaginatedResultDto<SiemDispatchLogDto>> => {
    const res = await fetchApiWithMeta<SiemDispatchLogDto[]>(
      API_ROUTES.OPS.INCIDENTS.path('siem/logs', qs({ limit: 50 })),
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

  testSiem: (): Promise<SiemDispatchLogDto> =>
    fetchApi<SiemDispatchLogDto>(API_ROUTES.OPS.INCIDENTS.path('siem/test'), {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
