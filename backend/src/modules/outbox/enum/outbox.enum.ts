export {
  OUTBOX_DEFAULTS,
  OUTBOX_EVENT_STATUS,
  OUTBOX_LAG_STATUS,
  OUTBOX_QUEUE_TOPICS,
  getOutboxEventStatusName,
  parseOutboxEventStatus,
  type OutboxEventStatusCode,
  type OutboxEventStatusName,
  type OutboxLagStatus,
  type OutboxQueueTopic,
} from '@packages/kernel/index.js';

export const OUTBOX_SETTING_KEYS = {
  MAX_RETRIES: 'outbox.max_retries',
  RETRY_BASE_DELAY_MS: 'outbox.retry_base_delay_ms',
  RETRY_MAX_DELAY_MS: 'outbox.retry_max_delay_ms',
  POLL_INTERVAL_MS: 'outbox.poll_interval_ms',
  BATCH_SIZE: 'outbox.batch_size',
  LEASE_TIMEOUT_MS: 'outbox.lease_timeout_ms',
  LAG_WARN_COUNT: 'outbox.lag_warn_count',
  LAG_CRIT_COUNT: 'outbox.lag_crit_count',
  LAG_WARN_AGE_SEC: 'outbox.lag_warn_age_sec',
  LAG_CRIT_AGE_SEC: 'outbox.lag_crit_age_sec',
  DEAD_LETTER_WARN_COUNT: 'outbox.dead_letter_warn_count',
  RETENTION_PUBLISHED_DAYS: 'outbox.retention_published_days',
  RETENTION_DEAD_LETTER_DAYS: 'outbox.retention_dead_letter_days',
  CLEANUP_BATCH_SIZE: 'outbox.cleanup_batch_size',
  ALERT_ADMIN_ROLES: 'outbox.alert_admin_roles',
  ALERT_CHANNELS: 'outbox.alert_channels',
  ALERT_COOLDOWN_SEC: 'outbox.alert_cooldown_sec',
} as const;

export const OUTBOX_AUDIT_META = {
  MODULE: 'outbox',
  FEATURES: {
    REPLAY: 'replay',
    RETENTION: 'retention',
    DISPATCH: 'dispatch',
  },
  RESOURCE_TYPES: {
    EVENT: 'outbox_event',
  },
} as const;

export const OUTBOX_DEFAULT_ALERT_ROLES = ['super_admin', 'admin'] as const;
export const OUTBOX_DEFAULT_ALERT_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export const OUTBOX_DEFAULT_ALERT_COOLDOWN_SEC = 900;
