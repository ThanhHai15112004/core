export const MACHINE_IDENTITIES_ROUTES = {
  PREFIX: 'machine-identities',
  SERVICE_ACCOUNTS: 'service-accounts',
  SERVICE_ACCOUNT_BY_ID: 'service-accounts/:id',
  API_CLIENTS: 'api-clients',
  API_CLIENT_TOKEN: 'api-clients/token',
  API_CLIENT_BY_ID: 'api-clients/:id',
  API_CLIENT_SCOPES: 'api-clients/:id/scopes',
  API_CLIENT_ALLOWED_IPS: 'api-clients/:id/allowed-ips',
  API_CLIENT_ROTATE_SECRET: 'api-clients/:id/rotate-secret',
  API_CLIENT_REVOKE: 'api-clients/:id/revoke',
  API_CLIENT_USAGE: 'api-clients/:id/usage',
} as const;
