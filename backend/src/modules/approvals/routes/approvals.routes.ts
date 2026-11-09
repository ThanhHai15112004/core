export const APPROVALS_ROUTES = {
  PREFIX: 'approvals',
  DELEGATIONS: 'delegations',
  DELEGATION_BY_ID: 'delegations/:id',
  DELEGATION_REVOKE: 'delegations/:id/revoke',
  INSTANCE_STEPS: 'instances/:id/steps',
  INSTANCE_DECIDE: 'instances/:id/decide',
  INSTANCE_DELEGATE: 'instances/:id/delegate',
} as const;
