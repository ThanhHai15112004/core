import { useCallback, useEffect, useState } from 'react';
import { outboxApi } from '../services/outbox.api';
import type {
  OutboxEventDetail,
  OutboxEventItem,
  OutboxMetricsSnapshot,
} from '../types/outbox.types';

export function useOutboxManagement() {
  const [metrics, setMetrics] = useState<OutboxMetricsSnapshot | null>(null);
  const [events, setEvents] = useState<OutboxEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceModuleFilter, setSourceModuleFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  const [selectedEvent, setSelectedEvent] = useState<OutboxEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    try {
      const data = await outboxApi.getMetrics();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải thống kê độ trễ Outbox');
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '25',
      });
      if (statusFilter) params.set('status', statusFilter);
      if (sourceModuleFilter.trim()) params.set('sourceModule', sourceModuleFilter.trim());
      if (searchFilter.trim()) params.set('search', searchFilter.trim());

      const res = await outboxApi.listEvents(params.toString());
      setEvents(Array.isArray(res.data) ? res.data : []);
      setTotal(typeof res.meta?.total === 'number' ? res.meta.total : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách Outbox Events');
    }
  }, [page, statusFilter, sourceModuleFilter, searchFilter]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadMetrics(), loadEvents()]);
    } finally {
      setLoading(false);
    }
  }, [loadMetrics, loadEvents]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const openEventDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setError(null);
    try {
      const detail = await outboxApi.getEventById(id);
      setSelectedEvent(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải chi tiết sự kiện Outbox');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const replayEvent = useCallback(
    async (id: number, reason: string, force = false) => {
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      setFeedback(null);
      try {
        const updated = await outboxApi.replayEvent(id, { reason, force });
        setSelectedEvent(updated);
        setFeedback(`Đã xếp lại Outbox #${id} (${updated.eventType}) vào hàng chờ gửi và ghi Audit Log.`);
        await refreshAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể phát lại sự kiện Outbox');
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, refreshAll],
  );

  const runProcessNow = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await outboxApi.processNow();
      setFeedback(
        `Worker đã xử lý ${res.claimedCount} sự kiện: ${res.publishedCount} Published, ${res.failedCount} Failed, ${res.deadLetteredCount} Dead Letter (${res.durationMs}ms).`,
      );
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể kích hoạt Worker đọc Outbox');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, refreshAll]);

  const runCleanup = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await outboxApi.cleanup({ reason: 'Manual cleanup from Outbox UI' });
      setFeedback(
        `Đã dọn ${res.totalDeletedCount} sự kiện quá hạn (${res.deletedPublishedCount} Published, ${res.deletedDeadLetterCount} Dead Letter).`,
      );
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể dọn sự kiện Outbox quá hạn');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, refreshAll]);

  return {
    metrics,
    events,
    total,
    page,
    setPage,
    statusFilter,
    setStatusFilter: (val: string) => {
      setPage(1);
      setStatusFilter(val);
    },
    sourceModuleFilter,
    setSourceModuleFilter: (val: string) => {
      setPage(1);
      setSourceModuleFilter(val);
    },
    searchFilter,
    setSearchFilter: (val: string) => {
      setPage(1);
      setSearchFilter(val);
    },
    selectedEvent,
    setSelectedEvent,
    detailLoading,
    loading,
    submitting,
    error,
    setError,
    feedback,
    setFeedback,
    refreshAll,
    openEventDetail,
    replayEvent,
    runProcessNow,
    runCleanup,
  };
}
