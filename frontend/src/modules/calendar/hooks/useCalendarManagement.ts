import { useCallback, useEffect, useState } from 'react';
import { calendarApi } from '../services/calendar.api';
import type {
  CalendarEventDetail,
  CalendarEventItem,
  CalendarProviderStatus,
} from '../types/calendar.types';

export function useCalendarManagement() {
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventDetail | null>(null);
  const [providers, setProviders] = useState<CalendarProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, provRes] = await Promise.all([
        calendarApi.listEvents('limit=50'),
        calendarApi.listProviders().catch(() => [] as CalendarProviderStatus[]),
      ]);
      const items = Array.isArray(evRes.data) ? evRes.data : [];
      setEvents(items);
      setProviders(provRes);
      if (items[0] && !selectedEvent) {
        const detail = await calendarApi.getEventById(items[0].id).catch(() => null);
        if (detail) setSelectedEvent(detail);
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể tải danh sách lịch & sự kiện',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedEvent]);

  useEffect(() => {
    void loadAll();
  }, []);

  const selectEvent = useCallback(async (id: number) => {
    try {
      const detail = await calendarApi.getEventById(id);
      setSelectedEvent(detail);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không tải được chi tiết sự kiện',
      });
    }
  }, []);

  const handleQuickCreate = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const created = await calendarApi.createEvent(payload);
        setSelectedEvent(created);
        setBanner({ type: 'success', text: `Đã tạo sự kiện ${created.code}` });
        await loadAll();
      } catch (err) {
        setBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Lỗi khi tạo sự kiện',
        });
      }
    },
    [loadAll],
  );

  const handleSyncExternal = useCallback(
    async (id: number, provider: 'GOOGLE' | 'MICROSOFT') => {
      try {
        await calendarApi.syncExternal(id, [provider]);
        const detail = await calendarApi.getEventById(id);
        setSelectedEvent(detail);
        setBanner({ type: 'success', text: `Đã đồng bộ sự kiện lên ${provider} Calendar` });
      } catch (err) {
        setBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Đồng bộ lịch ngoài thất bại',
        });
      }
    },
    [],
  );

  const handleScanReminders = useCallback(async () => {
    try {
      const res = await calendarApi.scanReminders();
      setBanner({
        type: 'success',
        text: `Đã quét nhắc lịch (${res.dispatchedCount}/${res.dueReminderCount} bản ghi đến hạn)`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Quét nhắc lịch thất bại',
      });
    }
  }, []);

  return {
    events,
    selectedEvent,
    providers,
    loading,
    banner,
    loadAll,
    selectEvent,
    handleQuickCreate,
    handleSyncExternal,
    handleScanReminders,
  };
}
