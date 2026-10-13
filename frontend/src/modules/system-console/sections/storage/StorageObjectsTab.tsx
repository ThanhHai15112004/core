import { useCallback, useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useCursorList, useLiveQuery, type CursorPage } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { AvailableView, DataTable, FilterBar, Panel, PanelState, QueryView, RelativeTime, SearchInput } from '@core/ui/blocks';
import type { ObjectFilter, ObjectRow, StorageObjects, StorageOverview } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { MIN_SIZE_MB_OPTIONS, OBJECT_AGES, OBJECT_KINDS, OBJECT_PAGE_SIZE, OBJECT_TABLE_HEIGHT_PX } from '../../constants/storage';
import { ContainerTable } from '../../components/storage/ContainerTable';
import { useContainerLabel } from '../../components/storage/useContainerLabel';
import { storageKeys } from './storage-keys';
import type { StoragePage } from './useStoragePage';

const ANY = '__any__';
const MB = 1024 * 1024;
const col = createColumnHelper<ObjectRow>();
type ObjectPage = CursorPage<ObjectRow> & { source: StorageObjects['objects'] };
const rowId = (r: ObjectRow) => r.key;

/**
 * Container & Object: bảng container (prefix cấp 1 / thư mục gốc) + Object Explorer phân trang theo cursor
 * (không liệt kê toàn bộ storage một lượt). Bộ lọc nằm trên URL; danh sách object không tự làm mới.
 */
export function StorageObjectsTab({ page, data }: { page: StoragePage; data: StorageOverview | undefined }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const label = useContainerLabel();
  const { filter, setFilter, range } = page;
  const caps = data?.capabilities;
  const product = data?.provider.product ?? '';
  const containersOk = !caps || caps.includes('containers');
  const listOk = !caps || caps.includes('listObjects');
  const containers = useLiveQuery(storageKeys.containers(range), () => storageApi.containers(range), { tier: 'slow', enabled: containersOk });

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<ObjectPage> => {
      const res = await storageApi.objects(filter, cursor ?? '', OBJECT_PAGE_SIZE);
      return { items: res.objects.available ? res.objects.data : [], next: res.done ? null : res.cursor, examined: res.examined, source: res.objects };
    },
    [filter],
  );
  const list = useCursorList<ObjectRow, ObjectPage>(storageKeys.objects(filter), fetchPage, rowId, { enabled: listOk });
  const filtered = Boolean(filter.container || filter.prefix || filter.kind || filter.age || filter.minSizeMb);
  const unsupported = t('storage.unsupported.message', { product });

  const columns = useMemo(
    () => [
      col.accessor('key', { header: t('storage.object.key'), cell: (c) => <span className="font-mono text-xs text-fg">{c.getValue()}</span>, meta: { truncate: true } }),
      col.accessor('kind', { header: t('storage.objects.kind'), cell: (c) => t(`storage.kind.${c.getValue()}`), meta: { width: '100px' } }),
      col.accessor('size', { header: t('storage.object.size'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor('lastModified', {
        header: t('storage.object.modified'),
        cell: (c) => <RelativeTime value={c.getValue()} className="text-xs" />,
        meta: { align: 'right', width: '130px' },
      }),
    ],
    [t, f],
  );

  return (
    <>
      <Panel
        title={t(`storage.container.title.${data?.provider.driver === 's3' ? 's3' : 'local'}`)}
        hint={t('storage.container.note')}
        flush
        className="mb-4"
        actions={
          containers.data ? (
            <span className="truncate text-xs text-muted">
              <span className="font-mono">{containers.data.location}</span>
              {containers.data.usageAt && ` · ${t('storage.usage.scannedAt', { time: formatTime(containers.data.usageAt, true) })}`}
              {containers.data.truncated && <span className="text-warn-fg"> · {t('storage.usage.truncated')}</span>}
            </span>
          ) : undefined
        }
      >
        {!containersOk ? (
          <PanelState status="no-source" compact message={unsupported} />
        ) : (
          <QueryView query={containers} compact>
            {(c) => <ContainerTable rows={c.containers} onOpen={(r) => page.openContainer(r.name)} activeName={page.containerId} emptyMessage={t('storage.empty')} />}
          </QueryView>
        )}
      </Panel>

      <Panel title={t('storage.objects.title')} hint={t('storage.objects.hint')} flush>
        {!listOk ? (
          <PanelState status="no-source" compact message={unsupported} />
        ) : (
          <>
            <div className="px-3 pt-3">
              <FilterBar active={filtered} onClear={() => setFilter({ container: '', prefix: '', kind: '', age: '', minSizeMb: '' })}>
                <Select value={filter.container || ANY} onValueChange={(v) => setFilter({ container: v === ANY ? '' : v })}>
                  <SelectTrigger size="sm" className="w-44" aria-label={t('storage.object.container')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{t('storage.objects.allContainers')}</SelectItem>
                    {(containers.data?.containers ?? []).map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {label(c.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <SearchInput value={filter.prefix} onChange={(prefix) => setFilter({ prefix: prefix.trim() })} placeholder={t('storage.objects.prefixPlaceholder')} className="w-full sm:w-64" />
                <Select value={filter.kind || ANY} onValueChange={(v) => setFilter({ kind: v === ANY ? '' : (v as ObjectFilter['kind']) })}>
                  <SelectTrigger size="sm" className="w-32" aria-label={t('storage.objects.kind')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{t('storage.objects.anyKind')}</SelectItem>
                    {OBJECT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`storage.kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filter.age || ANY} onValueChange={(v) => setFilter({ age: v === ANY ? '' : (v as ObjectFilter['age']) })}>
                  <SelectTrigger size="sm" className="w-32" aria-label={t('storage.objects.age')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{t('storage.objects.anyAge')}</SelectItem>
                    {OBJECT_AGES.map((a) => (
                      <SelectItem key={a} value={a}>
                        {t(`storage.objects.ageOpt.${a}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filter.minSizeMb || ANY} onValueChange={(v) => setFilter({ minSizeMb: v === ANY ? '' : v })}>
                  <SelectTrigger size="sm" className="w-36" aria-label={t('storage.objects.size')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{t('storage.objects.anySize')}</SelectItem>
                    {MIN_SIZE_MB_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t('storage.objects.minSize', { size: f.bytes(Number(s) * MB) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterBar>
            </div>
            <QueryView query={list.query}>
              {() => (
                <AvailableView source={list.last?.source} onRetry={() => void list.query.refetch()} messages={{ unsupported }}>
                  {() => (
                    <DataTable
                      data={list.items}
                      columns={columns}
                      getRowId={rowId}
                      onRowClick={(r) => page.openObject(r.key)}
                      activeRowId={page.objectId}
                      emptyMessage={filtered ? t('storage.objects.noMatch') : t('storage.empty')}
                      maxHeight={OBJECT_TABLE_HEIGHT_PX}
                      virtual
                      loadMore={{ hasMore: list.hasMore, loading: list.loadingMore, onLoadMore: list.loadMore }}
                      footer={
                        <span>
                          {t('storage.objects.showing', { count: f.compact(list.items.length), examined: f.compact(list.examined) })}
                          {!list.hasMore && list.items.length > 0 && <span className="text-faint"> · {t('storage.objects.end')}</span>}
                        </span>
                      }
                    />
                  )}
                </AvailableView>
              )}
            </QueryView>
          </>
        )}
      </Panel>
    </>
  );
}
