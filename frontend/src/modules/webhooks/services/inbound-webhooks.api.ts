import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  InboundWebhookEventItem,
  InboundWebhookProviderItem,
  InboundWebhookProviderWithSecretItem,
  SimulateInboundWebhookResponse,
} from '../types/inbound-webhooks.types';

export const inboundWebhooksApi = {
  listProviders: (qs = '') =>
    fetchApiWithMeta<InboundWebhookProviderItem[]>(API_ROUTES.INBOUND_WEBHOOKS.PROVIDERS(qs)),

  getProviderById: (id: number | string): Promise<InboundWebhookProviderItem> =>
    fetchApi<InboundWebhookProviderItem>(API_ROUTES.INBOUND_WEBHOOKS.PROVIDER_BY_ID(id)),

  createProvider: (
    payload: Record<string, unknown>,
  ): Promise<InboundWebhookProviderWithSecretItem> =>
    fetchApi<InboundWebhookProviderWithSecretItem>(API_ROUTES.INBOUND_WEBHOOKS.PROVIDERS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProvider: (
    id: number | string,
    payload: Record<string, unknown>,
  ): Promise<InboundWebhookProviderItem> =>
    fetchApi<InboundWebhookProviderItem>(API_ROUTES.INBOUND_WEBHOOKS.PROVIDER_BY_ID(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteProvider: (id: number | string): Promise<{ deleted: true; id: number }> =>
    fetchApi<{ deleted: true; id: number }>(API_ROUTES.INBOUND_WEBHOOKS.PROVIDER_BY_ID(id), {
      method: 'DELETE',
    }),

  rotateSecret: (
    id: number | string,
    payload: { signingSecret?: string; reason?: string } = {},
  ): Promise<InboundWebhookProviderWithSecretItem> =>
    fetchApi<InboundWebhookProviderWithSecretItem>(
      API_ROUTES.INBOUND_WEBHOOKS.PROVIDER_ROTATE_SECRET(id),
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  simulateWebhook: (
    id: number | string,
    payload: { externalEventId?: string; eventType?: string; payload?: Record<string, unknown> } = {},
  ): Promise<SimulateInboundWebhookResponse> =>
    fetchApi<SimulateInboundWebhookResponse>(API_ROUTES.INBOUND_WEBHOOKS.PROVIDER_SIMULATE(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listEvents: (qs = '') =>
    fetchApiWithMeta<InboundWebhookEventItem[]>(API_ROUTES.INBOUND_WEBHOOKS.EVENTS(qs)),

  getEventById: (id: number | string): Promise<InboundWebhookEventItem> =>
    fetchApi<InboundWebhookEventItem>(API_ROUTES.INBOUND_WEBHOOKS.EVENT_BY_ID(id)),

  reprocessEvent: (
    id: number | string,
    reason?: string | null,
  ): Promise<InboundWebhookEventItem> =>
    fetchApi<InboundWebhookEventItem>(API_ROUTES.INBOUND_WEBHOOKS.EVENT_REPROCESS(id), {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),
};
