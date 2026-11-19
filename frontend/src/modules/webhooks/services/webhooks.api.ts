import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  WebhookDeliveryItem,
  WebhookEndpointItem,
  WebhookEndpointWithSecretItem,
  WebhookEventCatalogItem,
} from '../types/webhooks.types';

export const webhooksApi = {
  listEvents: (): Promise<WebhookEventCatalogItem[]> =>
    fetchApi<WebhookEventCatalogItem[]>(API_ROUTES.WEBHOOKS.EVENTS),

  listEndpoints: (qs = '') =>
    fetchApiWithMeta<WebhookEndpointItem[]>(API_ROUTES.WEBHOOKS.ENDPOINTS(qs)),

  getEndpointById: (id: number | string): Promise<WebhookEndpointItem> =>
    fetchApi<WebhookEndpointItem>(API_ROUTES.WEBHOOKS.ENDPOINT_BY_ID(id)),

  createEndpoint: (payload: Record<string, unknown>): Promise<WebhookEndpointWithSecretItem> =>
    fetchApi<WebhookEndpointWithSecretItem>(API_ROUTES.WEBHOOKS.ENDPOINTS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateEndpoint: (
    id: number | string,
    payload: Record<string, unknown>,
  ): Promise<WebhookEndpointItem> =>
    fetchApi<WebhookEndpointItem>(API_ROUTES.WEBHOOKS.ENDPOINT_BY_ID(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteEndpoint: (id: number | string): Promise<{ deleted: true; id: number }> =>
    fetchApi<{ deleted: true; id: number }>(API_ROUTES.WEBHOOKS.ENDPOINT_BY_ID(id), {
      method: 'DELETE',
    }),

  rotateSecret: (id: number | string): Promise<WebhookEndpointWithSecretItem> =>
    fetchApi<WebhookEndpointWithSecretItem>(API_ROUTES.WEBHOOKS.ENDPOINT_ROTATE_SECRET(id), {
      method: 'POST',
    }),

  reactivateEndpoint: (
    id: number | string,
    reason?: string | null,
  ): Promise<WebhookEndpointItem> =>
    fetchApi<WebhookEndpointItem>(API_ROUTES.WEBHOOKS.ENDPOINT_REACTIVATE(id), {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  sendTestEvent: (
    id: number | string,
    payload: { eventName?: string; payload?: Record<string, unknown> },
  ): Promise<WebhookDeliveryItem> =>
    fetchApi<WebhookDeliveryItem>(API_ROUTES.WEBHOOKS.ENDPOINT_TEST(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listDeliveries: (qs = '') =>
    fetchApiWithMeta<WebhookDeliveryItem[]>(API_ROUTES.WEBHOOKS.DELIVERIES(qs)),

  getDeliveryById: (id: number | string): Promise<WebhookDeliveryItem> =>
    fetchApi<WebhookDeliveryItem>(API_ROUTES.WEBHOOKS.DELIVERY_BY_ID(id)),

  replayDelivery: (
    id: number | string,
    reason?: string | null,
  ): Promise<WebhookDeliveryItem> =>
    fetchApi<WebhookDeliveryItem>(API_ROUTES.WEBHOOKS.DELIVERY_REPLAY(id), {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),
};
