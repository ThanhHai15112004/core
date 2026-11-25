import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  IdempotencyMetricsSnapshot,
  IdempotencyPurgeResult,
  IdempotencyRecordDetail,
  IdempotencyRecordItem,
  IdempotencyRevokeResult,
} from '../types/idempotency.types';

export const idempotencyApi = {
  getMetrics: (windowHours = 24): Promise<IdempotencyMetricsSnapshot> =>
    fetchApi<IdempotencyMetricsSnapshot>(API_ROUTES.IDEMPOTENCY.METRICS(windowHours)),

  listRecords: (qs = '') =>
    fetchApiWithMeta<IdempotencyRecordItem[]>(API_ROUTES.IDEMPOTENCY.RECORDS(qs)),

  getRecordById: (id: number | string): Promise<IdempotencyRecordDetail> =>
    fetchApi<IdempotencyRecordDetail>(API_ROUTES.IDEMPOTENCY.RECORD_BY_ID(id)),

  revokeRecord: (id: number | string, reason?: string): Promise<IdempotencyRevokeResult> =>
    fetchApi<IdempotencyRevokeResult>(API_ROUTES.IDEMPOTENCY.REVOKE_RECORD(id, reason), {
      method: 'DELETE',
    }),

  purgeExpired: (payload: { readonly reason?: string } = {}): Promise<IdempotencyPurgeResult> =>
    fetchApi<IdempotencyPurgeResult>(API_ROUTES.IDEMPOTENCY.PURGE_EXPIRED, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
