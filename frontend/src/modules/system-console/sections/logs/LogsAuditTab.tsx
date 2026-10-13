import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { FilterBar, Panel, PanelState, SearchInput } from '@core/ui/blocks';
import type { AuditDomain, LogsWindow } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { AUDIT_DOMAINS, LOGS_WINDOWS } from '../../constants/logs';
import { AuditTable } from '../../components/logs/AuditTable';
import { logsKeys } from './logs-keys';
import type { LogsPage } from './useLogsPage';

const ALL = '__all__';
type Result = 'success' | 'failed';

/** Audit: ai đã thao tác gì trên System Console (xoá cache, retry job, đổi log level…). Chỉ xem, không xoá. */
export function LogsAuditTab({ page }: { page: LogsPage }) {
  const { t, formatRelative } = useLocale();
  const [domain, setDomain] = useState<AuditDomain | typeof ALL>(ALL);
  const [result, setResult] = useState<Result | typeof ALL>(ALL);
  const [win, setWin] = useState<LogsWindow | typeof ALL>(ALL);
  const [q, setQ] = useState('');
  const filter = useMemo(
    () => ({ domain: domain === ALL ? undefined : domain, result: result === ALL ? undefined : result, window: win === ALL ? undefined : win, q: q || undefined }),
    [domain, result, win, q],
  );
  const query = useInfiniteQuery({
    queryKey: logsKeys.audit(filter),
    queryFn: ({ pageParam }) => logsApi.audit(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const last = query.data?.pages[query.data.pages.length - 1];
  const active = domain !== ALL || result !== ALL || win !== ALL || q !== '';

  return (
    <Panel title={t('logs.audit.title')} hint={t('logs.audit.subtitle')} flush>
      <div className="border-b border-border px-3 pt-3">
        <FilterBar
          active={active}
          onClear={() => {
            setDomain(ALL);
            setResult(ALL);
            setWin(ALL);
            setQ('');
          }}
        >
          <Select value={domain} onValueChange={(v) => setDomain(v as AuditDomain | typeof ALL)}>
            <SelectTrigger size="sm" className="w-44" aria-label={t('logs.audit.domainLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('logs.audit.domainLabel')}: {t('logs.filter.all')}
              </SelectItem>
              {AUDIT_DOMAINS.map((d) => (
                <SelectItem key={d} value={d}>
                  {t(`logs.audit.domain.${d}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={result} onValueChange={(v) => setResult(v as Result | typeof ALL)}>
            <SelectTrigger size="sm" className="w-40" aria-label={t('logs.audit.result')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('logs.audit.result')}: {t('logs.filter.all')}
              </SelectItem>
              <SelectItem value="success">{t('cache.ops.status.success')}</SelectItem>
              <SelectItem value="failed">{t('cache.ops.status.failed')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={win} onValueChange={(v) => setWin(v as LogsWindow | typeof ALL)}>
            <SelectTrigger size="sm" className="w-44" aria-label={t('logs.filter.time')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('logs.audit.allTime')}</SelectItem>
              {LOGS_WINDOWS.map((w) => (
                <SelectItem key={w} value={w}>
                  {t(`logs.window.${w}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SearchInput value={q} onChange={setQ} placeholder={t('logs.audit.search')} className="w-72" />
        </FilterBar>
      </div>
      {query.data === undefined ? (
        <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} className="p-3" />
      ) : (
        <AuditTable
          rows={rows}
          navigate={page.navigate}
          loadMore={{ hasMore: Boolean(query.hasNextPage), loading: query.isFetchingNextPage, onLoadMore: () => void query.fetchNextPage() }}
          footer={
            last
              ? t('logs.audit.retention', {
                  total: last.total,
                  sources: last.domains
                    .filter((d) => d.entries > 0)
                    .map((d) => `${t(`logs.audit.domain.${d.domain}`)} ${d.entries}${d.oldestAt ? ` (${formatRelative(d.oldestAt)})` : ''}`)
                    .join(' · '),
                })
              : null
          }
        />
      )}
    </Panel>
  );
}
