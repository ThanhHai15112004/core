import { useMemo } from 'react';
import { Flame } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { toneOf } from '@core/theme';
import { Button, Hint } from '@core/ui/primitives';
import { ActivityFeed, Panel, PanelGrid, PanelState, type ActivityItem } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { CacheOverview } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { ACTIVITY_MAX_HEIGHT_PX, CACHE_ERROR_KINDS } from '../../constants/cache';
import { cacheKeys } from './cache-keys';
import type { CachePage } from './useCachePage';

/**
 * Hoạt động: lỗi cache (→ log theo correlationId), sự kiện (kết nối, cảnh báo) và thao tác quản trị (audit) trên một
 * dòng thời gian; bên cạnh là số lỗi theo loại và Danger Zone (flush toàn bộ cache).
 */
export function CacheActivityTab({ page, data, onFlush }: { page: CachePage; data: CacheOverview | undefined; onFlush: () => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const { range } = page;
  const events = useLiveQuery(cacheKeys.events(range), () => cacheApi.events(range));
  const errors = useLiveQuery(cacheKeys.errors(range), () => cacheApi.errors(range));
  const operations = useLiveQuery(cacheKeys.operations(), () => cacheApi.operations(), { tier: 'slow' });

  const items = useMemo<ActivityItem[]>(() => {
    const out: ActivityItem[] = [];
    (errors.data?.items ?? []).forEach((e, i) =>
      out.push({
        id: `err-${e.at}-${i}`,
        at: e.at,
        kind: 'error',
        tone: e.kind === 'oom' ? 'crit' : 'warn',
        title: `${t(`cache.errors.kind.${e.kind}`)} · ${e.operation.toUpperCase()} ${e.namespace}`,
        detail: e.message,
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
        title: t(`cache.event.${e.type}`),
        detail: e.message,
        source: e.runtime ? t(`rt.name.${e.runtime}`) : null,
        onClick: e.tab ? () => page.goLegacy(e.tab!) : undefined,
      });
    }
    for (const o of operations.data ?? []) {
      const who = `${o.actor ?? t('cache.ops.anonymous')}${o.ip ? ` (${o.ip})` : ''}`;
      out.push({
        id: `op-${o.id}`,
        at: o.at,
        kind: 'operation',
        tone: o.result === 'success' ? 'ok' : 'crit',
        title: `${t(`cache.ops.kind.${o.action}`)}${o.action === 'flush_all' ? '' : ` · ${o.target}`}`,
        detail: [t('cache.ops.affectedKeys', { count: f.compact(o.affected) }), f.duration(o.durationMs), who, o.error].filter(Boolean).join(' · '),
        source: t(`cache.ops.status.${o.result}`),
      });
    }
    return out;
  }, [errors.data, events.data, operations.data, t, f, page]);

  const loading = events.data === undefined && errors.data === undefined && operations.data === undefined;
  const failed = events.isError && errors.isError && operations.isError;
  const retry = () => {
    void events.refetch();
    void errors.refetch();
    void operations.refetch();
  };
  const counts = errors.data?.counts;
  const flushEnabled = data?.settings.flushEnabled ?? false;
  const flushButton = (
    <Button size="sm" variant="danger" disabled={!flushEnabled} onClick={onFlush}>
      <Flame />
      {t('cache.danger.flushButton')}
    </Button>
  );

  return (
    <PanelGrid layout="2-1">
      <Panel title={t('cache.activity.title')} hint={t('cache.activity.hint', { range: t(`ui.time.ranges.${range}`) })}>
        {loading && failed ? (
          <PanelState status="error" error={events.error} onRetry={retry} />
        ) : loading ? (
          <PanelState status="loading" />
        ) : (
          <ActivityFeed
            items={items}
            kinds={{ error: t('cache.activity.kind.error'), event: t('cache.activity.kind.event'), operation: t('cache.activity.kind.operation') }}
            emptyMessage={t('cache.events.empty')}
            maxHeight={ACTIVITY_MAX_HEIGHT_PX}
          />
        )}
      </Panel>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title={t('cache.errors.byKind')} hint={t('cache.errors.hint')}>
          {counts ? (
            <BarList
              items={CACHE_ERROR_KINDS.map((k) => ({
                id: k,
                label: t(`cache.errors.kind.${k}`),
                value: counts[k],
                display: f.number(counts[k]),
                tone: counts[k] > 0 ? (k === 'oom' ? 'crit' : 'warn') : undefined,
              }))}
            />
          ) : (
            <PanelState status={errors.isError ? 'error' : 'loading'} error={errors.error} onRetry={() => void errors.refetch()} compact />
          )}
        </Panel>
        <Panel title={t('cache.danger.title')} hint={`${t('cache.danger.flushDescription')} ${t('cache.danger.prefer')}`} className="border-crit-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-sm font-medium text-fg">{t('cache.danger.flushTitle')}</div>
            {flushEnabled ? (
              flushButton
            ) : (
              <Hint content={t('cache.danger.disabled')}>
                <span>{flushButton}</span>
              </Hint>
            )}
          </div>
          {!data?.settings.actionsEnabled && data && <p className="mt-2 text-xs text-faint">{t('cache.action.disabled')}</p>}
        </Panel>
      </div>
    </PanelGrid>
  );
}
