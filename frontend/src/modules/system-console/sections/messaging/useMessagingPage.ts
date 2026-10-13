import { useCallback, useMemo } from 'react';
import { setSearchParams } from '@core/router';
import { useTimeRange } from '@core/data';
import type { MessageFilter, MessageRow } from '../../types/messaging.types';
import {
  FLOW_VIEWS,
  MESSAGE_STATES,
  MESSAGE_STATUSES,
  MESSAGING_RANGES,
  MESSAGING_TAB_ALIASES,
  MESSAGING_TABS,
  type FlowView,
  type MessageState,
  type MessagingPageTab,
} from '../../constants/messaging';
import { useSectionRoute } from '../../shell/useSectionRoute';

const FILTER_KEYS = ['queue', 'channel', 'status', 'producer', 'search'] as const;
type QueryPatch = Record<string, string | null | undefined>;

/**
 * Route của Messaging:
 *   `messaging[/<tab>]` — Tổng quan · Channels & Consumers (`?view=consumers`) · Messages (`?state=retry|dead-letter`,
 *   bộ lọc `queue/channel/status/producer/search`) · Hoạt động.
 *   Drawer: `?item=<channel|consumer>` (tab Channels), `?msg=<id>&q=<queue>` (message, ở mọi tab), `?settings=1` (cấu hình).
 * Link cũ: `consumers` / `retries` / `dead-letter` / `errors` / `operations` / `configuration` đổi sang tab mới;
 * segment id kiểu cũ (`channels/<name>`, `messages/<id>?q=`) vẫn mở đúng drawer.
 */
export function useMessagingPage() {
  const r = useSectionRoute<MessagingPageTab>(MESSAGING_TABS, MESSAGING_TAB_ALIASES);
  const { query, tab, navigate } = r;
  const range = useTimeRange(MESSAGING_RANGES);
  const legacyId = r.params[0] ? decodeURIComponent(r.params[0]) : null;

  const rawView = query.get('view');
  const view: FlowView = FLOW_VIEWS.includes(rawView as FlowView) ? (rawView as FlowView) : 'channels';
  const rawState = query.get('state');
  const state: MessageState = MESSAGE_STATES.includes(rawState as MessageState) ? (rawState as MessageState) : 'all';
  const itemId = tab === 'channels' ? (query.get('item') ?? legacyId) : null;
  const messageId = query.get('msg') ?? (tab !== 'channels' ? legacyId : null);
  const messageQueue = query.get('q');

  const filter = useMemo<MessageFilter>(() => {
    const status = query.get('status') ?? '';
    return {
      queue: query.get('queue') ?? '',
      channel: query.get('channel') ?? '',
      status: MESSAGE_STATUSES.includes(status as never) ? (status as MessageFilter['status']) : '',
      producer: query.get('producer') ?? '',
      search: query.get('search') ?? '',
    };
  }, [query]);

  /** Đổi query; có segment id kiểu cũ → bỏ segment (URL về dạng mới). */
  const patch = useCallback(
    (updates: QueryPatch, mode: 'push' | 'replace' = 'replace') => {
      if (legacyId) {
        const merged: Record<string, string | null | undefined> = Object.fromEntries(query.entries());
        Object.assign(merged, updates);
        r.go(tab, [], merged);
        return;
      }
      setSearchParams(updates, mode);
    },
    [legacyId, query, r, tab],
  );

  const go = useCallback((next: MessagingPageTab, q?: Record<string, string>) => r.go(next, [], q), [r]);
  const setView = useCallback((v: FlowView) => patch({ view: v === 'channels' ? null : v, item: null }), [patch]);
  const setState = useCallback((s: MessageState) => patch({ state: s === 'all' ? null : s }), [patch]);
  const setFilter = useCallback(
    (p: Partial<MessageFilter>) => patch(Object.fromEntries(FILTER_KEYS.filter((k) => k in p).map((k) => [k, p[k] || null]))),
    [patch],
  );
  const clearFilter = useCallback(() => patch(Object.fromEntries(FILTER_KEYS.map((k) => [k, null]))), [patch]);

  /** Drawer: thêm vào lịch sử để nút Back đóng được. */
  const openItem = useCallback((id: string | null) => patch({ item: id }, id ? 'push' : 'replace'), [patch]);
  const openChannel = useCallback((name: string) => r.go('channels', [], { item: name }), [r]);
  const openConsumer = useCallback((name: string) => r.go('channels', [], { view: 'consumers', item: name }), [r]);
  const openMessage = useCallback(
    (m: Pick<MessageRow, 'id' | 'queue'> | null) => patch(m ? { msg: m.id, q: m.queue, item: null } : { msg: null, q: null }, m ? 'push' : 'replace'),
    [patch],
  );
  const browseChannel = useCallback((channel: string) => r.go('messages', [], { channel }), [r]);
  const setSettings = useCallback((open: boolean) => patch({ settings: open ? '1' : null }, open ? 'push' : 'replace'), [patch]);
  /** Đường dẫn kiểu cũ do backend trả (alert / event `tab` + `target`) — alias tự đổi sang tab mới. */
  const openLegacy = useCallback(
    (legacyTab: string, target?: string | null) => navigate(`messaging/${legacyTab}${target ? `/${encodeURIComponent(target)}` : ''}`),
    [navigate],
  );

  return {
    tab,
    range,
    view,
    state,
    filter,
    itemId,
    messageId,
    messageQueue,
    settingsOpen: query.get('settings') === '1',
    go,
    setView,
    setState,
    setFilter,
    clearFilter,
    openItem,
    openChannel,
    openConsumer,
    openMessage,
    browseChannel,
    setSettings,
    openLegacy,
    navigate,
  };
}

export type MessagingPage = ReturnType<typeof useMessagingPage>;
