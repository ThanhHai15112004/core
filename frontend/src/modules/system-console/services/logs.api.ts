import { ApiError, fetchApi } from '../../../core/services/api';
import { getActiveLocale } from '../../../core/i18n/index';
import { frontendConfig } from '../../../config/index';
import { API_ROUTES } from '../../../routes/index';
import type {
  AuditDomain,
  AuditList,
  ErrorGroupDetail,
  ErrorGroups,
  ExportFormat,
  LevelState,
  LogDetail,
  LogFilters,
  LogSearchResult,
  LogTailResult,
  LogsConfig,
  LogsOverview,
  LogsRange,
  LogsReport,
  LogsSeries,
  LogsWindow,
  OverrideLevel,
  Trace,
} from '../types/logs.types';
import { toQuery } from './traffic.api';

const L = API_ROUTES.OPS.LOGS_CENTER.path;
const id = (v: string) => encodeURIComponent(v);
const filterQuery = (f: LogFilters) => ({ ...f }) as Record<string, string | undefined>;

export const logsApi = {
  overview: (range: LogsRange) => fetchApi<LogsOverview>(L('overview', toQuery({ range }))),
  series: (range: LogsRange) => fetchApi<LogsSeries>(L('metrics', toQuery({ range }))),
  search: (filters: LogFilters, cursor?: string | null, limit = 100) =>
    fetchApi<LogSearchResult>(L('', toQuery({ ...filterQuery(filters), cursor: cursor ?? undefined, limit }))),
  tail: (filters: LogFilters, after: string | null, limit = 200) =>
    fetchApi<LogTailResult>(L('tail', toQuery({ ...filterQuery(filters), after: after ?? undefined, limit }))),
  entry: (logId: string) => fetchApi<LogDetail>(L(`entries/${id(logId)}`)),
  errors: (range: LogsRange, q?: string) => fetchApi<ErrorGroups>(L('errors', toQuery({ range, q }))),
  errorGroup: (fingerprint: string, range: LogsRange) => fetchApi<ErrorGroupDetail>(L(`errors/${id(fingerprint)}`, toQuery({ range }))),
  trace: (traceId: string) => fetchApi<Trace>(L(`trace/${id(traceId)}`)),
  audit: (q: { window?: LogsWindow; domain?: AuditDomain; result?: 'success' | 'failed'; q?: string }, cursor?: string | null) =>
    fetchApi<AuditList>(L('audit', toQuery({ ...q, cursor: cursor ?? undefined }))),
  report: () => fetchApi<LogsReport>(L('report')),
  config: () => fetchApi<LogsConfig>(L('config')),
  setLevel: (body: { runtime: string; level: OverrideLevel; durationMin: number | null; modules: string[] }) =>
    fetchApi<LevelState>(L('level'), { method: 'PUT', body: JSON.stringify(body) }),
  revertLevel: (runtime: string) => fetchApi<LevelState>(L(`level/${id(runtime)}`), { method: 'DELETE' }),
  /** Tải file export theo bộ lọc (server giới hạn số dòng, có audit); trả số dòng đã xuất. */
  exportFile: async (filters: LogFilters, format: ExportFormat, limit: number): Promise<number> => {
    const res = await fetch(`${frontendConfig.apiBaseUrl}${L('export', toQuery({ ...filterQuery(filters), format, limit }))}`, {
      headers: { 'Accept-Language': getActiveLocale() },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
      throw new ApiError(body?.error?.message ?? res.statusText, res.status, body?.error?.code);
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `logs.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return Number(res.headers.get('x-export-count') ?? 0);
  },
};
