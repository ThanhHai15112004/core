import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
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
} from '../types/data-governance.types';

function authHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}

export const dataGovernanceApi = {
  getOverview: (accessToken: string) =>
    fetchApi<DataGovernanceOverviewItem>(API_ROUTES.DATA_GOVERNANCE.OVERVIEW, {
      headers: authHeaders(accessToken),
    }),

  listClassifications: (accessToken: string) =>
    fetchApi<DataClassificationItem[]>(API_ROUTES.DATA_GOVERNANCE.CLASSIFICATIONS('limit=100'), {
      headers: authHeaders(accessToken),
    }),

  upsertClassification: (
    accessToken: string,
    payload: {
      dataTypeCode: string;
      displayName: string;
      moduleName: string;
      classificationLevel: DataClassificationLevel;
      containsPii: boolean;
      retentionDays: number;
      retentionAction: RetentionAction;
      legalBasis?: string;
    },
  ) =>
    fetchApi<DataClassificationItem>(API_ROUTES.DATA_GOVERNANCE.CLASSIFICATIONS(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  listSensitiveFields: (accessToken: string) =>
    fetchApi<SensitiveFieldItem[]>(API_ROUTES.DATA_GOVERNANCE.SENSITIVE_FIELDS('limit=100'), {
      headers: authHeaders(accessToken),
    }),

  upsertSensitiveField: (
    accessToken: string,
    payload: {
      resourceType: string;
      fieldPath: string;
      displayName: string;
      classificationLevel: DataClassificationLevel;
      maskStrategy: SensitiveMaskStrategy;
      redactInLog: boolean;
      maskInExport: boolean;
      requiredPermission?: string;
    },
  ) =>
    fetchApi<SensitiveFieldItem>(API_ROUTES.DATA_GOVERNANCE.SENSITIVE_FIELDS(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  runRetentionSweep: (accessToken: string, dryRun: boolean) =>
    fetchApi<{
      executedAt: string;
      dryRun: boolean;
      evaluatedPolicies: number;
      results: ReadonlyArray<{
        dataTypeCode: string;
        scannedCount: number;
        affectedCount: number;
        skippedLegalHoldCount: number;
        actionApplied: string;
      }>;
    }>(API_ROUTES.DATA_GOVERNANCE.RETENTION_SWEEP, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ dryRun }),
    }),

  listDsarRequests: (accessToken: string) =>
    fetchApi<DsarRequestItem[]>(API_ROUTES.DATA_GOVERNANCE.DSAR('limit=50'), {
      headers: authHeaders(accessToken),
    }),

  createDsarRequest: (
    accessToken: string,
    payload: {
      requestType: DsarRequestType;
      subjectUserId?: number;
      exportFormat?: DsarExportFormat;
      reason?: string;
      excludedDataTypeCodes?: string[];
    },
  ) =>
    fetchApi<DsarRequestItem>(API_ROUTES.DATA_GOVERNANCE.DSAR(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  approveDsarRequest: (
    accessToken: string,
    id: number,
    payload: { comment?: string; excludedDataTypeCodes?: string[] },
  ) =>
    fetchApi<DsarRequestItem>(API_ROUTES.DATA_GOVERNANCE.DSAR_APPROVE(id), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  rejectDsarRequest: (accessToken: string, id: number, comment: string) =>
    fetchApi<DsarRequestItem>(API_ROUTES.DATA_GOVERNANCE.DSAR_REJECT(id), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ comment }),
    }),

  downloadDsarExport: (accessToken: string, token: string) =>
    fetchApi<DsarDownloadPayload>(API_ROUTES.DATA_GOVERNANCE.DSAR_DOWNLOAD(token), {
      headers: authHeaders(accessToken),
    }),

  listConsentDefinitions: (accessToken: string) =>
    fetchApi<ConsentDefinitionItem[]>(API_ROUTES.DATA_GOVERNANCE.CONSENT_DEFINITIONS('limit=100'), {
      headers: authHeaders(accessToken),
    }),

  upsertConsentDefinition: (
    accessToken: string,
    payload: {
      purposeCode: string;
      policyVersion: string;
      title: string;
      description: string;
      classificationLevel: DataClassificationLevel;
      isMandatory: boolean;
      validityDays?: number | null;
    },
  ) =>
    fetchApi<ConsentDefinitionItem>(API_ROUTES.DATA_GOVERNANCE.CONSENT_DEFINITIONS(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  listConsentRecords: (accessToken: string) =>
    fetchApi<UserConsentItem[]>(API_ROUTES.DATA_GOVERNANCE.CONSENT_RECORDS('limit=50'), {
      headers: authHeaders(accessToken),
    }),

  grantConsent: (
    accessToken: string,
    payload: { userId?: number; purposeCode: string; policyVersion?: string },
  ) =>
    fetchApi<UserConsentItem>(API_ROUTES.DATA_GOVERNANCE.CONSENT_GRANT, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  withdrawConsent: (
    accessToken: string,
    payload: { userId?: number; purposeCode: string; reason?: string },
  ) =>
    fetchApi<UserConsentItem>(API_ROUTES.DATA_GOVERNANCE.CONSENT_WITHDRAW, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  listLegalHolds: (accessToken: string) =>
    fetchApi<LegalHoldItem[]>(API_ROUTES.DATA_GOVERNANCE.LEGAL_HOLDS('limit=50'), {
      headers: authHeaders(accessToken),
    }),

  createLegalHold: (
    accessToken: string,
    payload: {
      title: string;
      caseReference?: string;
      reason: string;
      scopeType: LegalHoldScopeType;
      targetUserId?: number | null;
      dataTypeCode?: string | null;
      resourceType?: string | null;
      resourceId?: string | null;
    },
  ) =>
    fetchApi<LegalHoldItem>(API_ROUTES.DATA_GOVERNANCE.LEGAL_HOLDS(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  releaseLegalHold: (accessToken: string, id: number, reason: string) =>
    fetchApi<LegalHoldItem>(API_ROUTES.DATA_GOVERNANCE.LEGAL_HOLD_RELEASE(id), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ reason }),
    }),
};
