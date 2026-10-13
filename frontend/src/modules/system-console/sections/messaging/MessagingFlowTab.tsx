import { Search } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { Panel, PanelState, StatusBanner } from '@core/ui/blocks';
import type { MessagingOverview } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { FLOW_VIEWS, VIEW_CAPABILITY, type FlowView } from '../../constants/messaging';
import { ChannelTable } from '../../components/messaging/ChannelTable';
import { ConsumerTable } from '../../components/messaging/ConsumerTable';
import { formatAge } from '../../utils/messaging-format';
import { messagingKeys } from './messaging-keys';
import type { MessagingPage } from './useMessagingPage';

/** Channels & Consumers: chuyển giữa bảng channel (topic) và bảng consumer bằng segment; bấm hàng mở drawer. */
export function MessagingFlowTab({ page, overview }: { page: MessagingPage; overview: MessagingOverview | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const counts: Record<FlowView, number | null> = { channels: overview?.kpis.channels ?? null, consumers: overview?.kpis.consumers ?? null };
  const cap = VIEW_CAPABILITY[page.view];
  const unsupported = overview && cap && !overview.capabilities.includes(cap);
  return (
    <>
      <ToggleGroup type="single" value={page.view} onValueChange={(v) => v && page.setView(v as FlowView)} className="mb-3" aria-label={t('messaging.tab.channels')}>
        {FLOW_VIEWS.map((v) => (
          <ToggleGroupItem key={v} value={v}>
            {t(`messaging.view.${v}`)}
            {counts[v] !== null && <span className="font-mono text-2xs text-faint">{f.number(counts[v])}</span>}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {unsupported ? (
        <Panel>
          <PanelState status="no-source" message={t('messaging.unsupported', { product: overview.provider.product })} />
        </Panel>
      ) : page.view === 'consumers' ? (
        <ConsumersView page={page} />
      ) : (
        <ChannelsView page={page} />
      )}
    </>
  );
}

function ChannelsView({ page }: { page: MessagingPage }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(messagingKeys.channels(page.range), () => messagingApi.channels(page.range));
  const d = query.data;
  return (
    <Panel title={t('messaging.channel.title')} hint={t('messaging.channel.note', { range: t(`messaging.range.${page.range}`) })} flush>
      {d ? (
        <ChannelTable
          rows={d.channels}
          onOpen={page.openItem}
          activeId={page.itemId}
          emptyMessage={t('messaging.channel.empty')}
          footer={
            d.backlogSampled !== null
              ? `${t('messaging.channel.backlogSample', { count: f.compact(d.backlogSampled) })}${d.backlogTruncated ? ` · ${t('messaging.channel.backlogTruncated')}` : ''}`
              : undefined
          }
        />
      ) : (
        <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} className="p-3" />
      )}
    </Panel>
  );
}

function ConsumersView({ page }: { page: MessagingPage }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(messagingKeys.consumers(page.range), () => messagingApi.consumers(page.range));
  const d = query.data;
  return (
    <>
      {d && d.unconsumed.length > 0 && (
        <StatusBanner
          tone="crit"
          title={t('messaging.consumer.noConsumerTitle')}
          reasons={d.unconsumed.map((q) => ({
            id: q.name,
            text: t('messaging.consumer.noConsumerBody', { queue: q.name, waiting: f.compact(q.waiting), oldest: formatAge(q.oldestWaitingSec) }),
          }))}
          actions={
            <Button size="xs" onClick={() => page.navigate('runtimes/worker')}>
              <Search />
              {t('messaging.consumer.inspectRuntime')}
            </Button>
          }
        />
      )}
      <Panel title={t('messaging.consumer.title')} hint={t('messaging.consumer.note')} flush>
        {d ? (
          <ConsumerTable rows={d.consumers} onOpen={page.openItem} activeId={page.itemId} emptyMessage={t('messaging.consumer.empty')} />
        ) : (
          <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} className="p-3" />
        )}
      </Panel>
    </>
  );
}
