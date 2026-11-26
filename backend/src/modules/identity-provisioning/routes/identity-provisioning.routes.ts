export const SCIM_PROTOCOL_ROUTES = {
  PREFIX: 'scim/v2',
  SERVICE_PROVIDER_CONFIG: 'ServiceProviderConfig',
  RESOURCE_TYPES: 'ResourceTypes',
  SCHEMAS: 'Schemas',
  USERS: 'Users',
  USER_BY_ID: 'Users/:id',
  GROUPS: 'Groups',
  GROUP_BY_ID: 'Groups/:id',
} as const;

export const IDENTITY_PROVISIONING_ADMIN_ROUTES = {
  PREFIX: 'identity-provisioning',
  CLIENTS: 'clients',
  CLIENT_BY_ID: 'clients/:id',
  CLIENT_ROTATE_TOKEN: 'clients/:id/rotate-token',
  CLIENT_RECONCILE: 'clients/:id/reconcile',
  USER_LINKS: 'user-links',
  GROUPS: 'groups',
  SYNC_LOGS: 'sync-logs',
  RECONCILIATIONS: 'reconciliations',
  RECONCILIATION_BY_ID: 'reconciliations/:id',
} as const;
