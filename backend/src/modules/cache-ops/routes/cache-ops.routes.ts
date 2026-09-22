const PREFIX = 'ops/cache';

export const CACHE_OPS_ROUTES = {
  PREFIX,
  OVERVIEW: 'overview',
  METRICS: 'metrics',
  NAMESPACES: 'namespaces',
  NAMESPACE_DETAIL: 'namespaces/:name',
  NAMESPACE_CLEAR: 'namespaces/:name/clear',
  KEYS: 'keys',
  KEY_DETAIL: 'keys/detail',
  MEMORY: 'memory',
  TTL: 'ttl',
  CLIENTS: 'clients',
  EVENTS: 'events',
  ERRORS: 'errors',
  OPERATIONS: 'operations',
  CONFIG: 'config',
  FLUSH_IMPACT: 'flush/impact',
  FLUSH: 'flush',
  PING: 'ping',
} as const;
