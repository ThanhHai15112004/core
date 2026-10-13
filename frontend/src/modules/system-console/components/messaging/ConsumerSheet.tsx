import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Activity, Cpu } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { cn } from '@core/lib/cn';
import { Badge, Button } from '@core/ui/primitives';
import { DataTable, DetailSection, DetailSheet, KeyValueGrid, QueryView, RelativeTime } from '@core/ui/blocks';
import type { ConsumerDetail, ConsumerInstance, MessageRow, MessagingRange } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { CONSUMER_STATUS_TONE } from '../../constants/messaging';
import { formatMsgRate, idemKey } from '../../utils/messaging-format';
import { messagingKeys } from '../../sections/messaging/messaging-keys';
import { BrokerSection } from './BrokerSection';
import { MessageTable } from './MessageTable';
import { RecentErrors, SeriesSection } from './DetailParts';

interface Props {
  name: string | null;
  range: MessagingRange;
  onClose: () => void;
  onOpenMessage: (m: MessageRow) => void;
  navigate: (path: string) => void;
}

const instCol = createColumnHelper<ConsumerInstance>();

/** Chi tiết consumer: instance, tốc độ, lag, avg / P95 / P99, retry, lỗi, message gần đây; → Runtime / Performance. */
export function ConsumerSheet({ name, range, onClose, onOpenMessage, navigate }: Props) {
  const { t } = useLocale();
  const query = useLiveQuery(messagingKeys.consumer(name ?? '', range), () => messagingApi.consumer(name!, range), { enabled: Boolean(name), keepPrevious: false });
  const c = query.data?.consumer;
  return (
    <DetailSheet
      open={Boolean(name)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={<span className="font-mono">{name}</span>}
      subtitle={c ? `${c.queue}${c.runtime ? ` · ${t(`rt.name.${c.runtime}`)}` : ''}` : undefined}
      status={c ? { tone: CONSUMER_STATUS_TONE[c.status], label: t(`messaging.consumer.statusOf.${c.status}`) } : undefined}
      actions={
        c ? (
          <>
            {c.runtime && (
              <Button size="sm" onClick={() => navigate(`runtimes/${c.runtime}`)}>
                <Cpu />
                {t('messaging.consumer.inspectRuntime')}
              </Button>
            )}
            <Button size="sm" onClick={() => navigate('performance')}>
              <Activity />
              {t('messaging.consumer.openPerformance')}
            </Button>
          </>
        ) : undefined
      }
    >
      <QueryView query={query}>{(d) => <Body d={d} range={range} at={query.dataUpdatedAt} onOpenMessage={onOpenMessage} />}</QueryView>
    </DetailSheet>
  );
}

function Body({ d, range, at, onOpenMessage }: { d: ConsumerDetail; range: MessagingRange; at: number; onOpenMessage: (m: MessageRow) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const c = d.consumer;
  const instColumns = useMemo(
    () => [
      instCol.accessor('instance', {
        header: t('messaging.consumer.instance'),
        cell: (x) => (
          <span className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs">{x.getValue()}</span>
            {x.row.original.paused && (
              <Badge tone="warn" size="xs">
                {t('messaging.consumer.statusOf.paused')}
              </Badge>
            )}
          </span>
        ),
      }),
      instCol.accessor('concurrency', { header: t('messaging.consumer.concurrencyCol'), meta: { align: 'right', mono: true } }),
      instCol.accessor('startedAt', { header: t('messaging.consumer.started'), cell: (x) => <RelativeTime value={x.getValue()} /> }),
    ],
    [t],
  );
  return (
    <>
      <DetailSection title={t('messaging.detail.flow')}>
        <KeyValueGrid
          columns={3}
          items={[
            {
              key: 'instances',
              label: t('messaging.consumer.instances'),
              value: (
                <>
                  {c.instances.length}
                  {c.brokerWorkers !== null && <span className="ml-1.5 text-2xs text-faint">{t('messaging.consumer.brokerWorkers', { n: c.brokerWorkers })}</span>}
                </>
              ),
              mono: true,
            },
            { key: 'rate', label: t('messaging.consumer.rate'), value: formatMsgRate(c.perSec, f.locale), mono: true },
            { key: 'lag', label: t('messaging.consumer.lag'), value: <span className={cn((c.lag ?? 0) > 0 && 'text-warn-fg')}>{f.compact(c.lag)}</span>, mono: true },
            { key: 'avg', label: t('messaging.processing.avg'), value: f.duration(c.avgMs), mono: true },
            { key: 'p95', label: t('messaging.processing.p95'), value: f.duration(c.p95Ms), mono: true },
            { key: 'p99', label: t('messaging.processing.p99'), value: f.duration(c.p99Ms), mono: true },
            { key: 'rateFail', label: t('messaging.channel.failureRate'), value: <span className={cn((c.failed ?? 0) > 0 && 'text-warn-fg')}>{f.percent(c.failureRatePercent)}</span>, mono: true },
            {
              key: 'retry',
              label: t('messaging.consumer.retry'),
              value: d.retry ? t('messaging.consumer.retrySummary', { retried: d.retry.retried, recovered: d.retry.recovered, dlq: d.retry.deadLettered }) : null,
            },
            {
              key: 'idem',
              label: t('messaging.message.idempotency'),
              value: <Badge tone={c.idempotent === true ? 'ok' : 'warn'}>{t(`messaging.idempotent.${idemKey(c.idempotent)}`)}</Badge>,
            },
          ]}
        />
      </DetailSection>
      <DetailSection title={t('messaging.consumer.instances')}>
        <div className="overflow-hidden rounded-md border border-border">
          <DataTable data={c.instances} columns={instColumns} getRowId={(i) => i.instance} emptyMessage={t('messaging.consumer.noInstance')} />
        </div>
      </DetailSection>
      <SeriesSection title={t('messaging.chart.metric.processing')} list={d.processing} range={range} now={at} />
      <SeriesSection title={t('messaging.chart.metric.throughput')} list={d.throughput} range={range} now={at} />
      <SeriesSection title={t('messaging.chart.metric.lag')} list={d.lag} range={range} now={at} />
      <RecentErrors errors={d.recentErrors} showChannel />
      <DetailSection title={t('messaging.message.recent')}>
        <BrokerSection section={d.recentMessages}>
          {(rows) => (
            <div className="overflow-hidden rounded-md border border-border">
              <MessageTable rows={rows} onOpen={onOpenMessage} columns={['time', 'id', 'channel', 'status', 'duration']} emptyMessage={t('messaging.message.none')} />
            </div>
          )}
        </BrokerSection>
      </DetailSection>
    </>
  );
}
