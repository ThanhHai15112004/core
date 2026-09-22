import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  CacheClients,
  CacheConfig,
  CacheErrors,
  CacheEvent,
  CacheKeys,
  CacheMemory,
  CacheMetric,
  CacheMetrics,
  CacheNamespaces,
  CacheOperation,
  CacheOverview,
  CachePing,
  CacheRange,
  CacheTtl,
  FlushImpact,
  KeyDetail,
  KeyFilter,
  NamespaceDetail,
} from '../types/cache.types';
import { toQuery } from './traffic.api';

const C = API_ROUTES.OPS.CACHE.path;
const send = <T>(method: 'POST' | 'DELETE', path: string, qs = '', confirm?: string) =>
  fetchApi<T>(C(path, qs), { method, body: JSON.stringify(confirm ? { confirm } : {}) });

export const cacheApi = {
  overview: (range: CacheRange) => fetchApi<CacheOverview>(C('overview', toQuery({ range }))),
  metrics: (range: CacheRange, metric: CacheMetric) => fetchApi<CacheMetrics>(C('metrics', toQuery({ range, metric }))),
  namespaces: (range: CacheRange) => fetchApi<CacheNamespaces>(C('namespaces', toQuery({ range }))),
  namespace: (name: string, range: CacheRange) => fetchApi<NamespaceDetail>(C(`namespaces/${encodeURIComponent(name)}`, toQuery({ range }))),
  keys: (f: KeyFilter, cursor: string, count = 100) =>
    fetchApi<CacheKeys>(
      C(
        'keys',
        toQuery({
          match: f.match || undefined,
          type: f.type || undefined,
          ttl: f.ttl === 'any' ? undefined : f.ttl,
          namespace: f.namespace || undefined,
          cursor,
          count,
        }),
      ),
    ),
  key: (key: string) => fetchApi<KeyDetail>(C('keys/detail', toQuery({ key }))),
  deleteKey: (key: string) => send<CacheOperation>('DELETE', 'keys', toQuery({ key }), 'DELETE'),
  clearNamespace: (name: string, confirm: string) => send<CacheOperation>('POST', `namespaces/${encodeURIComponent(name)}/clear`, '', confirm),
  memory: (range: CacheRange) => fetchApi<CacheMemory>(C('memory', toQuery({ range }))),
  ttl: () => fetchApi<CacheTtl>(C('ttl')),
  clients: () => fetchApi<CacheClients>(C('clients')),
  events: (range: CacheRange) => fetchApi<CacheEvent[]>(C('events', toQuery({ range }))),
  errors: (range: CacheRange) => fetchApi<CacheErrors>(C('errors', toQuery({ range }))),
  operations: () => fetchApi<CacheOperation[]>(C('operations')),
  config: () => fetchApi<CacheConfig>(C('config')),
  flushImpact: () => fetchApi<FlushImpact>(C('flush/impact')),
  flush: (confirm: string) => send<CacheOperation>('POST', 'flush', '', confirm),
  ping: () => send<CachePing>('POST', 'ping'),
};
