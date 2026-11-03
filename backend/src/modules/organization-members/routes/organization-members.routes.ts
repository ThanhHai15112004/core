export const ORGANIZATION_MEMBERS_ROUTES = {
  PREFIX: 'organization-members',
  BY_USER_ID: ':userId',
  MEMBERSHIPS: ':userId/memberships',
  TRANSFER: ':userId/transfer',
  MANAGERS: ':userId/managers',
  HISTORY: ':userId/history',
  SUBORDINATES: ':userId/subordinates',
} as const;
