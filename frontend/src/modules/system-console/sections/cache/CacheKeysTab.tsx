import { useCallback, useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Trash2, X } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useCursorList, type CursorPage } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button, Hint, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { AvailableView, DataTable, FilterBar, Panel, QueryView, SearchInput } from '@core/ui/blocks';
import type { CacheKeys, KeyFilter, KeyRow } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { KEY_PAGE_SIZE, KEY_TABLE_HEIGHT_PX, KEY_TTL_FILTERS, KEY_TYPES, TTL_SOON_MS } from '../../constants/cache';
import { cacheKeys } from './cache-keys';
import type { CachePage } from './useCachePage';

const ANY = '__any__';
const col = createColumnHelper<KeyRow>();
type KeyPage = CursorPage<KeyRow> & { source: CacheKeys['keys'] };
const rowId = (r: KeyRow) => r.key;

interface CacheKeysTabProps {
  page: CachePage;
  driver: string | undefined;
  actionsEnabled: boolean;
  onDelete: (row: KeyRow) => void;
}

/**
 * Key Explorer: duyệt theo cursor SCAN (không `KEYS *`) — mỗi lần một trang, "Tải thêm" để quét tiếp.
 * Lọc theo pattern, type, TTL, namespace (trên URL). Không tự làm mới để không quét Redis liên tục.
 */
export function CacheKeysTab({ page, driver, actionsEnabled, onDelete }: CacheKeysTabProps) {
  const { t } = useLocale();
  const f = useFormat();
  const { filter, setFilter } = page;
  const fetchPage = useCallback(
    async (cursor: string | null): Promise<KeyPage> => {
      const res = await cacheApi.keys(filter, cursor ?? '0', KEY_PAGE_SIZE);
      return { items: res.keys.available ? res.keys.data : [], next: res.done ? null : res.cursor, examined: res.examined, source: res.keys };
    },
    [filter],
  );
  const list = useCursorList<KeyRow, KeyPage>(cacheKeys.keys(filter), fetchPage, rowId);
  const filtered = Boolean(filter.match || filter.type || filter.namespace || filter.ttl !== 'any');

  const columns = useMemo(
    () => [
      col.accessor('key', {
        header: t('cache.key.key'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-fg">{c.getValue()}</div>
            <div className="truncate text-2xs text-faint">{c.row.original.namespace}</div>
          </div>
        ),
        meta: { truncate: true },
      }),
      col.accessor('type', { header: t('cache.key.type'), cell: (c) => c.getValue() ?? NO_VALUE, meta: { width: '90px', mono: true } }),
      col.accessor('bytes', { header: t('cache.key.size'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => r.ttlMs ?? Number.MAX_SAFE_INTEGER, {
        id: 'ttl',
        header: t('cache.key.ttl'),
        cell: (c) => {
          const ms = c.row.original.ttlMs;
          return ms === null ? <span className="text-faint">{t('cache.ttl.none')}</span> : <span className={ms < TTL_SOON_MS ? 'text-warn-fg' : undefined}>{f.duration(ms)}</span>;
        },
        meta: { align: 'right', mono: true, width: '120px', className: 'whitespace-nowrap' },
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">{t('cache.key.delete')}</span>,
        cell: (c) => (
          <Hint content={actionsEnabled ? t('cache.key.delete') : t('cache.action.disabled')}>
            <span>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!actionsEnabled}
                aria-label={t('cache.key.delete')}
                onClick={(e) => (e.stopPropagation(), onDelete(c.row.original))}
              >
                <Trash2 className="text-crit-fg" />
              </Button>
            </span>
          </Hint>
        ),
        meta: { align: 'right', width: '48px' },
      }),
    ],
    [t, f, actionsEnabled, onDelete],
  );

  return (
    <Panel title={t('cache.keys.title')} hint={t('cache.keys.hint')} flush>
      <div className="px-3 pt-3">
        <FilterBar active={filtered} onClear={() => setFilter({ match: '', type: '', ttl: 'any', namespace: '' })}>
          <SearchInput value={filter.match} onChange={(match) => setFilter({ match: match.trim() })} placeholder={t('cache.keys.searchPlaceholder')} className="w-full sm:w-72" />
          <Select value={filter.type || ANY} onValueChange={(v) => setFilter({ type: v === ANY ? '' : v })} disabled={driver !== 'redis'}>
            <SelectTrigger size="sm" className="w-36" aria-label={t('cache.key.type')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('cache.keys.anyType')}</SelectItem>
              {KEY_TYPES.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter.ttl} onValueChange={(v) => setFilter({ ttl: v as KeyFilter['ttl'] })}>
            <SelectTrigger size="sm" className="w-40" aria-label={t('cache.key.ttl')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KEY_TTL_FILTERS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`cache.keys.ttl.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filter.namespace && (
            <Badge className="h-7 gap-1.5">
              {t('cache.key.namespace')}: <span className="font-mono">{filter.namespace}</span>
              <button type="button" onClick={() => setFilter({ namespace: '' })} aria-label={t('cache.keys.clearNamespace')} className="text-faint hover:text-fg">
                <X />
              </button>
            </Badge>
          )}
        </FilterBar>
      </div>
      <QueryView query={list.query}>
        {() => (
          <AvailableView source={list.last?.source} onRetry={() => void list.query.refetch()} messages={{ unsupported: t('cache.unsupported.message', { driver: driver ? t(`cache.driver.${driver}`) : '' }) }}>
            {() => (
              <DataTable
                data={list.items}
                columns={columns}
                getRowId={rowId}
                onRowClick={(r) => page.openKey(r.key)}
                activeRowId={page.keyId}
                emptyMessage={filtered ? t('cache.keys.noMatch') : t('cache.empty.title')}
                maxHeight={KEY_TABLE_HEIGHT_PX}
                virtual
                loadMore={{ hasMore: list.hasMore, loading: list.loadingMore, onLoadMore: list.loadMore }}
                footer={
                  <span>
                    {t('cache.keys.showing', { count: f.compact(list.items.length), examined: f.compact(list.examined) })}
                    {!list.hasMore && list.items.length > 0 && <span className="text-faint"> · {t('cache.keys.end')}</span>}
                  </span>
                }
              />
            )}
          </AvailableView>
        )}
      </QueryView>
    </Panel>
  );
}
