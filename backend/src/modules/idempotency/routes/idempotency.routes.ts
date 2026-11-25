export const IDEMPOTENCY_ROUTES = {
  PREFIX: 'idempotency',
  METRICS: 'metrics',
  RECORDS: 'records',
  RECORD_BY_ID: 'records/:id',
  PURGE_EXPIRED: 'purge-expired',
  buildMetricsPath: () => '/api/v1/idempotency/metrics',
  buildRecordsPath: () => '/api/v1/idempotency/records',
  buildRecordByIdPath: (id: number | string) => `/api/v1/idempotency/records/${id}`,
  buildPurgeExpiredPath: () => '/api/v1/idempotency/purge-expired',
} as const;
