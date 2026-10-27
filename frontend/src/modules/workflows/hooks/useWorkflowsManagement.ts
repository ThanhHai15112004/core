import { useCallback, useEffect, useState } from 'react';
import { WORKFLOWS_TAB, type WorkflowsTabId } from '../enum/workflows.enum';
import { workflowsApi } from '../services/workflows.api';
import type {
  CreateWorkflowDefinitionPayload,
  StartWorkflowInstancePayload,
  WorkflowDefinitionItem,
  WorkflowInstanceDetail,
  WorkflowInstanceItem,
  WorkflowSlaScanResult,
  WorkflowStateItem,
  WorkflowTransitionItem,
} from '../types/workflows.types';

export interface WorkflowsBannerMessage {
  readonly type: 'success' | 'error';
  readonly text: string;
}

export function useWorkflowsManagement() {
  const [activeTab, setActiveTab] = useState<WorkflowsTabId>(WORKFLOWS_TAB.INSTANCES);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<WorkflowsBannerMessage | null>(null);

  const [definitions, setDefinitions] = useState<WorkflowDefinitionItem[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<number | null>(null);

  const [instances, setInstances] = useState<WorkflowInstanceItem[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstanceDetail | null>(null);
  const [lastSlaScanResult, setLastSlaScanResult] = useState<WorkflowSlaScanResult | null>(null);

  const selectedDefinition =
    definitions.find((d) => d.id === selectedDefinitionId) ?? definitions[0] ?? null;

  const loadInstanceDetail = useCallback(async (id: number) => {
    try {
      const detail = await workflowsApi.getInstanceById(id);
      setSelectedInstance(detail);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể tải chi tiết quy trình.',
      });
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [defsRes, instRes] = await Promise.all([
        workflowsApi.listDefinitions('limit=50'),
        workflowsApi.listInstances('limit=50'),
      ]);
      const defList = defsRes.data ?? [];
      const instList = instRes.data ?? [];
      setDefinitions(defList);
      setInstances(instList);

      if (defList.length > 0 && !selectedDefinitionId) {
        setSelectedDefinitionId(defList[0]!.id);
      }
      if (instList.length > 0) {
        const targetId = selectedInstance?.id ?? instList[0]!.id;
        await loadInstanceDetail(targetId);
      } else {
        setSelectedInstance(null);
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể tải dữ liệu Quy trình xử lý.',
      });
    } finally {
      setLoading(false);
    }
  }, [loadInstanceDetail, selectedDefinitionId, selectedInstance?.id]);

  useEffect(() => {
    void refreshAll();
  }, []);

  const handleCreateDefinition = async (payload: CreateWorkflowDefinitionPayload) => {
    setSubmitting(true);
    setBanner(null);
    try {
      const created = await workflowsApi.createDefinition(payload);
      setSelectedDefinitionId(created.id);
      await refreshAll();
      setBanner({
        type: 'success',
        text: `Đã tạo quy trình "${created.name}" (${created.code} v${created.version}).`,
      });
      return true;
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Tạo quy trình thất bại.',
      });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateNewVersion = async (definitionId: number) => {
    setSubmitting(true);
    setBanner(null);
    try {
      const created = await workflowsApi.createNewVersion(definitionId);
      setSelectedDefinitionId(created.id);
      await refreshAll();
      setBanner({
        type: 'success',
        text: `Đã phát hành phiên bản mới v${created.version} cho quy trình ${created.code}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Tạo phiên bản mới thất bại.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveStates = async (
    definitionId: number,
    states: readonly WorkflowStateItem[],
  ) => {
    setSubmitting(true);
    setBanner(null);
    try {
      await workflowsApi.replaceStates(definitionId, states);
      await refreshAll();
      setBanner({
        type: 'success',
        text: 'Đã cập nhật danh sách trạng thái của quy trình (Mục 9.3.2).',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Cập nhật trạng thái thất bại.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveTransitions = async (
    definitionId: number,
    transitions: readonly WorkflowTransitionItem[],
  ) => {
    setSubmitting(true);
    setBanner(null);
    try {
      await workflowsApi.replaceTransitions(definitionId, transitions);
      await refreshAll();
      setBanner({
        type: 'success',
        text: 'Đã lưu cấu hình điều kiện & hành động chuyển trạng thái (Mục 9.3.3 & 9.3.4).',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lưu bước chuyển trạng thái thất bại.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartInstance = async (payload: StartWorkflowInstancePayload) => {
    setSubmitting(true);
    setBanner(null);
    try {
      const started = await workflowsApi.startInstance(payload);
      setSelectedInstance(started);
      await refreshAll();
      setBanner({
        type: 'success',
        text: `Đã khởi tạo quy trình #${started.id} cho bản ghi ${started.entityType}#${started.entityId}.`,
      });
      return true;
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Khởi tạo quy trình thất bại.',
      });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecuteTransition = async (
    instanceId: number,
    transitionCode: string,
    reason?: string | null,
    contextDataPatch?: Record<string, unknown>,
  ) => {
    setSubmitting(true);
    setBanner(null);
    try {
      const updated = await workflowsApi.executeTransition(instanceId, {
        transitionCode,
        reason,
        ...(contextDataPatch ? { contextDataPatch } : {}),
      });
      setSelectedInstance(updated);
      await refreshAll();
      setBanner({
        type: 'success',
        text: `Đã thực hiện bước chuyển "${transitionCode}" → Trạng thái mới: ${updated.currentStateCode}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Chuyển trạng thái thất bại (chưa đủ điều kiện).',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecideApproval = async (
    instanceId: number,
    decision: 'APPROVED' | 'REJECTED' | 'RETURNED',
    comment?: string | null,
  ) => {
    setSubmitting(true);
    setBanner(null);
    try {
      const updated = await workflowsApi.decideApproval(instanceId, { decision, comment });
      setSelectedInstance(updated);
      await refreshAll();
      setBanner({
        type: 'success',
        text: `Đã ghi nhận quyết định phê duyệt (${decision}) cho quy trình #${instanceId}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Thao tác phê duyệt thất bại.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelInstance = async (
    instanceId: number,
    reason: string,
    action: 'CANCEL' | 'TERMINATE' = 'CANCEL',
  ) => {
    setSubmitting(true);
    setBanner(null);
    try {
      const updated = await workflowsApi.cancelInstance(instanceId, { reason, action });
      setSelectedInstance(updated);
      await refreshAll();
      setBanner({
        type: 'success',
        text: `Đã hủy / kết thúc quy trình #${instanceId}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể hủy quy trình.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleScanSlaOverdue = async () => {
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await workflowsApi.scanSlaOverdue();
      setLastSlaScanResult(res);
      await refreshAll();
      setBanner({
        type: 'success',
        text: `Đã quét SLA (${res.totalRunningChecked} quy trình đang chạy): ${res.warningsTriggeredCount} cảnh báo sắp hết hạn, ${res.overdueMarkedCount} đánh dấu quá hạn.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Quét SLA thất bại.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return {
    activeTab,
    setActiveTab,
    loading,
    submitting,
    banner,
    setBanner,
    definitions,
    selectedDefinition,
    selectedDefinitionId,
    setSelectedDefinitionId,
    instances,
    selectedInstance,
    loadInstanceDetail,
    lastSlaScanResult,
    refreshAll,
    handleCreateDefinition,
    handleCreateNewVersion,
    handleSaveStates,
    handleSaveTransitions,
    handleStartInstance,
    handleExecuteTransition,
    handleDecideApproval,
    handleCancelInstance,
    handleScanSlaOverdue,
  };
}

