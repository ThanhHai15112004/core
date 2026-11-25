import { useCallback, useEffect, useState } from 'react';
import { idempotencyApi } from '../services/idempotency.api';
import type {
  IdempotencyMetricsSnapshot,
  IdempotencyRecordDetail,
  IdempotencyRecordItem,
} from '../types/idempotency.types';

export function useIdempotencyManagement() {
  const [metrics, setMetrics] = useState<IdempotencyMetricsSnapshot | null>(null);
  const [records, setRecords] = useState<IdempotencyRecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [windowHours, setWindowHours] = useState(24);
  const [scopeFilter, setScopeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<IdempotencyRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (scopeFilter) params.set('scope', scopeFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (onlyDuplicates) params.set('onlyDuplicates', 'true');
      if (onlyConflicts) params.set('onlyConflicts', 'true');
      if (searchFilter.trim()) params.set('search', searchFilter.trim());

      const [metricsData, listRes] = await Promise.all([
        idempotencyApi.getMetrics(windowHours),
        idempotencyApi.listRecords(params.toString()),
      ]);
      setMetrics(metricsData);
      setRecords(Array.isArray(listRes.data) ? listRes.data : []);
      const meta = listRes.meta as { total?: number } | undefined;
      setTotal(typeof meta?.total === 'number' ? meta.total : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được dữ liệu Idempotency');
    } finally {
      setLoading(false);
    }
  }, [page, windowHours, scopeFilter, statusFilter, onlyDuplicates, onlyConflicts, searchFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openRecordDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setError(null);
    try {
      const detail = await idempotencyApi.getRecordById(id);
      setSelectedRecord(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được chi tiết khóa Idempotency');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const revokeRecord = useCallback(
    async (id: number, reason: string) => {
      setSubmitting(true);
      setError(null);
      setFeedback(null);
      try {
        const res = await idempotencyApi.revokeRecord(id, reason);
        setFeedback(`Đã thu hồi khóa "${res.idempotencyKey}" (${res.scope}:${res.scopeTarget}).`);
        setSelectedRecord(null);
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Thu hồi khóa Idempotency thất bại');
      } finally {
        setSubmitting(false);
      }
    },
    [loadData],
  );

  const runPurgeExpired = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await idempotencyApi.purgeExpired({
        reason: 'Dọn thủ công khóa Idempotency hết hạn từ giao diện quản trị',
      });
      setFeedback(
        `Đã dọn ${res.purgedCount} khóa hết hạn TTL (${res.batchesExecuted} đợt xử lý).`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dọn khóa hết hạn thất bại');
    } finally {
      setSubmitting(false);
    }
  }, [loadData]);

  const handleScopeChange = useCallback((value: string) => {
    setScopeFilter(value);
    setPage(1);
  }, []);

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  const handleOnlyDuplicatesChange = useCallback((value: boolean) => {
    setOnlyDuplicates(value);
    setPage(1);
  }, []);

  const handleOnlyConflictsChange = useCallback((value: boolean) => {
    setOnlyConflicts(value);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchFilter(value);
    setPage(1);
  }, []);

  return {
    metrics,
    records,
    total,
    page,
    setPage,
    windowHours,
    setWindowHours,
    scopeFilter,
    setScopeFilter: handleScopeChange,
    statusFilter,
    setStatusFilter: handleStatusChange,
    onlyDuplicates,
    setOnlyDuplicates: handleOnlyDuplicatesChange,
    onlyConflicts,
    setOnlyConflicts: handleOnlyConflictsChange,
    searchFilter,
    setSearchFilter: handleSearchChange,
    selectedRecord,
    setSelectedRecord,
    detailLoading,
    loading,
    submitting,
    error,
    feedback,
    refreshAll: loadData,
    openRecordDetail,
    revokeRecord,
    runPurgeExpired,
  };
}
