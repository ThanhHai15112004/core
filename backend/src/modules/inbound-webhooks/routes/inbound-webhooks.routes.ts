export const INBOUND_WEBHOOKS_ROUTES = {
  PREFIX: 'inbound-webhooks',
  ROOT: '',
  RECEIVE_BY_PROVIDER: 'receive/:providerCode',
  PROVIDERS: 'providers',
  PROVIDER_BY_ID: 'providers/:id',
  PROVIDER_ROTATE_SECRET: 'providers/:id/rotate-secret',
  PROVIDER_SIMULATE: 'providers/:id/simulate',
  EVENTS: 'events',
  EVENT_BY_ID: 'events/:id',
  EVENT_REPROCESS: 'events/:id/reprocess',
  buildReceivePath: (providerCode: string) =>
    `/api/v1/inbound-webhooks/receive/${encodeURIComponent(providerCode)}`,
  buildProvidersPath: () => '/api/v1/inbound-webhooks/providers',
  buildProviderByIdPath: (id: number | string) => `/api/v1/inbound-webhooks/providers/${id}`,
  buildRotateSecretPath: (id: number | string) =>
    `/api/v1/inbound-webhooks/providers/${id}/rotate-secret`,
  buildSimulatePath: (id: number | string) => `/api/v1/inbound-webhooks/providers/${id}/simulate`,
  buildEventsPath: () => '/api/v1/inbound-webhooks/events',
  buildEventByIdPath: (id: number | string) => `/api/v1/inbound-webhooks/events/${id}`,
  buildEventReprocessPath: (id: number | string) =>
    `/api/v1/inbound-webhooks/events/${id}/reprocess`,
} as const;
