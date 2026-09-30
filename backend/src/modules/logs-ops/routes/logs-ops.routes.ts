/** Logs (Investigation Center): `/ops/logs/*`. Route tĩnh phải khai báo trước route có tham số. */
export const LOGS_OPS_ROUTES = {
  PREFIX: 'ops/logs',
  OVERVIEW: 'overview',
  METRICS: 'metrics',
  SEARCH: '',
  TAIL: 'tail',
  EXPORT: 'export',
  ENTRY: 'entries/:id',
  ERRORS: 'errors',
  ERROR_GROUP: 'errors/:fingerprint',
  TRACE: 'trace/:id',
  AUDIT: 'audit',
  REPORT: 'report',
  CONFIG: 'config',
  LEVEL: 'level',
  LEVEL_REVERT: 'level/:runtime',
} as const;
