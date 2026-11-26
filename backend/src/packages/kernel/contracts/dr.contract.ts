export const DR_QUEUE_TOPICS = {
  SYNC_TICK: 'dr.sync.tick',
  DRILL_CHECK_TICK: 'dr.drill.check.tick',
} as const;

export type DrQueueTopic = (typeof DR_QUEUE_TOPICS)[keyof typeof DR_QUEUE_TOPICS];

export const DR_DOMAIN_EVENTS = {
  PROFILE_UPDATED: 'dr.profile.updated',
  SYNC_COMPLETED: 'dr.sync.completed',
  SYNC_RPO_BREACHED: 'dr.sync.rpo_breached',
  FAILOVER_INITIATED: 'dr.failover.initiated',
  FAILOVER_COMPLETED: 'dr.failover.completed',
  FAILBACK_INITIATED: 'dr.failback.initiated',
  FAILBACK_COMPLETED: 'dr.failback.completed',
  SWITCH_ABORTED: 'dr.switch.aborted',
  RECONCILIATION_COMPLETED: 'dr.reconciliation.completed',
  RECONCILIATION_DISCREPANCY_DETECTED: 'dr.reconciliation.discrepancy_detected',
  DRILL_PASSED: 'dr.drill.passed',
  DRILL_FAILED: 'dr.drill.failed',
  DRILL_OVERDUE: 'dr.drill.overdue',
} as const;

export type DrDomainEventName = (typeof DR_DOMAIN_EVENTS)[keyof typeof DR_DOMAIN_EVENTS];
