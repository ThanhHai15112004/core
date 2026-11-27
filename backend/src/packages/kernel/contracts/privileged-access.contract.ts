export const PRIVILEGED_ACCESS_QUEUE_TOPICS = {
  EXPIRATION_SWEEP_TICK: 'privileged-access.expiration.sweep.tick',
  REVIEW_SCHEDULE_TICK: 'privileged-access.review.schedule.tick',
} as const;

export type PrivilegedAccessQueueTopic =
  (typeof PRIVILEGED_ACCESS_QUEUE_TOPICS)[keyof typeof PRIVILEGED_ACCESS_QUEUE_TOPICS];

export const PRIVILEGED_ACCESS_DOMAIN_EVENTS = {
  TARGET_UPDATED: 'privileged-access.target.updated',
  GRANT_REQUESTED: 'privileged-access.grant.requested',
  GRANT_APPROVED: 'privileged-access.grant.approved',
  GRANT_REJECTED: 'privileged-access.grant.rejected',
  GRANT_REVOKED: 'privileged-access.grant.revoked',
  GRANT_EXPIRED: 'privileged-access.grant.expired',
  BREAK_GLASS_CREATED: 'privileged-access.break-glass.created',
  BREAK_GLASS_ACTIVATED: 'privileged-access.break-glass.activated',
  BREAK_GLASS_SEALED: 'privileged-access.break-glass.sealed',
  BREAK_GLASS_AUTO_SEALED: 'privileged-access.break-glass.auto-sealed',
  PRIVILEGED_ACTION_USED: 'privileged-access.action.used',
  REVIEW_CREATED: 'privileged-access.review.created',
  REVIEW_ITEM_DECIDED: 'privileged-access.review.item.decided',
  REVIEW_COMPLETED: 'privileged-access.review.completed',
} as const;

export type PrivilegedAccessDomainEventName =
  (typeof PRIVILEGED_ACCESS_DOMAIN_EVENTS)[keyof typeof PRIVILEGED_ACCESS_DOMAIN_EVENTS];
