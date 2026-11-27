import React, { useState } from 'react';
import { ClipboardCheck, RefreshCw, Play } from 'lucide-react';
import { authStyles } from '../auth-ui.styles';
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
} from '../../types/compliance.types';
import type { DataClassificationLevel } from '../../types/data-governance.types';
import { ComplianceReportSection } from './ComplianceReportSection';
import { ControlsAndEvidenceSection } from './ControlsAndEvidenceSection';
import { VendorsAndAssessmentsSection } from './VendorsAndAssessmentsSection';

type ComplianceSubView = 'controls' | 'vendors' | 'reports';

interface Props {
  readonly accessToken: string;
  readonly busy: boolean;
  readonly overview: ComplianceOverviewItem | null;
  readonly controls: readonly ComplianceControlItem[];
  readonly evidences: readonly ComplianceEvidenceItem[];
  readonly checkHistories: readonly ComplianceCheckHistoryItem[];
  readonly vendors: readonly ComplianceVendorItem[];
  readonly selectedVendorId: number | null;
  readonly vendorAssessments: readonly VendorDataAssessmentItem[];
  readonly reportResult: ComplianceReportResultItem | null;
  readonly onRefresh: () => Promise<void>;
  readonly onRunReviewSweep: (dryRun: boolean) => Promise<void>;
  readonly onSelectVendor: (vendorId: number) => Promise<void>;
  readonly onCreateControl: (payload: {
    title: string;
    description?: string;
    domain: string;
    frameworkTags: string[];
    ownerUserId?: number | null;
    frequency: ControlFrequency;
  }) => Promise<void>;
  readonly onRecordCheck: (
    controlId: number,
    payload: {
      result: ControlCheckResult;
      score?: number | null;
      findings?: string;
      remediationPlan?: string;
    },
  ) => Promise<void>;
  readonly onCreateEvidence: (payload: {
    controlId: number;
    evidenceType: EvidenceType;
    title: string;
    description?: string;
    fileId?: number | null;
    auditLogId?: number | null;
    logReference?: string;
    reportCode?: string;
    externalUrl?: string;
  }) => Promise<void>;
  readonly onCreateVendor: (payload: {
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
  }) => Promise<void>;
  readonly onCreateVendorAssessment: (
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
  ) => Promise<void>;
  readonly onGenerateReport: (payload: {
    frameworkTag?: string;
    domain?: string;
    vendorCategory?: VendorCategory;
    format: 'json' | 'csv' | 'xlsx' | 'pdf';
  }) => Promise<void>;
}

export const CompliancePanel: React.FC<Props> = ({
  accessToken,
  busy,
  overview,
  controls,
  evidences,
  checkHistories,
  vendors,
  selectedVendorId,
  vendorAssessments,
  reportResult,
  onRefresh,
  onRunReviewSweep,
  onSelectVendor,
  onCreateControl,
  onRecordCheck,
  onCreateEvidence,
  onCreateVendor,
  onCreateVendorAssessment,
  onGenerateReport,
}) => {
  const [subView, setSubView] = useState<ComplianceSubView>('controls');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <section style={authStyles.cardHighlighted}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 style={authStyles.sectionTitle}>
              <ClipboardCheck size={18} /> Compliance & Quản lý nhà cung cấp (Mục 14.6)
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Kiểm soát định kỳ, bằng chứng thực hiện (File/Log/Report/Link), nhà cung cấp
              (Email/SMS/Cloud/Payment/AI), đánh giá dữ liệu & phương án dự phòng.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busy}
              style={authStyles.btnAccent}
              onClick={() => void onRunReviewSweep(false)}
            >
              <Play size={14} /> Quét nhắc rà soát
            </button>
            <button
              type="button"
              disabled={busy}
              style={authStyles.btnSecondary}
              onClick={() => void onRefresh()}
            >
              <RefreshCw size={14} /> Làm mới
            </button>
          </div>
        </div>

        {overview && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: '10px',
              marginTop: '14px',
            }}
          >
            <div style={authStyles.codeBox}>
              <div>Controls ({overview.counts.activeControls} active)</div>
              <strong>
                Pass {overview.counts.passRatePercent}% • Quá hạn {overview.counts.overdueControls}
              </strong>
            </div>
            <div style={authStyles.codeBox}>
              <div>Bằng chứng / Kiểm tra</div>
              <strong>
                {overview.counts.validEvidences} hợp lệ • {overview.counts.totalChecks} lần kiểm
              </strong>
            </div>
            <div style={authStyles.codeBox}>
              <div>Nhà cung cấp</div>
              <strong>
                {overview.counts.totalVendors} vendor • Thiếu fallback:{' '}
                {overview.counts.vendorsMissingFallback}
              </strong>
            </div>
            <div style={authStyles.codeBox}>
              <div>Hợp đồng & Rà soát</div>
              <strong>
                HĐ sắp hết: {overview.counts.expiringContractsCount} • Quá hạn rà soát:{' '}
                {overview.counts.overdueVendorReviewsCount}
              </strong>
            </div>
          </div>
        )}
      </section>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={subView === 'controls' ? authStyles.btnPrimary : authStyles.btnSecondary}
          onClick={() => setSubView('controls')}
        >
          Controls, Bằng chứng & Lịch sử
        </button>
        <button
          type="button"
          style={subView === 'vendors' ? authStyles.btnPrimary : authStyles.btnSecondary}
          onClick={() => setSubView('vendors')}
        >
          Nhà cung cấp, Dữ liệu & Dự phòng
        </button>
        <button
          type="button"
          style={subView === 'reports' ? authStyles.btnPrimary : authStyles.btnSecondary}
          onClick={() => setSubView('reports')}
        >
          Báo cáo Compliance
        </button>
      </div>

      {subView === 'controls' && (
        <ControlsAndEvidenceSection
          busy={busy}
          controls={controls}
          evidences={evidences}
          checkHistories={checkHistories}
          onCreateControl={onCreateControl}
          onRecordCheck={onRecordCheck}
          onCreateEvidence={onCreateEvidence}
        />
      )}

      {subView === 'vendors' && (
        <VendorsAndAssessmentsSection
          busy={busy}
          vendors={vendors}
          selectedVendorId={selectedVendorId}
          assessments={vendorAssessments}
          onSelectVendor={onSelectVendor}
          onCreateVendor={onCreateVendor}
          onCreateAssessment={onCreateVendorAssessment}
        />
      )}

      {subView === 'reports' && (
        <ComplianceReportSection
          accessToken={accessToken}
          busy={busy}
          reportResult={reportResult}
          onGenerateReport={onGenerateReport}
        />
      )}
    </div>
  );
};
