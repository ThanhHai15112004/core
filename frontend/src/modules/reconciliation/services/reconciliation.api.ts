import { frontendConfig } from '../../../config/index';
import {
  fetchApi,
  fetchApiWithMeta,
  getStoredAccessToken,
} from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  DataRepairPreviewOutcome,
  DataRepairRequestItem,
  ReconciliationCatalog,
  ReconciliationDiscrepancyItem,
  ReconciliationDiscrepancyReport,
  ReconciliationJobItem,
  ReconciliationRunItem,
} from '../types/reconciliation.types';

export const reconciliationApi = {
  getCatalog: (): Promise<ReconciliationCatalog> =>
    fetchApi<ReconciliationCatalog>(API_ROUTES.RECONCILIATION.CATALOG),

  listJobs: (qs = '') =>
    fetchApiWithMeta<ReconciliationJobItem[]>(API_ROUTES.RECONCILIATION.JOBS(qs)),

  createJob: (payload: Record<string, unknown>): Promise<ReconciliationJobItem> =>
    fetchApi<ReconciliationJobItem>(API_ROUTES.RECONCILIATION.JOBS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  triggerRun: (
    jobId: number | string,
    payload: Record<string, unknown>,
  ): Promise<ReconciliationRunItem> =>
    fetchApi<ReconciliationRunItem>(API_ROUTES.RECONCILIATION.JOB_RUN(jobId), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listRuns: (qs = '') =>
    fetchApiWithMeta<ReconciliationRunItem[]>(API_ROUTES.RECONCILIATION.RUNS(qs)),

  getDiscrepancyReport: (qs = ''): Promise<ReconciliationDiscrepancyReport> =>
    fetchApi<ReconciliationDiscrepancyReport>(API_ROUTES.RECONCILIATION.DISCREPANCIES_REPORT(qs)),

  listDiscrepancies: (qs = '') =>
    fetchApiWithMeta<ReconciliationDiscrepancyItem[]>(API_ROUTES.RECONCILIATION.DISCREPANCIES(qs)),

  assignDiscrepancy: (
    id: number | string,
    assigneeUserId: number,
    note?: string,
  ): Promise<ReconciliationDiscrepancyItem> =>
    fetchApi<ReconciliationDiscrepancyItem>(API_ROUTES.RECONCILIATION.DISCREPANCY_ASSIGN(id), {
      method: 'PATCH',
      body: JSON.stringify({ assigneeUserId, ...(note ? { note } : {}) }),
    }),

  updateDiscrepancyStatus: (
    id: number | string,
    status: string,
    note: string,
  ): Promise<ReconciliationDiscrepancyItem> =>
    fetchApi<ReconciliationDiscrepancyItem>(API_ROUTES.RECONCILIATION.DISCREPANCY_STATUS(id), {
      method: 'PATCH',
      body: JSON.stringify({ status, note }),
    }),

  downloadDiscrepanciesCsv: async (qs = ''): Promise<void> => {
    const token = getStoredAccessToken();
    const url = `${frontendConfig.apiBaseUrl}${API_ROUTES.RECONCILIATION.DISCREPANCIES_EXPORT(qs)}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Export CSV failed (${res.status})`);
    }
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `reconciliation-discrepancies-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(downloadUrl);
  },

  previewRepair: (payload: Record<string, unknown>): Promise<DataRepairPreviewOutcome> =>
    fetchApi<DataRepairPreviewOutcome>(API_ROUTES.RECONCILIATION.REPAIR_PREVIEW, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listRepairs: (qs = '') =>
    fetchApiWithMeta<DataRepairRequestItem[]>(API_ROUTES.RECONCILIATION.REPAIRS(qs)),

  getRepairById: (id: number | string): Promise<DataRepairRequestItem> =>
    fetchApi<DataRepairRequestItem>(API_ROUTES.RECONCILIATION.REPAIR_BY_ID(id)),

  proposeRepair: (payload: Record<string, unknown>): Promise<DataRepairRequestItem> =>
    fetchApi<DataRepairRequestItem>(API_ROUTES.RECONCILIATION.REPAIRS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  approveRepair: (id: number | string, note?: string): Promise<DataRepairRequestItem> =>
    fetchApi<DataRepairRequestItem>(API_ROUTES.RECONCILIATION.REPAIR_APPROVE(id), {
      method: 'POST',
      body: JSON.stringify({ ...(note ? { note } : {}) }),
    }),

  rejectRepair: (id: number | string, note?: string): Promise<DataRepairRequestItem> =>
    fetchApi<DataRepairRequestItem>(API_ROUTES.RECONCILIATION.REPAIR_REJECT(id), {
      method: 'POST',
      body: JSON.stringify({ ...(note ? { note } : {}) }),
    }),

  applyRepair: (id: number | string): Promise<DataRepairRequestItem> =>
    fetchApi<DataRepairRequestItem>(API_ROUTES.RECONCILIATION.REPAIR_APPLY(id), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  proposeCompensation: (
    parentRepairId: number | string,
    payload: Record<string, unknown>,
  ): Promise<DataRepairRequestItem> =>
    fetchApi<DataRepairRequestItem>(API_ROUTES.RECONCILIATION.REPAIR_COMPENSATE(parentRepairId), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
