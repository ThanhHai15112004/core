import React, { useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { authStyles } from '../auth-ui.styles';
import type {
  ConsentDefinitionItem,
  DataClassificationItem,
  DataClassificationLevel,
  DataGovernanceOverviewItem,
  DsarDownloadPayload,
  DsarExportFormat,
  DsarRequestItem,
  DsarRequestType,
  LegalHoldItem,
  LegalHoldScopeType,
  RetentionAction,
  SensitiveFieldItem,
  SensitiveMaskStrategy,
  UserConsentItem,
} from '../../types/data-governance.types';
import { ClassificationAndSensitiveSection } from './ClassificationAndSensitiveSection';
import { ConsentAndLegalHoldSection } from './ConsentAndLegalHoldSection';
import { DsarRequestsSection } from './DsarRequestsSection';

type GovernanceSubView = 'classification' | 'dsar' | 'consent-hold';

interface Props {
  readonly accessToken: string;
  readonly busy: boolean;
  readonly overview: DataGovernanceOverviewItem | null;
  readonly classifications: readonly DataClassificationItem[];
  readonly sensitiveFields: readonly SensitiveFieldItem[];
  readonly dsarRequests: readonly DsarRequestItem[];
  readonly consentDefinitions: readonly ConsentDefinitionItem[];
  readonly consentRecords: readonly UserConsentItem[];
  readonly legalHolds: readonly LegalHoldItem[];
  readonly lastExportPreview: DsarDownloadPayload | null;
  readonly onClearExportPreview: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onUpsertClassification: (payload: {
    dataTypeCode: string;
    displayName: string;
    moduleName: string;
    classificationLevel: DataClassificationLevel;
    containsPii: boolean;
    retentionDays: number;
    retentionAction: RetentionAction;
    legalBasis?: string;
  }) => Promise<void>;
  readonly onUpsertSensitiveField: (payload: {
    resourceType: string;
    fieldPath: string;
    displayName: string;
    classificationLevel: DataClassificationLevel;
    maskStrategy: SensitiveMaskStrategy;
    redactInLog: boolean;
    maskInExport: boolean;
    requiredPermission?: string;
  }) => Promise<void>;
  readonly onRunRetentionSweep: (dryRun: boolean) => Promise<void>;
  readonly onCreateDsarRequest: (payload: {
    requestType: DsarRequestType;
    subjectUserId?: number;
    exportFormat?: DsarExportFormat;
    reason?: string;
    excludedDataTypeCodes?: string[];
  }) => Promise<void>;
  readonly onApproveDsar: (
    id: number,
    comment?: string,
    excludedCodesCsv?: string,
  ) => Promise<void>;
  readonly onRejectDsar: (id: number, comment: string) => Promise<void>;
  readonly onDownloadDsarExport: (downloadUrl: string) => Promise<void>;
  readonly onUpsertConsentDefinition: (payload: {
    purposeCode: string;
    policyVersion: string;
    title: string;
    description: string;
    classificationLevel: DataClassificationLevel;
    isMandatory: boolean;
    validityDays?: number | null;
  }) => Promise<void>;
  readonly onGrantConsent: (purposeCode: string, userId?: number) => Promise<void>;
  readonly onWithdrawConsent: (
    purposeCode: string,
    reason?: string,
    userId?: number,
  ) => Promise<void>;
  readonly onCreateLegalHold: (payload: {
    title: string;
    caseReference?: string;
    reason: string;
    scopeType: LegalHoldScopeType;
    targetUserId?: number | null;
    dataTypeCode?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
  }) => Promise<void>;
  readonly onReleaseLegalHold: (id: number, reason: string) => Promise<void>;
}

export const DataGovernancePanel: React.FC<Props> = ({
  accessToken,
  busy,
  overview,
  classifications,
  sensitiveFields,
  dsarRequests,
  consentDefinitions,
  consentRecords,
  legalHolds,
  lastExportPreview,
  onClearExportPreview,
  onRefresh,
  onUpsertClassification,
  onUpsertSensitiveField,
  onRunRetentionSweep,
  onCreateDsarRequest,
  onApproveDsar,
  onRejectDsar,
  onDownloadDsarExport,
  onUpsertConsentDefinition,
  onGrantConsent,
  onWithdrawConsent,
  onCreateLegalHold,
  onReleaseLegalHold,
}) => {
  const [subView, setSubView] = useState<GovernanceSubView>('classification');

  if (!accessToken) {
    return (
      <section style={authStyles.card}>
        <p style={authStyles.sectionDesc}>
          Vui lòng đăng nhập để sử dụng phân hệ Quyền riêng tư & Quản trị dữ liệu (14.5).
        </p>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: '18px' }}>
      <div style={authStyles.cardHighlighted}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            marginBottom: '14px',
          }}
        >
          <div>
            <h2 style={authStyles.sectionTitle}>
              <Database size={18} /> Quyền riêng tư & Quản trị dữ liệu (14.5 — Tùy chọn pháp lý)
            </h2>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Phân loại 4 mức (Public, Internal, Confidential, Restricted), đánh dấu trường nhạy cảm, Retention, DSAR Xem/Xuất/Xóa có phê duyệt, Consent & Legal Hold.
            </p>
          </div>
          <button
            type="button"
            style={authStyles.btnSecondary}
            disabled={busy}
            onClick={() => void onRefresh()}
          >
            <RefreshCw size={14} /> Làm mới
          </button>
        </div>

        {overview && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: '10px',
              marginBottom: '14px',
            }}
          >
            <div style={authStyles.codeBox}>
              Phân loại dữ liệu: <strong>{overview.counts.classificationsTotal}</strong> (Restricted:{' '}
              {overview.counts.classificationsByLevel.RESTRICTED})
            </div>
            <div style={authStyles.codeBox}>
              Trường nhạy cảm: <strong>{overview.counts.sensitiveFieldsTotal}</strong> (Log:{' '}
              {overview.counts.logRedactedFieldsCount} / Export:{' '}
              {overview.counts.exportMaskedFieldsCount})
            </div>
            <div style={authStyles.codeBox}>
              DSAR chờ duyệt xóa: <strong>{overview.counts.pendingApprovalErasureCount}</strong> · SLA:{' '}
              {overview.dsarSlaDays} ngày
            </div>
            <div style={authStyles.codeBox}>
              Consent hiệu lực: <strong>{overview.counts.activeConsentPurposesCount}</strong> · Legal Hold:{' '}
              <strong>{overview.counts.activeLegalHoldsCount}</strong>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            style={subView === 'classification' ? authStyles.btnPrimary : authStyles.btnSecondary}
            onClick={() => setSubView('classification')}
          >
            1. Phân loại, Trường nhạy cảm & Retention
          </button>
          <button
            type="button"
            style={subView === 'dsar' ? authStyles.btnPrimary : authStyles.btnSecondary}
            onClick={() => setSubView('dsar')}
          >
            2. Yêu cầu dữ liệu cá nhân (DSAR Xem / Xuất / Xóa)
          </button>
          <button
            type="button"
            style={subView === 'consent-hold' ? authStyles.btnPrimary : authStyles.btnSecondary}
            onClick={() => setSubView('consent-hold')}
          >
            3. Sự đồng ý (Consent) & Tạm giữ (Legal Hold)
          </button>
        </div>
      </div>

      {subView === 'classification' && (
        <ClassificationAndSensitiveSection
          busy={busy}
          classifications={classifications}
          sensitiveFields={sensitiveFields}
          onUpsertClassification={onUpsertClassification}
          onUpsertSensitiveField={onUpsertSensitiveField}
          onRunRetentionSweep={onRunRetentionSweep}
        />
      )}

      {subView === 'dsar' && (
        <DsarRequestsSection
          busy={busy}
          requests={dsarRequests}
          lastExportPreview={lastExportPreview}
          onClearExportPreview={onClearExportPreview}
          onCreateRequest={onCreateDsarRequest}
          onApprove={onApproveDsar}
          onReject={onRejectDsar}
          onDownloadExport={onDownloadDsarExport}
        />
      )}

      {subView === 'consent-hold' && (
        <ConsentAndLegalHoldSection
          busy={busy}
          definitions={consentDefinitions}
          records={consentRecords}
          legalHolds={legalHolds}
          onUpsertDefinition={onUpsertConsentDefinition}
          onGrantConsent={onGrantConsent}
          onWithdrawConsent={onWithdrawConsent}
          onCreateLegalHold={onCreateLegalHold}
          onReleaseLegalHold={onReleaseLegalHold}
        />
      )}
    </section>
  );
};
