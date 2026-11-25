export {
  IDEMPOTENCY_ALERT_STATUS,
  IDEMPOTENCY_DEFAULTS,
  IDEMPOTENCY_OUTCOME,
  IDEMPOTENCY_QUEUE_TOPICS,
  IDEMPOTENCY_SCOPE,
  IDEMPOTENCY_SCOPES,
  IDEMPOTENCY_STATUS,
  getIdempotencyStatusName,
  parseIdempotencyScope,
  parseIdempotencyStatus,
  type IdempotencyAlertStatus,
  type IdempotencyOutcome,
  type IdempotencyQueueTopic,
  type IdempotencyScope,
  type IdempotencyStatusCode,
  type IdempotencyStatusName,
} from '@packages/kernel/index.js';

export const IDEMPOTENCY_SETTING_KEYS = {
  API_TTL_SEC: 'idempotency.ttl.api_sec',
  JOB_TTL_SEC: 'idempotency.ttl.job_sec',
  WEBHOOK_TTL_SEC: 'idempotency.ttl.webhook_sec',
  EVENT_TTL_SEC: 'idempotency.ttl.event_sec',
  FLOW_TTL_OVERRIDES: 'idempotency.flow_ttl_overrides',
  LOCK_LEASE_SEC: 'idempotency.lock_lease_sec',
  MAX_RESPONSE_BYTES: 'idempotency.max_response_bytes',
  CLEANUP_BATCH_SIZE: 'idempotency.cleanup_batch_size',
  DUPLICATE_RATE_WARN_PERCENT: 'idempotency.duplicate_rate_warn_percent',
  DUPLICATE_RATE_CRIT_PERCENT: 'idempotency.duplicate_rate_crit_percent',
  CLIENT_REPEAT_WARN_HITS: 'idempotency.client_repeat_warn_hits',
  CLIENT_REPEAT_CRIT_HITS: 'idempotency.client_repeat_crit_hits',
} as const;

export const IDEMPOTENCY_AUDIT_META = {
  MODULE: 'idempotency',
  FEATURE_RECORDS: 'records',
  FEATURE_CLEANUP: 'cleanup',
  RESOURCE_TYPE: 'idempotency_record',
  ACTION_REVOKE: 'REVOKE',
  ACTION_PURGE: 'PURGE_EXPIRED',
} as const;
