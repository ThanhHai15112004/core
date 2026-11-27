import type {
  DataClassificationLevel,
  PersonalDataErasureExceptionItem,
  PersonalDataModuleSection,
  RetentionPolicyExecutionResult,
  SensitiveFieldMaskStrategy,
} from '@packages/kernel/index.js';
import type {
  ConsentStatus,
  DsarExportFormat,
  DsarRequestType,
  DsarStatusCode,
  DsarStatusName,
  LegalHoldScopeType,
  LegalHoldStatusCode,
  LegalHoldStatusName,
  RetentionAction,
} from '../enum/data-governance.enum.js';

export interface DataGovernanceOverviewView {
  readonly moduleEnabled: boolean;
  readonly dsarEnabled: boolean;
  readonly consentEnabled: boolean;
  readonly legalHoldEnabled: boolean;
  readonly dsarSlaDays: number;
  readonly exportTtlMinutes: number;
  readonly erasureRequireApproval: boolean;
  readonly counts: {
    readonly classificationsTotal: number;
    readonly classificationsByLevel: Readonly<Record<DataClassificationLevel, number>>;
    readonly sensitiveFieldsTotal: number;
    readonly logRedactedFieldsCount: number;
    readonly exportMaskedFieldsCount: number;
    readonly pendingDsarCount: number;
    readonly pendingApprovalErasureCount: number;
    readonly activeConsentPurposesCount: number;
    readonly activeLegalHoldsCount: number;
    readonly registeredContributorsCount: number;
  };
}

export interface DataClassificationView {
  readonly id: number;
  readonly dataTypeCode: string;
  readonly displayName: string;
  readonly moduleName: string;
  readonly classificationLevel: DataClassificationLevel;
  readonly containsPii: boolean;
  readonly retentionDays: number;
  readonly retentionAction: RetentionAction;
  readonly legalBasis: string | null;
  readonly description: string | null;
  readonly isEnabled: boolean;
  readonly lastEnforcedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SensitiveFieldView {
  readonly id: number;
  readonly resourceType: string;
  readonly fieldPath: string;
  readonly displayName: string;
  readonly classificationLevel: DataClassificationLevel;
  readonly maskStrategy: SensitiveFieldMaskStrategy;
  readonly redactInLog: boolean;
  readonly maskInExport: boolean;
  readonly requiredPermission: string | null;
  readonly description: string | null;
  readonly isEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DsarPersonalDataSnapshot {
  readonly generatedAt: string;
  readonly subjectUserId: number;
  readonly totalModules: number;
  readonly totalRecords: number;
  readonly checksumSha256: string;
  readonly sections: readonly PersonalDataModuleSection[];
}

export interface DsarErasureExecutionReport {
  readonly executedAt: string;
  readonly totalErased: number;
  readonly totalAnonymized: number;
  readonly moduleResults: ReadonlyArray<{
    readonly moduleName: string;
    readonly dataTypeCode: string;
    readonly erasedCount: number;
    readonly anonymizedCount: number;
  }>;
  readonly retainedExceptions: readonly PersonalDataErasureExceptionItem[];
}

export interface DsarRequestView {
  readonly id: number;
  readonly requestCode: string;
  readonly requestType: DsarRequestType;
  readonly subjectUserId: number;
  readonly requestedBy: number;
  readonly status: DsarStatusCode;
  readonly statusName: DsarStatusName;
  readonly exportFormat: DsarExportFormat | null;
  readonly reason: string | null;
  readonly requiresApproval: boolean;
  readonly approvedBy: number | null;
  readonly approvedAt: string | null;
  readonly decisionComment: string | null;
  readonly retainedExceptions: readonly PersonalDataErasureExceptionItem[];
  readonly summary:
    DsarPersonalDataSnapshot | DsarErasureExecutionReport | Record<string, unknown> | null;
  readonly downloadUrl: string | null;
  readonly exportExpiresAt: string | null;
  readonly dueAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DsarDownloadPayloadView {
  readonly requestCode: string;
  readonly subjectUserId: number;
  readonly format: DsarExportFormat;
  readonly fileName: string;
  readonly contentType: string;
  readonly checksumSha256: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly content: string;
}

export interface ConsentDefinitionView {
  readonly id: number;
  readonly purposeCode: string;
  readonly policyVersion: string;
  readonly title: string;
  readonly description: string;
  readonly classificationLevel: DataClassificationLevel;
  readonly isMandatory: boolean;
  readonly validityDays: number | null;
  readonly isActive: boolean;
  readonly publishedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserConsentView {
  readonly id: number;
  readonly userId: number;
  readonly purposeCode: string;
  readonly policyVersion: string;
  readonly consentStatus: ConsentStatus;
  readonly grantedAt: string;
  readonly withdrawnAt: string | null;
  readonly withdrawReason: string | null;
  readonly expiresAt: string | null;
  readonly collectionSource: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly recordedBy: number | null;
  readonly createdAt: string;
}

export interface LegalHoldView {
  readonly id: number;
  readonly holdCode: string;
  readonly title: string;
  readonly caseReference: string | null;
  readonly reason: string;
  readonly scopeType: LegalHoldScopeType;
  readonly targetUserId: number | null;
  readonly dataTypeCode: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly holdStatus: LegalHoldStatusCode;
  readonly holdStatusName: LegalHoldStatusName;
  readonly startsAt: string;
  readonly expiresAt: string | null;
  readonly createdBy: number;
  readonly releasedBy: number | null;
  readonly releasedAt: string | null;
  readonly releaseReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RetentionSweepSummaryView {
  readonly executedAt: string;
  readonly dryRun: boolean;
  readonly evaluatedPolicies: number;
  readonly results: readonly RetentionPolicyExecutionResult[];
}

export interface GovernanceExpirationSweepResult {
  readonly expiredHoldsCount: number;
  readonly expiredConsentsCount: number;
  readonly purgedExportTokensCount: number;
  readonly sweptAt: string;
}
