export const NOTIFICATION_DELIVERY_ROUTES = {
  PREFIX: 'notification-delivery',
  DELIVERIES: 'deliveries',
  DELIVERIES_RETRY_DUE: 'deliveries/retry-due',
  DELIVERY_RETRY_BY_ID: 'deliveries/:id/retry',
  DELIVERY_STATUS_BY_ID: 'deliveries/:id/status',
  SUPPRESSIONS: 'suppressions',
  SUPPRESSION_BY_ID: 'suppressions/:id',
  PUSH_SUBSCRIPTIONS: 'push-subscriptions',
  PUSH_SUBSCRIPTION_BY_ID: 'push-subscriptions/:id',
  QUOTA_SUMMARY: 'quota-summary',
} as const;
