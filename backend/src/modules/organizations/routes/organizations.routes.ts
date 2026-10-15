export const ORGANIZATIONS_ROUTES = {
  PREFIX: 'organizations',
  ROOT: '',
  BY_ID: ':id',
  buildByIdPath: (id: string) => `/organizations/${id}`,
} as const;
