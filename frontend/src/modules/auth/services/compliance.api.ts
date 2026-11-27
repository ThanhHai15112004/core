import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
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

function authHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}

export const complianceApi = {
  getOverview: (accessToken: string) =>
    fetchApi<ComplianceOverviewItem>(API_ROUTES.COMPLIANCE.OVERVIEW, {
      headers: authHeaders(accessToken),
    }),

  runReviewSweep: (accessToken: string, dryRun: boolean) =>
    fetchApi<{
      executedAt: string;
      dryRun: boolean;
      controlsDueOrOverdue: number;
      vendorReviewsDueOrOverdue: number;
      contractsExpiringOrExpired: number;
      evidencesExpiring: number;
      evidencesMarkedExpired: number;
      notificationsDispatched: number;
    }>(API_ROUTES.COMPLIANCE.REVIEWS_SWEEP, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ dryRun }),
    }),

  listControls: (accessToken: string) =>
    fetchApi<ComplianceControlItem[]>(API_ROUTES.COMPLIANCE.CONTROLS('limit=100'), {
      headers: authHeaders(accessToken),
    }),

  createControl: (
    accessToken: string,
    payload: {
      title: string;
      description?: string;
      domain: string;
      frameworkTags: string[];
      ownerUserId?: number | null;
      frequency: ControlFrequency;
    },
  ) =>
    fetchApi<ComplianceControlItem>(API_ROUTES.COMPLIANCE.CONTROLS(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  recordControlCheck: (
    accessToken: string,
    controlId: number,
    payload: {
      result: ControlCheckResult;
      score?: number | null;
      findings?: string;
      remediationPlan?: string;
      evidenceIds?: number[];
    },
  ) =>
    fetchApi<ComplianceCheckHistoryItem>(API_ROUTES.COMPLIANCE.CONTROL_CHECKS(controlId), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  listCheckHistories: (accessToken: string) =>
    fetchApi<ComplianceCheckHistoryItem[]>(API_ROUTES.COMPLIANCE.CHECKS('limit=50'), {
      headers: authHeaders(accessToken),
    }),

  listEvidences: (accessToken: string) =>
    fetchApi<ComplianceEvidenceItem[]>(API_ROUTES.COMPLIANCE.EVIDENCES('limit=100'), {
      headers: authHeaders(accessToken),
    }),

  createEvidence: (
    accessToken: string,
    payload: {
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
    },
  ) =>
    fetchApi<ComplianceEvidenceItem>(API_ROUTES.COMPLIANCE.EVIDENCES(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  listVendors: (accessToken: string) =>
    fetchApi<ComplianceVendorItem[]>(API_ROUTES.COMPLIANCE.VENDORS('limit=100'), {
      headers: authHeaders(accessToken),
    }),

  createVendor: (
    accessToken: string,
    payload: {
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
    },
  ) =>
    fetchApi<ComplianceVendorItem>(API_ROUTES.COMPLIANCE.VENDORS(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  listVendorAssessments: (accessToken: string, vendorId: number) =>
    fetchApi<VendorDataAssessmentItem[]>(
      API_ROUTES.COMPLIANCE.VENDOR_DATA_ASSESSMENTS(vendorId),
      { headers: authHeaders(accessToken) },
    ),

  createVendorAssessment: (
    accessToken: string,
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
  ) =>
    fetchApi<VendorDataAssessmentItem>(API_ROUTES.COMPLIANCE.VENDOR_DATA_ASSESSMENTS(vendorId), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  generateReport: (
    accessToken: string,
    payload: {
      frameworkTag?: string;
      domain?: string;
      vendorCategory?: VendorCategory;
      format: 'json' | 'csv' | 'xlsx' | 'pdf';
    },
  ) =>
    fetchApi<ComplianceReportResultItem>(API_ROUTES.COMPLIANCE.REPORTS_GENERATE, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  downloadReportArtifact: (accessToken: string, token: string) =>
    fetchApi<{
      token: string;
      fileName: string;
      contentType: string;
      format: string;
      csvContent?: string;
      xlsxBase64?: string;
      pdfBase64?: string;
    }>(API_ROUTES.COMPLIANCE.REPORTS_DOWNLOAD(token), {
      headers: authHeaders(accessToken),
    }),
};
