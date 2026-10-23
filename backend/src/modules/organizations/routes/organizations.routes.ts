export const ORGANIZATIONS_ROUTES = {
  PREFIX: 'organizations',
  ROOT: '',
  TREE: 'tree',
  STATS: 'stats',
  BY_ID: ':id',
  buildByIdPath: (id: string) => `/organizations/${id}`,
} as const;
