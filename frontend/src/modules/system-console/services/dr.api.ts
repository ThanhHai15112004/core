import { fetchApi, fetchApiWithMeta } from '@core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  DrChecklistStepStatus,
  DrDrillDto,
  DrDrillType,
  DrOverviewDto,
  DrProfileDto,
  DrReconciliationReportDto,
  DrRunbookDto,
  DrSwitchExecutionDto,
  DrSwitchMode,
  DrSyncRunDto,
  DrSyncScope,
  DrTopologyMode,
  PaginatedDrList,
} from '../types/dr.types';

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  return sp.toString();
}

export const drApi = {
  overview: (): Promise<DrOverviewDto> =>
    fetchApi<DrOverviewDto>(API_ROUTES.OPS.DR.path('overview')),

  updateProfile: (input: {
    isEnabled?: boolean;
    topologyMode?: DrTopologyMode;
    rpoTargetSeconds?: number;
    rtoTargetSeconds?: number;
    drillIntervalDays?: number;
    primaryEndpoint?: string | null;
    drEndpoint?: string | null;
  }): Promise<DrProfileDto> =>
    fetchApi<DrProfileDto>(API_ROUTES.OPS.DR.path('profile'), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  listSyncRuns: async (page = 1, limit = 20): Promise<PaginatedDrList<DrSyncRunDto>> => {
    const res = await fetchApiWithMeta<DrSyncRunDto[]>(
      API_ROUTES.OPS.DR.path('sync/runs', qs({ page, limit })),
    );
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? page,
        limit: res.meta?.limit ?? limit,
        total: res.meta?.total ?? null,
        totalPages: res.meta?.totalPages ?? null,
      },
    };
  },

  runSync: (scope: DrSyncScope = 'FULL'): Promise<DrSyncRunDto> =>
    fetchApi<DrSyncRunDto>(API_ROUTES.OPS.DR.path('sync/run'), {
      method: 'POST',
      body: JSON.stringify({ scope }),
    }),

  listSwitches: async (page = 1, limit = 20): Promise<PaginatedDrList<DrSwitchExecutionDto>> => {
    const res = await fetchApiWithMeta<DrSwitchExecutionDto[]>(
      API_ROUTES.OPS.DR.path('switches', qs({ page, limit })),
    );
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? page,
        limit: res.meta?.limit ?? limit,
        total: res.meta?.total ?? null,
        totalPages: res.meta?.totalPages ?? null,
      },
    };
  },

  initiateFailover: (input: {
    mode: DrSwitchMode;
    reason: string;
    confirm?: string;
  }): Promise<DrSwitchExecutionDto> =>
    fetchApi<DrSwitchExecutionDto>(API_ROUTES.OPS.DR.path('switches/failover'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  initiateFailback: (input: {
    mode: DrSwitchMode;
    reason: string;
    confirm?: string;
  }): Promise<DrSwitchExecutionDto> =>
    fetchApi<DrSwitchExecutionDto>(API_ROUTES.OPS.DR.path('switches/failback'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateChecklistStep: (
    switchId: number,
    stepKey: string,
    input: { status: DrChecklistStepStatus; note?: string | null },
  ): Promise<DrSwitchExecutionDto> =>
    fetchApi<DrSwitchExecutionDto>(
      API_ROUTES.OPS.DR.path(`switches/${switchId}/checklist/${stepKey}`),
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    ),

  completeSwitch: (
    switchId: number,
    input: { confirm?: string; reconciliationReportId?: number | null },
  ): Promise<DrSwitchExecutionDto> =>
    fetchApi<DrSwitchExecutionDto>(API_ROUTES.OPS.DR.path(`switches/${switchId}/complete`), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  abortSwitch: (switchId: number, reason: string): Promise<DrSwitchExecutionDto> =>
    fetchApi<DrSwitchExecutionDto>(API_ROUTES.OPS.DR.path(`switches/${switchId}/abort`), {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  listReconciliations: async (
    page = 1,
    limit = 20,
  ): Promise<PaginatedDrList<DrReconciliationReportDto>> => {
    const res = await fetchApiWithMeta<DrReconciliationReportDto[]>(
      API_ROUTES.OPS.DR.path('reconciliations', qs({ page, limit })),
    );
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? page,
        limit: res.meta?.limit ?? limit,
        total: res.meta?.total ?? null,
        totalPages: res.meta?.totalPages ?? null,
      },
    };
  },

  runReconciliation: (input: {
    scope?: DrSyncScope;
    switchExecutionId?: number | null;
  }): Promise<DrReconciliationReportDto> =>
    fetchApi<DrReconciliationReportDto>(API_ROUTES.OPS.DR.path('reconciliations/run'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listDrills: async (page = 1, limit = 20): Promise<PaginatedDrList<DrDrillDto>> => {
    const res = await fetchApiWithMeta<DrDrillDto[]>(
      API_ROUTES.OPS.DR.path('drills', qs({ page, limit })),
    );
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? page,
        limit: res.meta?.limit ?? limit,
        total: res.meta?.total ?? null,
        totalPages: res.meta?.totalPages ?? null,
      },
    };
  },

  runDrill: (input: {
    drillType?: DrDrillType;
    scenario?: string;
    lessonsLearned?: string;
  }): Promise<DrDrillDto> =>
    fetchApi<DrDrillDto>(API_ROUTES.OPS.DR.path('drills/run'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  runbook: (): Promise<DrRunbookDto> =>
    fetchApi<DrRunbookDto>(API_ROUTES.OPS.DR.path('runbook')),
};
