import React, { useCallback, useMemo, useState } from 'react';
import { Ban, Pause, Play, Radio, RefreshCw, WifiOff } from 'lucide-react';
import type { MessageFilter, MessageRow, MessagingEvent, MessagingTab } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { useMessagingRoute } from '../../hooks/useMessagingRoute';
import { useMessagingActions } from '../../hooks/useMessagingActions';
import { MESSAGE_STATUSES, MESSAGING_RANGES, MESSAGING_TABS, TAB_CAPABILITY } from '../../constants/messaging';
import { MessagingHealthBanner } from '../../components/messaging/MessagingHealthBanner';
import { ChannelDrawer } from '../../components/messaging/ChannelDrawer';
import { ConsumerDrawer } from '../../components/messaging/ConsumerDrawer';
import { MessageDrawer } from '../../components/messaging/MessageDrawer';
import { MessagingOverviewView } from './MessagingOverviewView';
import { MessagingChannelsView, MessagingConsumersView, MessagingProducersView } from './MessagingFlowViews';
import { MessagingMessagesView } from './MessagingMessagesView';
import { MessagingDeadLetterView, MessagingRetriesView } from './MessagingDeliveryViews';
import { MessagingConfigView, MessagingErrorsView, MessagingOperationsView } from './MessagingOtherViews';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';
import '../../styles/console-database.css';
import '../../styles/console-cache.css';
import '../../styles/console-storage.css';
import '../../styles/console-messaging.css';

/** Tab có drawer message (id = message ID, `q` = queue). */
const MESSAGE_TABS: MessagingTab[] = ['messages', 'retries', 'dead-letter', 'errors', 'overview'];

/**
 * Messaging: `messaging/<tab>/<id>` — health broker, throughput publish/consume, lag, channel, producer,
 * consumer, message explorer & vòng đời, retry, dead letter, lỗi & sự kiện, audit, cấu hình.
 * Phần broker không hỗ trợ hiện rõ lý do (theo capability), không có số liệu giả.
 */
export const MessagingSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const { tab, id, range, query, go, setRange, setQuery, navigate } = useMessagingRoute();
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const overview = usePolling(() => messagingApi.overview(range), `messaging:${range}:${reloadKey}`, undefined, paused);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);
  const actions = useMessagingActions((action, target) => {
    // Message vừa xoá không còn → đóng drawer thay vì tải lại (404).
    if (action === 'discard' && id === target.id) go(tab, null);
    bump();
  });
  const data = overview.data;
  const caps = new Set(data?.capabilities ?? []);
  const product = data ? `${data.provider.product} (${data.provider.broker})` : '';
  const closeDrawer = () => go(tab, null, tab === 'messages' ? { ...query, q: undefined } : {});

  const filter = useMemo<MessageFilter>(
    () => ({
      queue: query['queue'] ?? '',
      channel: query['channel'] ?? '',
      status: MESSAGE_STATUSES.includes(query['status'] as never) ? (query['status'] as MessageFilter['status']) : '',
      producer: query['producer'] ?? '',
      search: query['search'] ?? '',
    }),
    [query],
  );
  const setFilter = (patch: Partial<MessageFilter>) => {
    const next = { ...filter, ...patch };
    setQuery({
      queue: next.queue || undefined,
      channel: next.channel || undefined,
      status: next.status || undefined,
      producer: next.producer || undefined,
      search: next.search || undefined,
    });
  };

  /** Mở message trong tab hiện tại nếu tab có drawer message, không thì sang Messages. */
  const openMessage = (m: Pick<MessageRow, 'id' | 'queue' | 'status'>) => {
    const target: MessagingTab = MESSAGE_TABS.includes(tab) ? tab : m.status === 'dead_letter' ? 'dead-letter' : 'messages';
    go(target, m.id, { ...(target === 'messages' ? query : {}), q: m.queue });
  };
  const openEvent = (e: MessagingEvent) => {
    if (!e.tab) return;
    const withTarget =
      e.target && (e.type.startsWith('consumer_') || e.type === 'dead_lettered' || e.type.startsWith('message_')) && e.type !== 'message_discarded';
    go(e.tab, withTarget ? e.target : null);
  };

  const renderTab = () => {
    const cap = TAB_CAPABILITY[tab];
    if (data && cap && !caps.has(cap)) {
      return (
        <section className="tr-empty-state" role="status">
          <Ban size={28} />
          <h2>{t('messaging.unsupported.title')}</h2>
          <p>{t('messaging.unsupported.message', { product })}</p>
        </section>
      );
    }
    const common = { range, paused, reloadKey, product, go };
    const delivery = { paused, reloadKey, product, now, onOpen: openMessage, onAction: actions.request };
    switch (tab) {
      case 'channels':
        return <MessagingChannelsView {...common} />;
      case 'producers':
        return <MessagingProducersView {...common} />;
      case 'consumers':
        return <MessagingConsumersView {...common} navigate={navigate} />;
      case 'messages':
        return <MessagingMessagesView product={product} filter={filter} setFilter={setFilter} reloadKey={reloadKey} now={now} onOpen={openMessage} />;
      case 'retries':
        return <MessagingRetriesView {...delivery} />;
      case 'dead-letter':
        return <MessagingDeadLetterView {...delivery} />;
      case 'errors':
        return (
          <MessagingErrorsView
            range={range}
            paused={paused}
            reloadKey={reloadKey}
            openEvent={openEvent}
            openMessage={(messageId, queue) => go('errors', messageId, { q: queue })}
            navigate={navigate}
          />
        );
      case 'operations':
        return <MessagingOperationsView paused={paused} reloadKey={reloadKey} />;
      case 'configuration':
        return <MessagingConfigView />;
      default:
        return <MessagingOverviewView data={data} now={now} paused={paused} go={go} openEvent={openEvent} openMessage={openMessage} />;
    }
  };

  const problems = data?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  const dlq = data?.kpis.deadLetter ?? 0;
  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.messaging')}</h1>
          <p className="ov-page-subtitle">{t('messaging.subtitle')}</p>
        </div>
        <div className="tr-live">
          <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
            {paused ? <Pause size={12} /> : <Radio size={12} />}
            {paused ? t('tr.live.paused') : t('tr.live.live')}
          </span>
          <span className="ov-page-updated">
            <time>{overview.lastUpdated ? formatRelative(overview.lastUpdated, now) : '--'}</time>
          </span>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={bump}>
            <RefreshCw size={13} /> {t('cache.refresh')}
          </button>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t('tr.live.resume') : t('tr.live.pause')}
          </button>
        </div>
      </header>

      {overview.error && !data ? (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{overview.error.message}</p>
          </div>
        </section>
      ) : (
        data && <MessagingHealthBanner data={data} now={now} onTested={bump} onOpenLogs={() => navigate('logs?runtime=api')} />
      )}

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.messaging')}>
          {MESSAGING_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => go(x)}>
              {t(`messaging.tab.${x}`)}
              {x === 'overview' && problems > 0 && <span className="ov-count">{problems}</span>}
              {x === 'dead-letter' && dlq > 0 && <span className="ov-count">{dlq}</span>}
            </button>
          ))}
        </nav>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {MESSAGING_RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {renderTab()}

      {id && tab === 'channels' && (
        <ChannelDrawer
          key={id}
          name={id}
          range={range}
          now={now}
          onClose={closeDrawer}
          onBrowse={(c) => go('messages', null, { channel: c })}
          onOpenConsumer={(c) => go('consumers', c)}
          onOpenMessage={(m) => go('messages', m.id, { channel: id, q: m.queue })}
        />
      )}
      {id && tab === 'consumers' && (
        <ConsumerDrawer
          key={id}
          name={id}
          range={range}
          now={now}
          onClose={closeDrawer}
          onOpenMessage={(m) => go('messages', m.id, { q: m.queue })}
          navigate={navigate}
        />
      )}
      {id && MESSAGE_TABS.includes(tab) && (
        <MessageDrawer
          key={id}
          messageId={id}
          {...(query['q'] ? { queue: query['q'] } : {})}
          reloadKey={reloadKey}
          now={now}
          onClose={closeDrawer}
          onAction={actions.request}
          onOpenChannel={(c) => go('channels', c)}
          onOpenConsumer={(c) => go('consumers', c)}
          navigate={navigate}
        />
      )}
      {actions.modal}
    </div>
  );
};
