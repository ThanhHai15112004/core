import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { MessageFilter, MessageRow, MessagingMessages } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { MESSAGE_PAGE_SIZE, MESSAGE_STATUSES } from '../../constants/messaging';
import { SectionState } from '../../components/database/SectionState';
import { MessageTable } from '../../components/messaging/MessageTable';
import { formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

const MAX_COUNT = 500;

interface Props {
  product: string;
  filter: MessageFilter;
  setFilter: (f: Partial<MessageFilter>) => void;
  reloadKey: number;
  now: number;
  onOpen: (m: MessageRow) => void;
}

/**
 * Messages explorer: tìm theo message ID / correlation ID, lọc queue, channel, trạng thái, producer.
 * Mỗi trạng thái chỉ xét N message mới nhất (không quét toàn bộ broker); "Tải thêm" tăng N.
 */
export const MessagingMessagesView: React.FC<Props> = ({ product, filter, setFilter, reloadKey, now, onOpen }) => {
  const { t, locale } = useLocale();
  const [count, setCount] = useState(MESSAGE_PAGE_SIZE);
  const [search, setSearch] = useState(filter.search);
  const [res, setRes] = useState<MessagingMessages | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const channels = usePolling(() => messagingApi.channels('24h'), 'message-channels', 60_000);
  const channelNames = channels.data?.channels.map((c) => c.channel) ?? [];
  const queues = channels.data?.queues.available ? channels.data.queues.data.map((q) => q.name) : [];
  const producers = [...new Set(channels.data?.channels.flatMap((c) => c.producers) ?? [])];

  const load = async (n: number) => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const r = await messagingApi.messages(filter, n);
      if (id !== seq.current) return;
      setRes(r);
      setError(null);
    } catch (err) {
      if (id === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    setSearch(filter.search);
    setCount(MESSAGE_PAGE_SIZE);
    void load(MESSAGE_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.queue, filter.channel, filter.status, filter.producer, filter.search, reloadKey]);

  const rows = res?.messages.available ? res.messages.data : [];
  const filtered = Boolean(filter.queue || filter.channel || filter.status || filter.producer || filter.search);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('messaging.messages.title')}</h3>
        <span className="ov-section-hint">{t('messaging.messages.hint')}</span>
      </header>
      <form
        className="cache-key-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ search: search.trim() });
        }}
      >
        <label className="cache-search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('messaging.messages.searchPlaceholder')} aria-label={t('messaging.messages.search')} />
        </label>
        <select value={filter.queue} onChange={(e) => setFilter({ queue: e.target.value })} aria-label={t('messaging.message.queue')}>
          <option value="">{t('messaging.messages.allQueues')}</option>
          {queues.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
        <select value={filter.channel} onChange={(e) => setFilter({ channel: e.target.value })} aria-label={t('messaging.message.channel')}>
          <option value="">{t('messaging.messages.allChannels')}</option>
          {channelNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ status: e.target.value as MessageFilter['status'] })} aria-label={t('messaging.channel.status')}>
          <option value="">{t('messaging.messages.allStatuses')}</option>
          {MESSAGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`messaging.status.${s}`)}
            </option>
          ))}
        </select>
        <select value={filter.producer} onChange={(e) => setFilter({ producer: e.target.value })} aria-label={t('messaging.message.producer')}>
          <option value="">{t('messaging.messages.allProducers')}</option>
          {producers.map((p) => (
            <option key={p} value={p}>
              {t(`rt.name.${p}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="scp-btn scp-btn-sm scp-btn-secondary">
          {t('cache.keys.apply')}
        </button>
      </form>
      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      <SectionState section={res?.messages} driver={product} scope="messaging" onRetry={() => void load(count)}>
        {() => (
          <MessageTable
            rows={rows}
            onOpen={onOpen}
            columns={['time', 'id', 'channel', 'status', 'attempts', 'duration', 'size']}
            emptyText={filtered ? t('messaging.messages.noMatch') : t('messaging.messages.empty')}
            now={now}
          />
        )}
      </SectionState>
      <footer className="cache-keys-foot">
        <span className="ov-section-hint">
          {res && t('messaging.messages.showing', { count: formatCompact(rows.length, locale), examined: formatCompact(res.examined, locale) })}
        </span>
        {res?.truncated && count < MAX_COUNT ? (
          <button
            type="button"
            className="scp-btn scp-btn-sm scp-btn-secondary"
            disabled={loading}
            onClick={() => {
              const next = Math.min(MAX_COUNT, count + MESSAGE_PAGE_SIZE);
              setCount(next);
              void load(next);
            }}
          >
            {loading ? t('common.loading') : t('cache.keys.loadMore')}
          </button>
        ) : (
          res && rows.length > 0 && <span className="ov-section-hint">{t(res.truncated ? 'messaging.messages.limit' : 'cache.keys.end')}</span>
        )}
      </footer>
      <p className="pf-chart-note">{t('messaging.messages.note')}</p>
    </section>
  );
};
