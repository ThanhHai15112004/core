import { useMemo } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { toneOf } from '@core/theme';
import { ActivityFeed, Panel, PanelGrid, PanelState, type ActivityItem } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import { storageApi } from '../../services/storage.api';
import { ACTIVITY_MAX_HEIGHT_PX, STORAGE_ERROR_KINDS, STORAGE_OPS } from '../../constants/storage';
import { storageKeys } from './storage-keys';
import type { StoragePage } from './useStoragePage';

/**
 * Hoạt động: lỗi storage (→ log theo correlationId), sự kiện (kết nối, cảnh báo) và audit thao tác từ Console
 * trên một dòng thời gian; bên cạnh là số lỗi theo thao tác và theo loại.
 */
export function StorageActivityTab({ page, driver }: { page: StoragePage; driver: 'local' | 's3' | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const { range } = page;
  const events = useLiveQuery(storageKeys.events(range), () => storageApi.events(range));
  const errors = useLiveQuery(storageKeys.errors(range), () => storageApi.errors(range));
  const operations = useLiveQuery(storageKeys.operations(), () => storageApi.operations(), { tier: 'slow' });
  const opName = (op: string) => t(`storage.ops.name.${driver === 'local' ? 'local' : 's3'}.${op}`);

  const items = useMemo<ActivityItem[]>(() => {
    const out: ActivityItem[] = [];
    (errors.data?.items ?? []).forEach((e, i) =>
      out.push({
        id: `err-${e.at}-${i}`,
        at: e.at,
        kind: 'error',
        tone: e.kind === 'not_found' ? 'unknown' : 'warn',
        title: `${opName(e.op)} · ${e.key}`,
        detail: [t(`storage.errors.kind.${e.kind}`), e.code, e.httpStatus, e.message].filter((x) => x !== null && x !== '').join(' · '),
        source: e.runtime ? t(`rt.name.${e.runtime}`) : null,
        onClick: e.correlationId ? () => page.navigate(`logs/explorer?correlationId=${encodeURIComponent(e.correlationId!)}`) : undefined,
      }),
    );
    for (const e of events.data ?? []) {
      out.push({
        id: `ev-${e.id}`,
        at: e.at,
        kind: 'event',
        tone: toneOf(e.severity),
        title: t(`storage.event.${e.type}`),
        detail: e.message,
        source: e.runtime ? t(`rt.name.${e.runtime}`) : null,
        onClick: e.tab ? () => page.goLegacy(e.tab!) : undefined,
      });
    }
    for (const o of operations.data ?? []) {
      const who = `${o.actor ?? t('storage.audit.anonymous')}${o.ip ? ` (${o.ip})` : ''}`;
      const detail = o.detail ? (o.action === 'download' ? f.bytes(Number(o.detail)) : o.detail) : null;
      out.push({
        id: `op-${o.id}`,
        at: o.at,
        kind: 'operation',
        tone: o.result === 'success' ? 'ok' : 'crit',
        title: `${t(`storage.audit.kind.${o.action}`)} · ${o.target}`,
        detail: [detail, f.duration(o.durationMs), who, o.error].filter(Boolean).join(' · '),
        source: t(`storage.audit.status.${o.result}`),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors.data, events.data, operations.data, t, f, page, driver]);

  const loading = events.data === undefined && errors.data === undefined && operations.data === undefined;
  const failed = events.isError && errors.isError && operations.isError;
  const retry = () => {
    void events.refetch();
    void errors.refetch();
    void operations.refetch();
  };
  const d = errors.data;
  const breakdownState = <PanelState status={errors.isError ? 'error' : 'loading'} error={errors.error} onRetry={() => void errors.refetch()} compact />;

  return (
    <PanelGrid layout="2-1">
      <Panel title={t('storage.activity.title')} hint={`${t('storage.activity.hint', { range: t(`ui.time.ranges.${range}`) })} ${t('storage.audit.note')}`}>
        {loading && failed ? (
          <PanelState status="error" error={events.error} onRetry={retry} />
        ) : loading ? (
          <PanelState status="loading" />
        ) : (
          <ActivityFeed
            items={items}
            kinds={{ error: t('storage.activity.kind.error'), event: t('storage.activity.kind.event'), operation: t('storage.activity.kind.operation') }}
            emptyMessage={t('storage.events.empty')}
            maxHeight={ACTIVITY_MAX_HEIGHT_PX}
          />
        )}
      </Panel>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title={t('storage.errors.byOp')}>
          {d ? (
            <BarList
              items={STORAGE_OPS.map((op) => ({ id: op, label: opName(op), value: d.byOp[op], display: f.number(d.byOp[op]), tone: d.byOp[op] > 0 ? 'warn' : undefined }))}
            />
          ) : (
            breakdownState
          )}
        </Panel>
        <Panel title={t('storage.errors.byKind')} hint={t('storage.errors.hint')}>
          {d ? (
            <BarList
              items={STORAGE_ERROR_KINDS.map((k) => ({
                id: k,
                label: t(`storage.errors.kind.${k}`),
                value: d.counts[k],
                display: f.number(d.counts[k]),
                tone: d.counts[k] > 0 ? (k === 'not_found' ? 'unknown' : 'warn') : undefined,
              }))}
            />
          ) : (
            breakdownState
          )}
        </Panel>
      </div>
    </PanelGrid>
  );
}
