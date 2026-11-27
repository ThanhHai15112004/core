import { useCallback, useEffect, useState } from 'react';
import { complianceApi } from '../services/compliance.api';
import type {
  AssessmentApprovalStatus,
  ComplianceCheckHistoryItem,
  ComplianceControlItem,
  ComplianceEvidenceItem,
  ComplianceOverviewItem,
  ComplianceReportResultItem,
  ComplianceRiskLevel,
  ComplianceVendorItem,
  ControlCheckResult,
  ControlFrequency,
  DataFlowDirection,
  EvidenceType,
  VendorCategory,
  VendorDataAssessmentItem,
} from '../types/compliance.types';
import type { DataClassificationLevel } from '../types/data-governance.types';

export function useCompliance(
  accessToken: string,
  notify: (type: 'ok' | 'err', text: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<ComplianceOverviewItem | null>(null);
  const [controls, setControls] = useState<readonly ComplianceControlItem[]>([]);
  const [evidences, setEvidences] = useState<readonly ComplianceEvidenceItem[]>([]);
  const [checkHistories, setCheckHistories] = useState<readonly ComplianceCheckHistoryItem[]>([]);
  const [vendors, setVendors] = useState<readonly ComplianceVendorItem[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [vendorAssessments, setVendorAssessments] = useState<readonly VendorDataAssessmentItem[]>(
    [],
  );
  const [reportResult, setReportResult] = useState<ComplianceReportResultItem | null>(null);

  const loadVendorAssessments = useCallback(
    async (vendorId: number) => {
      if (!accessToken) {
        setVendorAssessments([]);
        return;
      }
      setSelectedVendorId(vendorId);
      const list = await complianceApi.listVendorAssessments(accessToken, vendorId).catch(() => []);
      setVendorAssessments(Array.isArray(list) ? list : []);
    },
    [accessToken],
  );

  const refreshAll = useCallback(async () => {
    if (!accessToken) {
      setOverview(null);
      setControls([]);
      setEvidences([]);
      setCheckHistories([]);
      setVendors([]);
      setVendorAssessments([]);
      return;
    }
    setBusy(true);
    try {
      const [ov, ctrls, evs, chks, vends] = await Promise.all([
        complianceApi.getOverview(accessToken).catch(() => null),
        complianceApi.listControls(accessToken).catch(() => []),
        complianceApi.listEvidences(accessToken).catch(() => []),
        complianceApi.listCheckHistories(accessToken).catch(() => []),
        complianceApi.listVendors(accessToken).catch(() => []),
      ]);
      setOverview(ov);
      setControls(Array.isArray(ctrls) ? ctrls : []);
      setEvidences(Array.isArray(evs) ? evs : []);
      setCheckHistories(Array.isArray(chks) ? chks : []);
      const vendorList = Array.isArray(vends) ? vends : [];
      setVendors(vendorList);
      const targetVendorId = selectedVendorId ?? vendorList[0]?.id ?? null;
      if (targetVendorId) {
        setSelectedVendorId(targetVendorId);
        const assess = await complianceApi
          .listVendorAssessments(accessToken, targetVendorId)
          .catch(() => []);
        setVendorAssessments(Array.isArray(assess) ? assess : []);
      }
    } finally {
      setBusy(false);
    }
  }, [accessToken, selectedVendorId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const runAction = useCallback(
    async (fn: () => Promise<void>, successMessage: string) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        await fn();
        notify('ok', successMessage);
        await refreshAll();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Thao tác Compliance thất bại');
        await refreshAll();
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAll],
  );

  const createControl = useCallback(
    async (payload: {
      title: string;
      description?: string;
      domain: string;
      frameworkTags: string[];
      ownerUserId?: number | null;
      frequency: ControlFrequency;
    }) => {
      await runAction(async () => {
        await complianceApi.createControl(accessToken, payload);
      }, `Đã tạo Control "${payload.title}".`);
    },
    [accessToken, runAction],
  );

  const recordCheck = useCallback(
    async (
      controlId: number,
      payload: {
        result: ControlCheckResult;
        score?: number | null;
        findings?: string;
        remediationPlan?: string;
      },
    ) => {
      await runAction(async () => {
        await complianceApi.recordControlCheck(accessToken, controlId, payload);
      }, `Đã ghi nhận kết quả kiểm tra (${payload.result}).`);
    },
    [accessToken, runAction],
  );

  const createEvidence = useCallback(
    async (payload: {
      controlId: number;
      vendorId?: number | null;
      evidenceType: EvidenceType;
      title: string;
      description?: string;
      fileId?: number | null;
      auditLogId?: number | null;
      logReference?: string;
      reportCode?: string;
      externalUrl?: string;
      validUntil?: string | null;
    }) => {
      await runAction(async () => {
        await complianceApi.createEvidence(accessToken, payload);
      }, `Đã lưu bằng chứng "${payload.title}".`);
    },
    [accessToken, runAction],
  );

  const createVendor = useCallback(
    async (payload: {
      name: string;
      category: VendorCategory;
      criticality: ComplianceRiskLevel;
      contractEndDate?: string | null;
      reviewFrequency: ControlFrequency;
      dpaSigned: boolean;
      fallbackVendorName?: string;
      fallbackStrategy?: string;
      migrationRunbook?: string;
      rtoHours?: number | null;
    }) => {
      await runAction(async () => {
        await complianceApi.createVendor(accessToken, payload);
      }, `Đã thêm nhà cung cấp "${payload.name}".`);
    },
    [accessToken, runAction],
  );

  const createVendorAssessment = useCallback(
    async (
      vendorId: number,
      payload: {
        dataCategory: string;
        classificationLevel: DataClassificationLevel;
        allowedDataFields: string[];
        prohibitedDataFields: string[];
        processingPurpose: string;
        dataFlowDirection: DataFlowDirection;
        storageRegions: string[];
        crossBorderTransfer: boolean;
        transferMechanism?: string;
        riskLevel: ComplianceRiskLevel;
        approvalStatus: AssessmentApprovalStatus;
      },
    ) => {
      await runAction(async () => {
        await complianceApi.createVendorAssessment(accessToken, vendorId, payload);
      }, `Đã lưu đánh giá dữ liệu "${payload.dataCategory}".`);
    },
    [accessToken, runAction],
  );

  const runReviewSweep = useCallback(
    async (dryRun: boolean) => {
      await runAction(async () => {
        const res = await complianceApi.runReviewSweep(accessToken, dryRun);
        notify(
          'ok',
          `${dryRun ? '[Dry-run] ' : ''}Control đến hạn: ${res.controlsDueOrOverdue}, Vendor rà soát: ${res.vendorReviewsDueOrOverdue}, Hợp đồng sắp hết hạn: ${res.contractsExpiringOrExpired}`,
        );
      }, 'Đã hoàn tất quét nhắc rà soát Compliance.');
    },
    [accessToken, notify, runAction],
  );

  const generateReport = useCallback(
    async (payload: {
      frameworkTag?: string;
      domain?: string;
      vendorCategory?: VendorCategory;
      format: 'json' | 'csv' | 'xlsx' | 'pdf';
    }) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        const result = await complianceApi.generateReport(accessToken, payload);
        setReportResult(result);
        notify('ok', `Đã tạo báo cáo Compliance (${payload.format.toUpperCase()}).`);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Tạo báo cáo Compliance thất bại');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify],
  );

  return {
    busy,
    overview,
    controls,
    evidences,
    checkHistories,
    vendors,
    selectedVendorId,
    vendorAssessments,
    reportResult,
    refreshAll,
    loadVendorAssessments,
    createControl,
    recordCheck,
    createEvidence,
    createVendor,
    createVendorAssessment,
    runReviewSweep,
    generateReport,
  };
}
