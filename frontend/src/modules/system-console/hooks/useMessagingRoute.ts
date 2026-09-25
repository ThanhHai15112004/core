import { useCallback, useMemo } from 'react';
import type { MessagingRange, MessagingTab } from '../types/messaging.types';
import { useConsoleRoute } from '../context/console-route-context';
import { DEFAULT_MESSAGING_RANGE, MESSAGING_RANGES, MESSAGING_TABS } from '../constants/messaging';
import { toQuery } from '../services/traffic.api';

const SECTION = 'messaging';

/** `messaging/<tab>/<id>?range=` — tab, đối tượng đang mở (channel/consumer/message) và khoảng thời gian nằm trên URL. */
export function useMessagingRoute() {
  const { route, navigate } = useConsoleRoute();
  const [rawTab, id] = route.params;
  const tab: MessagingTab = MESSAGING_TABS.includes(rawTab as MessagingTab) ? (rawTab as MessagingTab) : 'overview';
  const range = useMemo<MessagingRange>(() => {
    const r = route.query.get('range') as MessagingRange | null;
    return r && MESSAGING_RANGES.includes(r) ? r : DEFAULT_MESSAGING_RANGE;
  }, [route.query]);
  const extra = useMemo(() => Object.fromEntries([...route.query.entries()].filter(([k]) => k !== 'range')), [route.query]);

  const go = useCallback(
    (nextTab: MessagingTab, nextId?: string | null, query: Record<string, string | number | undefined> = {}) => {
      const qs = toQuery({ range: range === DEFAULT_MESSAGING_RANGE ? undefined : range, ...query });
      const segments = [SECTION, ...(nextTab === 'overview' && !nextId ? [] : [nextTab]), ...(nextId ? [encodeURIComponent(nextId)] : [])];
      navigate(`${segments.join('/')}${qs ? `?${qs}` : ''}`);
    },
    [navigate, range],
  );

  const setRange = useCallback(
    (r: MessagingRange) => {
      const qs = toQuery({ ...extra, range: r === DEFAULT_MESSAGING_RANGE ? undefined : r });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, route.params],
  );

  const setQuery = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      const qs = toQuery({ ...extra, ...patch, range: range === DEFAULT_MESSAGING_RANGE ? undefined : range });
      navigate(`${[SECTION, ...route.params].join('/')}${qs ? `?${qs}` : ''}`);
    },
    [extra, navigate, range, route.params],
  );

  return { tab, id: id ? decodeURIComponent(id) : null, range, query: extra, go, setRange, setQuery, navigate };
}
