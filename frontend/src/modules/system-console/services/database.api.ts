import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  DbConfig,
  DbConnectionDetail,
  DbConnections,
  DbErrors,
  DbEvent,
  DbExplain,
  DbMetric,
  DbMetrics,
  DbMigrations,
  DbOverview,
  DbPing,
  DbQueryDetail,
  DbQueryStat,
  DbRange,
  DbSession,
  DbStorage,
  DbTableDetail,
  DbTable,
  DbTransactions,
  Section,
} from '../types/database.types';
import { toQuery } from './traffic.api';

const D = API_ROUTES.OPS.DATABASE.path;
const post = <T>(path: string, confirm?: string) =>
  fetchApi<T>(D(path), { method: 'POST', body: JSON.stringify(confirm ? { confirm } : {}) });

export const databaseApi = {
  overview: (range: DbRange) => fetchApi<DbOverview>(D('overview', toQuery({ range }))),
  metrics: (range: DbRange, metric: DbMetric) => fetchApi<DbMetrics>(D('metrics', toQuery({ range, metric }))),
  liveQueries: () => fetchApi<{ sessions: Section<DbSession[]>; slowQueryMs: number; actionsEnabled: boolean }>(D('queries')),
  queryStats: (range: DbRange, minMs: number) =>
    fetchApi<{ stats: Section<DbQueryStat[]>; minMs: number; range: DbRange }>(D('queries/stats', toQuery({ range, minMs }))),
  queryDetail: (id: string, range: DbRange) => fetchApi<DbQueryDetail>(D(`queries/stats/${encodeURIComponent(id)}`, toQuery({ range }))),
  explain: (id: string) => fetchApi<DbExplain>(D(`queries/stats/${encodeURIComponent(id)}/explain`)),
  cancel: (sessionId: string) => post<{ ok: true }>(`queries/${sessionId}/cancel`, 'CANCEL'),
  connections: () => fetchApi<DbConnections>(D('connections')),
  connection: (id: string) => fetchApi<DbConnectionDetail>(D(`connections/${id}`)),
  terminate: (sessionId: string, confirm: string) => post<{ ok: true }>(`connections/${sessionId}/terminate`, confirm),
  transactions: () => fetchApi<DbTransactions>(D('transactions')),
  tables: () => fetchApi<{ tables: Section<DbTable[]> }>(D('tables')),
  table: (name: string) => fetchApi<DbTableDetail>(D(`tables/${encodeURIComponent(name)}`)),
  storage: () => fetchApi<DbStorage>(D('storage')),
  migrations: () => fetchApi<DbMigrations>(D('migrations')),
  runMigrations: (confirm: string) => post<DbMigrations['lastRun']>('migrations/run', confirm),
  events: (range: DbRange) => fetchApi<DbEvent[]>(D('events', toQuery({ range }))),
  errors: (range: DbRange) => fetchApi<DbErrors>(D('errors', toQuery({ range }))),
  config: () => fetchApi<DbConfig>(D('config')),
  ping: () => post<DbPing>('ping'),
};
