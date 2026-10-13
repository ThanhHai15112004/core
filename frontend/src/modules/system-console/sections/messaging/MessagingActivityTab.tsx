import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Button } from '@core/ui/primitives';
import { ActivityFeed, DataTable, Panel, PanelState, StatGrid, StatTile, type ActivityItem } from '@core/ui/blocks';
import type { MessagingError } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { ACTIVITY_MAX_HEIGHT_PX, MESSAGE_TABLE_HEIGHT_PX, MESSAGING_ERROR_KINDS, SEVERITY_TONE } from '../../constants/messaging';
import { BrokerSection } from '../../components/messaging/BrokerSection';
import { messagingKeys } from './messaging-keys';
import type { MessagingPage } from './useMessagingPage';

const col = createColumnHelper<MessagingError>();

/**
 * Hoạt động: lỗi consume theo loại (job lỗi broker còn giữ) + lần publish / consume lỗi (Prometheus), bảng lỗi
 * (→ message, → log), dòng thời gian sự kiện messaging và lịch sử thao tác quản trị (audit).
 */
export function MessagingActivityTab({ page, product }: { page: MessagingPage; product: string }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const errors = useLiveQuery(messagingKeys.errors(page.range), () => messagingApi.errors(page.range));
  const events = useLiveQuery(messagingKeys.events(page.range), () => messagingApi.events(page.range));
  const operations = useLiveQuery(messagingKeys.operations(), () => messagingApi.operations(), { tier: 'slow' });
  const d = errors.data;
  const { navigate, openMessage, openLegacy } = page;

  const columns = useMemo(
    () => [
      col.accessor((e) => Date.parse(e.at), { id: 'at', header: t('messaging.message.time'), cell: (c) => formatTime(c.row.original.at, true), meta: { mono: true, width: '96px' } }),
      col.accessor('queue', { header: t('messaging.message.queue'), cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
      col.accessor('channel', {
        header: t('messaging.message.channel'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-fg">{c.getValue()}</div>
            <div className="truncate text-2xs text-crit-fg" title={c.row.original.message}>
              {c.row.original.message}
            </div>
          </div>
        ),
        meta: { width: '40%' },
      }),
      col.accessor('kind', {
        header: t('messaging.errors.type'),
        cell: (c) => {
          const e = c.row.original;
          return (
            <div>
              <Badge tone={e.final ? 'crit' : 'warn'}>{t(`messaging.errors.kind.${e.kind}`)}</Badge>
              <div className="text-2xs text-faint">
                {t('messaging.errors.attempt', { attempt: e.attempt, max: e.maxAttempts })}
                {e.final && ` · ${t('messaging.errors.final')}`}
              </div>
            </div>
          );
        },
      }),
      col.accessor('messageId', {
        header: t('messaging.message.id'),
        cell: (c) => (
          <span className="font-mono text-xs text-info-fg" title={c.getValue()}>
            {f.shortId(c.getValue())}
          </span>
        ),
      }),
      col.display({
        id: 'logs',
        header: '',
        cell: (c) =>
          c.row.original.correlationId ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`logs/explorer?correlationId=${encodeURIComponent(c.row.original.correlationId!)}`);
              }}
            >
              <FileText />
              {t('messaging.message.logs')}
            </Button>
          ) : null,
        meta: { align: 'right' },
      }),
    ],
    [t, f, formatTime, navigate],
  );

  const feed: ActivityItem[] = useMemo(
    () => [
      ...(events.data ?? []).map((e) => ({
        id: `ev-${e.id}`,
        at: e.at,
        tone: SEVERITY_TONE[e.severity],
        kind: 'event',
        title: t(`messaging.event.${e.type}`),
        detail: e.message,
        source: e.runtime ? t(`rt.name.${e.runtime}`) : null,
        onClick: e.tab
          ? () => {
              const withTarget = e.target && (e.type.startsWith('consumer_') || e.type === 'dead_lettered' || e.type.startsWith('message_')) && e.type !== 'message_discarded';
              openLegacy(e.tab!, withTarget ? e.target : null);
            }
          : undefined,
      })),
      ...(operations.data ?? []).map((o) => ({
        id: `op-${o.id}`,
        at: o.at,
        tone: o.result === 'success' ? ('ok' as const) : ('crit' as const),
        kind: 'operation',
        title: `${t(`messaging.audit.kind.${o.action}`)} · ${o.target}`,
        detail: [
          o.detail ? (o.action === 'test' ? t(`messaging.test.step.${o.detail}`) : o.detail) : null,
          o.actor ?? t('messaging.audit.anonymous'),
          f.duration(o.durationMs),
          o.error,
        ]
          .filter(Boolean)
          .join(' · '),
        source: o.ip,
      })),
    ],
    [events.data, operations.data, t, f, openLegacy],
  );
  const feedLoading = events.data === undefined && operations.data === undefined;
  const feedError = events.isError && operations.isError;

  return (
    <>
      <StatGrid columns={6}>
        {MESSAGING_ERROR_KINDS.map((k) => (
          <StatTile
            key={k}
            label={t(`messaging.errors.kind.${k}`)}
            value={d?.counts ? f.compact(d.counts[k]) : f.compact(null)}
            tone={d?.counts ? (d.counts[k] > 0 ? 'warn' : 'ok') : undefined}
            loading={!d && !errors.isError}
          />
        ))}
        <StatTile
          label={t('messaging.errors.publishFailed')}
          value={f.compact(d?.byStage.publish)}
          sub={d ? t('messaging.errors.consumeFailed', { count: f.compact(d.byStage.consume) }) : undefined}
          hint={t('messaging.errors.stageHint')}
          tone={(d?.byStage.publish ?? 0) > 0 ? 'warn' : undefined}
          loading={!d && !errors.isError}
        />
      </StatGrid>

      <Panel title={t('messaging.errors.title')} hint={t('messaging.errors.source')} flush className="mb-4">
        {d === undefined ? (
          <PanelState status={errors.isError ? 'error' : 'loading'} error={errors.error} onRetry={() => void errors.refetch()} className="p-3" />
        ) : (
          <div className={d.items.available ? undefined : 'p-3'}>
            <BrokerSection section={d.items} product={product} onRetry={() => void errors.refetch()}>
              {(items) => (
                <DataTable
                  data={items}
                  columns={columns}
                  getRowId={(e) => `${e.queue}:${e.messageId}:${e.at}`}
                  onRowClick={(e) => openMessage({ id: e.messageId, queue: e.queue })}
                  rowTone={(e) => (e.final ? 'crit' : 'warn')}
                  emptyMessage={t('messaging.errors.empty', { range: t(`messaging.range.${page.range}`) })}
                  maxHeight={MESSAGE_TABLE_HEIGHT_PX}
                />
              )}
            </BrokerSection>
          </div>
        )}
      </Panel>

      <Panel title={t('messaging.activity.title')} hint={t('messaging.audit.note')}>
        {feedLoading ? (
          <PanelState
            status={feedError ? 'error' : 'loading'}
            error={events.error}
            onRetry={() => {
              void events.refetch();
              void operations.refetch();
            }}
          />
        ) : (
          <>
            {(events.isError || operations.isError) && (
              <PanelState
                status="error"
                compact
                error={events.isError ? events.error : operations.error}
                onRetry={() => void (events.isError ? events.refetch() : operations.refetch())}
              />
            )}
            <ActivityFeed
            items={feed}
            kinds={{ event: t('messaging.activity.kind.event'), operation: t('messaging.activity.kind.operation') }}
            emptyMessage={t('messaging.events.empty')}
            maxHeight={ACTIVITY_MAX_HEIGHT_PX}
            />
          </>
        )}
      </Panel>
    </>
  );
}
