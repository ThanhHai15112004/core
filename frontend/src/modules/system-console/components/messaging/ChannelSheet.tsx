import { Search } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { cn } from '@core/lib/cn';
import { Button } from '@core/ui/primitives';
import { DetailSection, DetailSheet, KeyValueGrid, QueryView } from '@core/ui/blocks';
import type { ChannelDetail, MessageRow, MessagingRange } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { CHANNEL_STATUS_TONE } from '../../constants/messaging';
import { formatAge, formatMsgRate } from '../../utils/messaging-format';
import { messagingKeys } from '../../sections/messaging/messaging-keys';
import { BrokerSection } from './BrokerSection';
import { ConsumerTable } from './ConsumerTable';
import { MessageTable } from './MessageTable';
import { RecentErrors, SeriesSection } from './DetailParts';

interface Props {
  name: string | null;
  range: MessagingRange;
  onClose: () => void;
  onBrowse: (channel: string) => void;
  onOpenConsumer: (consumer: string) => void;
  onOpenMessage: (m: MessageRow) => void;
}

/** Chi tiết channel: publish / consume, lag, lỗi, thời gian xử lý, consumer, lỗi & message gần đây. */
export function ChannelSheet({ name, range, onClose, onBrowse, onOpenConsumer, onOpenMessage }: Props) {
  const { t } = useLocale();
  const query = useLiveQuery(messagingKeys.channel(name ?? '', range), () => messagingApi.channel(name!, range), { enabled: Boolean(name), keepPrevious: false });
  const c = query.data?.channel;
  return (
    <DetailSheet
      open={Boolean(name)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={<span className="font-mono">{name}</span>}
      subtitle={c?.queue ? t('messaging.channel.via', { queue: c.queue }) : undefined}
      status={c ? { tone: CHANNEL_STATUS_TONE[c.status], label: t(`messaging.channel.statusOf.${c.status}`) } : undefined}
      actions={
        name ? (
          <Button size="sm" onClick={() => onBrowse(name)}>
            <Search />
            {t('messaging.channel.browse')}
          </Button>
        ) : undefined
      }
    >
      <QueryView query={query}>{(d) => <Body d={d} range={range} at={query.dataUpdatedAt} onOpenConsumer={onOpenConsumer} onOpenMessage={onOpenMessage} />}</QueryView>
    </DetailSheet>
  );
}

function Body({ d, range, at, onOpenConsumer, onOpenMessage }: { d: ChannelDetail; range: MessagingRange; at: number } & Pick<Props, 'onOpenConsumer' | 'onOpenMessage'>) {
  const { t } = useLocale();
  const f = useFormat();
  const c = d.channel;
  return (
    <>
      <DetailSection title={t('messaging.detail.flow')}>
        <KeyValueGrid
          columns={4}
          items={[
            { key: 'publish', label: t('messaging.channel.publish'), value: formatMsgRate(c.publishPerSec, f.locale), mono: true },
            { key: 'consume', label: t('messaging.channel.consume'), value: formatMsgRate(c.consumePerSec, f.locale), mono: true },
            { key: 'lag', label: t('messaging.channel.lag'), value: <span className={cn((c.lag ?? 0) > 0 && 'text-warn-fg')}>{f.compact(c.lag)}</span>, mono: true },
            { key: 'oldest', label: t('messaging.channel.oldest'), value: formatAge(c.oldestWaitingSec), mono: true },
            { key: 'rate', label: t('messaging.channel.failureRate'), value: <span className={cn((c.failed ?? 0) > 0 && 'text-warn-fg')}>{f.percent(c.failureRatePercent)}</span>, mono: true },
            { key: 'retries', label: t('messaging.channel.retries'), value: t('messaging.channel.retriesValue', { retried: f.compact(c.retried), dlq: f.compact(c.deadLettered) }), mono: true },
            { key: 'avg', label: t('messaging.processing.avg'), value: f.duration(c.avgMs), mono: true },
            { key: 'p95', label: t('messaging.processing.p95'), value: f.duration(c.p95Ms), mono: true },
          ]}
        />
      </DetailSection>
      <SeriesSection title={t('messaging.chart.metric.throughput')} list={d.throughput} range={range} now={at} />
      <SeriesSection title={t('messaging.chart.metric.processing')} list={d.processing} range={range} now={at} />
      <DetailSection title={t('messaging.consumer.title')}>
        <div className="overflow-hidden rounded-md border border-border">
          <ConsumerTable rows={d.consumers} onOpen={onOpenConsumer} emptyMessage={t('messaging.channel.noConsumer')} />
        </div>
      </DetailSection>
      <RecentErrors errors={d.recentErrors} />
      <DetailSection title={t('messaging.message.recent')}>
        <BrokerSection section={d.recentMessages}>
          {(rows) => (
            <div className="overflow-hidden rounded-md border border-border">
              <MessageTable rows={rows} onOpen={onOpenMessage} columns={['time', 'id', 'status', 'duration']} emptyMessage={t('messaging.message.none')} />
            </div>
          )}
        </BrokerSection>
      </DetailSection>
    </>
  );
}
