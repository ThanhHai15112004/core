import { useCallback, useEffect, useState } from 'react';
import { reconciliationApi } from '../services/reconciliation.api';
import type {
  DataRepairPreviewOutcome,
  DataRepairRequestItem,
  ReconciliationCatalog,
  ReconciliationDiscrepancyItem,
  ReconciliationDiscrepancyReport,
  ReconciliationJobItem,
  ReconciliationRunItem,
} from '../types/reconciliation.types';

export type ReconciliationActiveTab = 'jobs' | 'discrepancies' | 'repairs';

export function useReconciliationManagement() {
  const [activeTab, setActiveTab] = useState<ReconciliationActiveTab>('jobs');
  const [catalog, setCatalog] = useState<ReconciliationCatalog>({
    adapters: [],
    repairHandlers: [],
  });
  const [jobs, setJobs] = useState<ReconciliationJobItem[]>([]);
  const [runs, setRuns] = useState<ReconciliationRunItem[]>([]);
  const [report, setReport] = useState<ReconciliationDiscrepancyReport | null>(null);
  const [discrepancies, setDiscrepancies] = useState<ReconciliationDiscrepancyItem[]>([]);
  const [repairs, setRepairs] = useState<DataRepairRequestItem[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<DataRepairRequestItem | null>(null);
  const [selectedDiscrepancyForRepair, setSelectedDiscrepancyForRepair] =
    useState<ReconciliationDiscrepancyItem | null>(null);
  const [lastPreview, setLastPreview] = useState<DataRepairPreviewOutcome | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const buildDiscrepancyQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (typeFilter) params.set('discrepancyType', typeFilter);
    if (severityFilter) params.set('severity', severityFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (searchFilter.trim()) params.set('search', searchFilter.trim());
    return params.toString();
  }, [typeFilter, severityFilter, statusFilter, searchFilter]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, jobsRes, runsRes, repRes, discRes, repairRes] = await Promise.all([
        reconciliationApi.getCatalog(),
        reconciliationApi.listJobs('limit=50'),
        reconciliationApi.listRuns('limit=30'),
        reconciliationApi.getDiscrepancyReport(),
        reconciliationApi.listDiscrepancies(buildDiscrepancyQuery()),
        reconciliationApi.listRepairs('limit=50'),
      ]);
      setCatalog(cat);
      setJobs(jobsRes.data);
      setRuns(runsRes.data);
      setReport(repRes);
      setDiscrepancies(discRes.data);
      setRepairs(repairRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu đối soát.');
    } finally {
      setLoading(false);
    }
  }, [buildDiscrepancyQuery]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const runAction = useCallback(
    async <T,>(fn: () => Promise<T>, successMessage: string): Promise<T | null> => {
      setSubmitting(true);
      setError(null);
      setFeedback(null);
      try {
        const res = await fn();
        setFeedback(successMessage);
        await refreshAll();
        return res;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Thao tác thất bại.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [refreshAll],
  );

  const createJob = useCallback(
    (payload: Record<string, unknown>) =>
      runAction(() => reconciliationApi.createJob(payload), 'Đã tạo cấu hình Job đối soát mới.'),
    [runAction],
  );

  const triggerManualRun = useCallback(
    (jobId: number, payload: Record<string, unknown>) =>
      runAction(
        () => reconciliationApi.triggerRun(jobId, payload),
        'Đã hoàn tất chạy phiên đối soát thủ công (có ghi Audit).',
      ),
    [runAction],
  );

  const assignDiscrepancy = useCallback(
    (id: number, assigneeUserId: number, note?: string) =>
      runAction(
        () => reconciliationApi.assignDiscrepancy(id, assigneeUserId, note),
        `Đã giao sai lệch #${id} cho người phụ trách #${assigneeUserId}.`,
      ),
    [runAction],
  );

  const updateDiscrepancyStatus = useCallback(
    (id: number, status: string, note: string) =>
      runAction(
        () => reconciliationApi.updateDiscrepancyStatus(id, status, note),
        `Đã cập nhật trạng thái sai lệch #${id} → ${status}.`,
      ),
    [runAction],
  );

  const exportCsv = useCallback(async () => {
    setError(null);
    try {
      await reconciliationApi.downloadDiscrepanciesCsv(buildDiscrepancyQuery());
      setFeedback('Đã tải xuống báo cáo sai lệch CSV.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xuất file CSV.');
    }
  }, [buildDiscrepancyQuery]);

  const previewRepair = useCallback(async (payload: Record<string, unknown>) => {
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const outcome = await reconciliationApi.previewRepair(payload);
      setLastPreview(outcome);
      setFeedback('Đã chạy thử Dry-Run thành công (chưa ghi thay đổi dữ liệu).');
      return outcome;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chạy thử Dry-Run thất bại.');
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const proposeRepair = useCallback(
    async (payload: Record<string, unknown>) => {
      const created = await runAction(
        () => reconciliationApi.proposeRepair(payload),
        'Đã tạo đề xuất sửa dữ liệu kèm bản xem trước Dry-Run.',
      );
      if (created) {
        setSelectedRepair(created);
        setLastPreview(created.dryRunPreview);
      }
      return created;
    },
    [runAction],
  );

  const openRepairDetail = useCallback(async (id: number) => {
    setError(null);
    try {
      const detail = await reconciliationApi.getRepairById(id);
      setSelectedRepair(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải chi tiết yêu cầu sửa.');
    }
  }, []);

  const approveRepair = useCallback(
    async (id: number, note?: string) => {
      const updated = await runAction(
        () => reconciliationApi.approveRepair(id, note),
        `Đã phê duyệt yêu cầu sửa #${id}.`,
      );
      if (updated) setSelectedRepair(updated);
      return updated;
    },
    [runAction],
  );

  const rejectRepair = useCallback(
    async (id: number, note?: string) => {
      const updated = await runAction(
        () => reconciliationApi.rejectRepair(id, note),
        `Đã từ chối yêu cầu sửa #${id}.`,
      );
      if (updated) setSelectedRepair(updated);
      return updated;
    },
    [runAction],
  );

  const applyRepair = useCallback(
    async (id: number) => {
      const updated = await runAction(
        () => reconciliationApi.applyRepair(id),
        `Đã thực thi yêu cầu #${id} và ghi nhận dữ liệu Trước/Sau vào lịch sử.`,
      );
      if (updated) setSelectedRepair(updated);
      return updated;
    },
    [runAction],
  );

  const proposeCompensation = useCallback(
    async (parentRepairId: number, payload: Record<string, unknown>) => {
      const created = await runAction(
        () => reconciliationApi.proposeCompensation(parentRepairId, payload),
        `Đã tạo hành động bù liên kết với lệnh #${parentRepairId} (giữ nguyên lịch sử gốc).`,
      );
      if (created) setSelectedRepair(created);
      return created;
    },
    [runAction],
  );

  const startRepairFromDiscrepancy = useCallback((disc: ReconciliationDiscrepancyItem) => {
    setSelectedDiscrepancyForRepair(disc);
    setLastPreview(null);
    setActiveTab('repairs');
  }, []);

  return {
    activeTab,
    setActiveTab,
    catalog,
    jobs,
    runs,
    report,
    discrepancies,
    repairs,
    selectedRepair,
    setSelectedRepair,
    selectedDiscrepancyForRepair,
    setSelectedDiscrepancyForRepair,
    lastPreview,
    typeFilter,
    setTypeFilter,
    severityFilter,
    setSeverityFilter,
    statusFilter,
    setStatusFilter,
    searchFilter,
    setSearchFilter,
    loading,
    submitting,
    error,
    feedback,
    refreshAll,
    createJob,
    triggerManualRun,
    assignDiscrepancy,
    updateDiscrepancyStatus,
    exportCsv,
    previewRepair,
    proposeRepair,
    openRepairDetail,
    approveRepair,
    rejectRepair,
    applyRepair,
    proposeCompensation,
    startRepairFromDiscrepancy,
  };
}
