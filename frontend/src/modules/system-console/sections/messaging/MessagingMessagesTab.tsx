import { useState } from 'react';
import { RotateCcw, Trash2, Zap } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { FilterBar, Panel, PanelGrid, PanelState, SearchInput, StatGrid, StatTile } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { MessageFilter, MessagingOverview } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { MESSAGE_MAX_COUNT, MESSAGE_PAGE_SIZE, MESSAGE_STATES, MESSAGE_STATUSES, MESSAGE_TABLE_HEIGHT_PX, VIEW_CAPABILITY, type MessageState } from '../../constants/messaging';
import { BrokerSection } from '../../components/messaging/BrokerSection';
import { MessageTable } from '../../components/messaging/MessageTable';
import { formatAge, messageRowId } from '../../utils/messaging-format';
import { messagingKeys } from './messaging-keys';
import type { MessagingPage } from './useMessagingPage';
import type { ActionTarget, MessageAction } from './useMessageActions';

const ALL = '__all__';
type OnAction = (action: MessageAction, target: ActionTarget) => void;

interface Props {
  page: MessagingPage;
  overview: MessagingOverview | undefined;
  onAction: OnAction;
}

/** Messages: chip trạng thái (tất cả / chờ retry / dead letter) — mỗi chip một nguồn dữ liệu riêng của broker. */
export function MessagingMessagesTab({ page, overview, onAction }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const k = overview?.kpis;
  const counts: Record<MessageState, number | null> = { all: null, retry: k?.retrying ?? null, 'dead-letter': k?.deadLetter ?? null };
  const cap = VIEW_CAPABILITY[page.state === 'all' ? 'browse' : page.state];
  const unsupported = overview && cap && !overview.capabilities.includes(cap);
  const product = overview?.provider.product ?? '';
  return (
    <>
      <ToggleGroup type="single" value={page.state} onValueChange={(v) => v && page.setState(v as MessageState)} className="mb-3" aria-label={t('messaging.tab.messages')}>
        {MESSAGE_STATES.map((s) => (
          <ToggleGroupItem key={s} value={s}>
            {t(`messaging.state.${s}`)}
            {counts[s] ? <span className="font-mono text-2xs text-faint">{f.compact(counts[s])}</span> : null}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {unsupported ? (
        <Panel>
          <PanelState status="no-source" message={t('messaging.unsupported', { product })} />
        </Panel>
      ) : page.state === 'retry' ? (
        <RetryView page={page} product={product} onAction={onAction} />
      ) : page.state === 'dead-letter' ? (
        <DeadLetterView page={page} product={product} onAction={onAction} />
      ) : (
        <ExplorerView page={page} product={product} />
      )}
    </>
  );
}

/** Explorer: tìm theo message ID / correlation ID, lọc queue, channel, trạng thái, producer; "Tải thêm" xét thêm N. */
function ExplorerView({ page, product }: { page: MessagingPage; product: string }) {
  const { t } = useLocale();
  const f = useFormat();
  const { filter, setFilter, clearFilter } = page;
  // Số message xét theo bộ lọc hiện tại — đổi bộ lọc thì về trang đầu.
  const filterKey = JSON.stringify(filter);
  const [paging, setPaging] = useState({ key: filterKey, count: MESSAGE_PAGE_SIZE });
  const count = paging.key === filterKey ? paging.count : MESSAGE_PAGE_SIZE;
  const query = useLiveQuery(messagingKeys.messages(filter, count), () => messagingApi.messages(filter, count));
  const channels = useLiveQuery(messagingKeys.channels('24h'), () => messagingApi.channels('24h'), { tier: 'slow' });
  const channelNames = channels.data?.channels.map((c) => c.channel) ?? [];
  const queues = channels.data?.queues.available ? channels.data.queues.data.map((q) => q.name) : [];
  const res = query.data;
  const rows = res?.messages.available ? res.messages.data : [];
  // Producer ghi trong envelope của message đã tải (giữ lựa chọn hiện tại dù trang không còn message của nó).
  const producers = [...new Set([...rows.map((m) => m.producer), filter.producer || null].filter((p): p is string => Boolean(p)))].sort();
  const active = Boolean(filter.queue || filter.channel || filter.status || filter.producer || filter.search);

  const select = (key: keyof Omit<MessageFilter, 'search'>, label: string, options: { value: string; label: string }[]) => (
    <Select value={filter[key] || ALL} onValueChange={(v) => setFilter({ [key]: v === ALL ? '' : v })}>
      <SelectTrigger size="sm" className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>
          {label}: {t('messaging.filter.all')}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Panel title={t('messaging.messages.title')} hint={`${t('messaging.messages.hint')} ${t('messaging.messages.note')}`} flush>
      <div className="border-b border-border px-3 pt-3">
        <FilterBar active={active} onClear={clearFilter}>
          <SearchInput value={filter.search} onChange={(v) => setFilter({ search: v.trim() })} placeholder={t('messaging.messages.searchPlaceholder')} className="w-64" />
          {select('queue', t('messaging.message.queue'), queues.map((q) => ({ value: q, label: q })))}
          {select('channel', t('messaging.message.channel'), channelNames.map((c) => ({ value: c, label: c })))}
          {select('status', t('messaging.channel.status'), MESSAGE_STATUSES.map((s) => ({ value: s, label: t(`messaging.status.${s}`) })))}
          {select('producer', t('messaging.message.producer'), producers.map((p) => ({ value: p, label: t(`rt.name.${p}`) })))}
        </FilterBar>
      </div>
      {res === undefined ? (
        <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} className="p-3" />
      ) : (
        <div className={res.messages.available ? undefined : 'p-3'}>
          <BrokerSection section={res.messages} product={product} onRetry={() => void query.refetch()}>
            {() => (
              <MessageTable
                rows={rows}
                onOpen={page.openMessage}
                activeId={page.messageId && page.messageQueue ? messageRowId({ id: page.messageId, queue: page.messageQueue }) : null}
                columns={['time', 'id', 'channel', 'status', 'attempts', 'duration', 'size']}
                emptyMessage={active ? t('messaging.messages.noMatch') : t('messaging.messages.empty')}
                maxHeight={MESSAGE_TABLE_HEIGHT_PX}
                virtual
                loadMore={{
                  hasMore: res.truncated && count < MESSAGE_MAX_COUNT,
                  loading: query.isFetching,
                  onLoadMore: () => setPaging({ key: filterKey, count: Math.min(MESSAGE_MAX_COUNT, count + MESSAGE_PAGE_SIZE) }),
                }}
                footer={
                  <>
                    {t('messaging.messages.showing', { count: f.compact(rows.length), examined: f.compact(res.examined) })}
                    {res.truncated && count >= MESSAGE_MAX_COUNT && ` · ${t('messaging.messages.limit')}`}
                  </>
                }
              />
            )}
          </BrokerSection>
        </div>
      )}
    </Panel>
  );
}

/** Đang chờ retry: thống kê hôm nay + bảng (lần kế tiếp, lỗi gần nhất) → Retry ngay; chính sách retry ở chân bảng. */
function RetryView({ page, product, onAction }: { page: MessagingPage; product: string; onAction: OnAction }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(messagingKeys.retries(), () => messagingApi.retries());
  const d = query.data;
  const s = d?.stats;
  const p = d?.policy;
  return (
    <>
      <StatGrid columns={4}>
        <StatTile label={t('messaging.retries.retryingNow')} value={f.compact(s?.retryingNow)} tone={(s?.retryingNow ?? 0) > 0 ? 'warn' : undefined} loading={!d && !query.isError} />
        <StatTile label={t('messaging.retries.retriedToday')} value={f.compact(s?.retriedToday)} loading={!d && !query.isError} />
        <StatTile label={t('messaging.retries.recoveredToday')} value={f.compact(s?.recoveredToday)} tone={(s?.recoveredToday ?? 0) > 0 ? 'ok' : undefined} loading={!d && !query.isError} />
        <StatTile label={t('messaging.retries.deadLetteredToday')} value={f.compact(s?.deadLetteredToday)} tone={(s?.deadLetteredToday ?? 0) > 0 ? 'warn' : undefined} loading={!d && !query.isError} />
      </StatGrid>
      <Panel title={t('messaging.retries.title')} hint={t('messaging.retries.hint')} flush>
        {d === undefined ? (
          <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} className="p-3" />
        ) : (
          <div className={d.retrying.available ? undefined : 'p-3'}>
            <BrokerSection section={d.retrying} product={product} onRetry={() => void query.refetch()}>
              {(rows) => (
                <MessageTable
                  rows={rows}
                  onOpen={page.openMessage}
                  columns={['id', 'channel', 'attempts', 'next', 'error']}
                  emptyMessage={t('messaging.retries.empty')}
                  maxHeight={MESSAGE_TABLE_HEIGHT_PX}
                  actions={
                    d.retryEnabled
                      ? (m) => (
                          <Button size="xs" variant="ghost" onClick={() => onAction('retry', m)}>
                            <Zap />
                            {t('messaging.action.retry')}
                          </Button>
                        )
                      : undefined
                  }
                  footer={
                    p
                      ? t('messaging.retries.policyLine', {
                          max: p.maxAttempts,
                          strategy: t(`messaging.retries.backoff.${p.backoff}`),
                          initial: f.duration(p.initialDelayMs),
                          last: f.duration(p.maxDelayMs),
                        })
                      : undefined
                  }
                />
              )}
            </BrokerSection>
          </div>
        )}
      </Panel>
    </>
  );
}

/** Dead letter: số lượng, thêm hôm nay, cũ nhất, nguồn lớn nhất; bảng message → Replay / Discard; theo channel. */
function DeadLetterView({ page, product, onAction }: { page: MessagingPage; product: string; onAction: OnAction }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(messagingKeys.deadLetter(), () => messagingApi.deadLetter());
  const d = query.data;
  const s = d?.settings;
  const top = d?.bySource[0];
  return (
    <>
      <StatGrid columns={4}>
        <StatTile label={t('messaging.deadLetter.total')} value={f.compact(d?.total)} tone={(d?.total ?? 0) > 0 ? 'crit' : undefined} loading={!d && !query.isError} />
        <StatTile label={t('messaging.deadLetter.addedToday')} value={f.compact(d?.addedToday)} tone={(d?.addedToday ?? 0) > 0 ? 'warn' : undefined} loading={!d && !query.isError} />
        <StatTile label={t('messaging.deadLetter.oldest')} value={formatAge(d?.oldestSec)} loading={!d && !query.isError} />
        <StatTile
          label={t('messaging.deadLetter.largestSource')}
          value={top ? <span className="font-mono text-base">{top.channel}</span> : f.compact(null)}
          sub={top ? t('messaging.deadLetter.sourceCount', { count: f.compact(top.count) }) : undefined}
          loading={!d && !query.isError}
        />
      </StatGrid>
      <PanelGrid layout="2-1">
        <Panel title={t('messaging.deadLetter.title')} hint={`${t('messaging.deadLetter.hint')}. ${t('messaging.deadLetter.idempotencyWarning')}`} flush>
          {d === undefined ? (
            <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} className="p-3" />
          ) : (
            <div className={d.items.available ? undefined : 'p-3'}>
              <BrokerSection section={d.items} product={product} onRetry={() => void query.refetch()}>
                {(rows) => (
                  <MessageTable
                    rows={rows}
                    onOpen={page.openMessage}
                    columns={['time', 'id', 'channel', 'attempts', 'error']}
                    emptyMessage={t('messaging.deadLetter.empty')}
                    maxHeight={MESSAGE_TABLE_HEIGHT_PX}
                    actions={
                      s && (s.replay || s.discard)
                        ? (m) => (
                            <>
                              {s.replay && (
                                <Button size="xs" variant="ghost" onClick={() => onAction('replay', m)}>
                                  <RotateCcw />
                                  {t('messaging.action.replay')}
                                </Button>
                              )}
                              {s.discard && (
                                <Button size="xs" variant="ghost" className="text-crit-fg" onClick={() => onAction('discard', m)}>
                                  <Trash2 />
                                  {t('messaging.action.discard')}
                                </Button>
                              )}
                            </>
                          )
                        : undefined
                    }
                  />
                )}
              </BrokerSection>
            </div>
          )}
        </Panel>
        <Panel title={t('messaging.deadLetter.bySource')}>
          {d === undefined ? (
            <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} />
          ) : d.bySource.length === 0 ? (
            <PanelState status="empty" compact message={t('messaging.deadLetter.empty')} />
          ) : (
            <BarList
              items={d.bySource.map((b) => ({
                id: b.channel,
                label: <span className="font-mono text-xs">{b.channel}</span>,
                value: b.count,
                display: f.compact(b.count),
                tone: 'crit',
                onClick: () => page.go('messages', { channel: b.channel, status: 'dead_letter' }),
              }))}
            />
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}
