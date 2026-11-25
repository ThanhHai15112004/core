import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  OutboxDispatchBatchResult,
  OutboxEventDetail,
  OutboxEventItem,
  OutboxMetricsSnapshot,
  OutboxPurgeResult,
} from '../types/outbox.types';

export const outboxApi = {
  getMetrics: (): Promise<OutboxMetricsSnapshot> =>
    fetchApi<OutboxMetricsSnapshot>(API_ROUTES.OUTBOX.METRICS),

  listEvents: (qs = '') =>
    fetchApiWithMeta<OutboxEventItem[]>(API_ROUTES.OUTBOX.EVENTS(qs)),

  getEventById: (id: number | string): Promise<OutboxEventDetail> =>
    fetchApi<OutboxEventDetail>(API_ROUTES.OUTBOX.EVENT_BY_ID(id)),

  replayEvent: (
    id: number | string,
    payload: { readonly reason: string; readonly force?: boolean },
  ): Promise<OutboxEventDetail> =>
    fetchApi<OutboxEventDetail>(API_ROUTES.OUTBOX.EVENT_REPLAY(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  cleanup: (payload: { readonly reason?: string } = {}): Promise<OutboxPurgeResult> =>
    fetchApi<OutboxPurgeResult>(API_ROUTES.OUTBOX.CLEANUP, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  processNow: (): Promise<OutboxDispatchBatchResult> =>
    fetchApi<OutboxDispatchBatchResult>(API_ROUTES.OUTBOX.PROCESS_NOW, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
