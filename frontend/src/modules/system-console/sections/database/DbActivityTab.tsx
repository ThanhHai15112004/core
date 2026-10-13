import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button } from '@core/ui/primitives';
import { ActivityFeed, CodeBlock, DetailSection, DetailSheet, KeyValueGrid, Panel, PanelState, StatGrid, StatTile, type ActivityItem } from '@core/ui/blocks';
import type { DbErrorRecord } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { DB_FEED_MAX_HEIGHT_PX, DB_SQL_MAX_HEIGHT_PX, ERROR_KINDS, EVENT_TONE, SQL_PREVIEW_CHARS } from '../../constants/database';
import { dateTime, runtimeLabel } from '../../components/database/db-labels';
import { dbKeys } from './database-keys';
import type { DatabasePage } from './useDatabasePage';

const preview = (sql: string) => (sql.length > SQL_PREVIEW_CHARS ? `${sql.slice(0, SQL_PREVIEW_CHARS)}…` : sql);

/** Hoạt động: số lỗi query theo loại + dòng thời gian gộp lỗi query và sự kiện database (mất kết nối, cảnh báo, migration, thao tác). */
export function DbActivityTab({ page }: { page: DatabasePage }) {
  const { t } = useLocale();
  const f = useFormat();
  const errors = useLiveQuery(dbKeys.errors(page.range), () => databaseApi.errors(page.range));
  const events = useLiveQuery(dbKeys.events(page.range), () => databaseApi.events(page.range));
  const [selected, setSelected] = useState<DbErrorRecord | null>(null);
  const d = errors.data;

  const items: ActivityItem[] = useMemo(
    () => [
      ...(errors.data?.items ?? []).map((e, i) => ({
        id: `err-${e.at}-${i}`,
        at: e.at,
        tone: e.kind === 'cancelled' ? ('unknown' as const) : ('warn' as const),
        kind: 'error',
        title: `${t(`db.errors.kind.${e.kind}`)}${e.code ? ` · ${e.code}` : ''} — ${e.message}`,
        detail: preview(e.sql),
        source: e.runtime ? runtimeLabel(e.runtime, t) : null,
        onClick: () => setSelected(e),
      })),
      ...(events.data ?? []).map((e) => ({
        id: `evt-${e.id}`,
        at: e.at,
        tone: EVENT_TONE[e.severity],
        kind: 'event',
        title: t(`db.event.${e.type}`),
        detail: e.message,
        source: e.runtime ? runtimeLabel(e.runtime, t) : null,
        onClick: e.tab ? () => page.goLegacy(e.tab) : undefined,
      })),
    ],
    [errors.data, events.data, t, page],
  );

  const failedBoth = errors.isError && events.isError && !errors.data && !events.data;
  const loading = (!errors.data && !errors.isError) || (!events.data && !events.isError);
  const retry = () => {
    void errors.refetch();
    void events.refetch();
  };

  return (
    <>
      <StatGrid columns={6}>
        {ERROR_KINDS.map((k) => (
          <StatTile
            key={k}
            label={t(`db.errors.kind.${k}`)}
            value={d ? f.number(d.counts[k]) : NO_VALUE}
            tone={d ? (d.counts[k] > 0 ? (k === 'cancelled' ? undefined : 'warn') : 'ok') : undefined}
            loading={!d && !errors.isError}
          />
        ))}
      </StatGrid>

      <Panel title={t('db.activity.title')} hint={t('db.errors.hint')}>
        {failedBoth ? (
          <PanelState status="error" error={errors.error} onRetry={retry} />
        ) : loading && items.length === 0 ? (
          <PanelState status="loading" />
        ) : (
          <>
            {(errors.isError || events.isError) && <PanelState status="error" compact error={errors.error ?? events.error} onRetry={retry} className="mb-2" />}
            <ActivityFeed
              items={items}
              kinds={{ error: t('db.activity.kind.error'), event: t('db.activity.kind.event') }}
              emptyMessage={t('db.activity.empty', { range: t(`ui.time.ranges.${page.range}`) })}
              maxHeight={DB_FEED_MAX_HEIGHT_PX}
            />
          </>
        )}
      </Panel>

      <ErrorDetailSheet error={selected} onClose={() => setSelected(null)} onLogs={(id) => page.navigate(`logs/explorer?correlationId=${encodeURIComponent(id)}`)} />
    </>
  );
}

function ErrorDetailSheet({ error, onClose, onLogs }: { error: DbErrorRecord | null; onClose: () => void; onLogs: (correlationId: string) => void }) {
  const { t, locale, formatTime } = useLocale();
  return (
    <DetailSheet
      open={Boolean(error)}
      onOpenChange={(o) => !o && onClose()}
      title={error ? t(`db.errors.kind.${error.kind}`) : t('db.errors.title')}
      subtitle={error ? dateTime(error.at, locale, formatTime, true) : undefined}
      status={error ? { tone: error.kind === 'cancelled' ? 'unknown' : 'warn', label: error.code ?? t(`db.errors.kind.${error.kind}`) } : undefined}
      actions={
        error?.correlationId ? (
          <Button size="sm" onClick={() => onLogs(error.correlationId!)}>
            <FileText />
            {t('db.query.openLogs')}
          </Button>
        ) : undefined
      }
    >
      {error && (
        <>
          <DetailSection title={t('db.errors.message')}>
            <p className="break-words text-sm text-fg">{error.message}</p>
          </DetailSection>
          <DetailSection title={t('db.session.query')} hint={t('db.errors.hint')}>
            <CodeBlock code={error.sql} wrap maxHeight={DB_SQL_MAX_HEIGHT_PX} />
          </DetailSection>
          <DetailSection title={t('db.errors.context')}>
            <KeyValueGrid
              items={[
                { label: t('db.session.source'), value: error.runtime ? runtimeLabel(error.runtime, t) : null },
                { label: t('db.errors.code'), value: error.code, mono: true },
                { label: t('db.errors.correlation'), value: error.correlationId, mono: true },
              ]}
            />
          </DetailSection>
        </>
      )}
    </DetailSheet>
  );
}
