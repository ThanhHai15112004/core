import { useCallback, useEffect, useState } from 'react';
import { inboundWebhooksApi } from '../services/inbound-webhooks.api';
import type {
  InboundWebhookEventItem,
  InboundWebhookProviderItem,
} from '../types/inbound-webhooks.types';

export function useInboundWebhooks(params: {
  readonly onError: (msg: string | null) => void;
}) {
  const { onError } = params;
  const [providers, setProviders] = useState<InboundWebhookProviderItem[]>([]);
  const [events, setEvents] = useState<InboundWebhookEventItem[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<InboundWebhookEventItem | null>(null);

  const [eventProviderFilter, setEventProviderFilter] = useState<string>('');
  const [eventStatusFilter, setEventStatusFilter] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');
  const [eventSearchFilter, setEventSearchFilter] = useState<string>('');

  const [revealedSecret, setRevealedSecret] = useState<{
    providerName: string;
    signingSecret: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inboundWebhooksApi.listProviders('limit=100');
      setProviders(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể tải danh sách Inbound Providers');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('limit', '50');
      if (eventProviderFilter) sp.set('providerCode', eventProviderFilter);
      if (eventStatusFilter) sp.set('status', eventStatusFilter);
      if (eventTypeFilter.trim()) sp.set('eventType', eventTypeFilter.trim());
      if (eventSearchFilter.trim()) sp.set('search', eventSearchFilter.trim());
      const res = await inboundWebhooksApi.listEvents(sp.toString());
      setEvents(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể tải lịch sử Inbound Webhooks');
    } finally {
      setLoading(false);
    }
  }, [eventProviderFilter, eventSearchFilter, eventStatusFilter, eventTypeFilter, onError]);

  const loadEventDetail = useCallback(
    async (eventId: number) => {
      setDetailLoading(true);
      try {
        const detail = await inboundWebhooksApi.getEventById(eventId);
        setSelectedEvent(detail);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Không thể tải chi tiết Inbound Event');
      } finally {
        setDetailLoading(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const refreshInbound = useCallback(async () => {
    await Promise.all([loadProviders(), loadEvents()]);
    if (selectedEvent) {
      await loadEventDetail(selectedEvent.id);
    }
  }, [loadEventDetail, loadEvents, loadProviders, selectedEvent]);

  return {
    providers,
    events,
    selectedEvent,
    setSelectedEvent,
    eventProviderFilter,
    setEventProviderFilter,
    eventStatusFilter,
    setEventStatusFilter,
    eventTypeFilter,
    setEventTypeFilter,
    eventSearchFilter,
    setEventSearchFilter,
    revealedSecret,
    setRevealedSecret,
    loading,
    detailLoading,
    loadProviders,
    loadEvents,
    loadEventDetail,
    refreshInbound,
  };
}
