export type DataClassificationLevel = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export type RetentionAction = 'PURGE' | 'ANONYMIZE' | 'ARCHIVE' | 'RETAIN_LEGAL';
export type SensitiveMaskStrategy = 'FULL' | 'PARTIAL' | 'EMAIL' | 'PHONE' | 'HASH';
export type DsarRequestType = 'ACCESS' | 'ERASURE' | 'EXPORT';
export type DsarExportFormat = 'json' | 'csv';
export type LegalHoldScopeType = 'USER' | 'DATA_TYPE' | 'RESOURCE';

export interface DataGovernanceOverviewItem {
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

export interface DataClassificationItem {
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
}

export interface SensitiveFieldItem {
  readonly id: number;
  readonly resourceType: string;
  readonly fieldPath: string;
  readonly displayName: string;
  readonly classificationLevel: DataClassificationLevel;
  readonly maskStrategy: SensitiveMaskStrategy;
  readonly redactInLog: boolean;
  readonly maskInExport: boolean;
  readonly requiredPermission: string | null;
  readonly description: string | null;
  readonly isEnabled: boolean;
}

export interface DsarRetainedExceptionItem {
  readonly moduleName: string;
  readonly dataTypeCode: string;
  readonly reasonCode: string;
  readonly reason: string;
  readonly retainedCount: number;
}

export interface DsarRequestItem {
  readonly id: number;
  readonly requestCode: string;
  readonly requestType: DsarRequestType;
  readonly subjectUserId: number;
  readonly requestedBy: number;
  readonly status: number;
  readonly statusName: string;
  readonly exportFormat: DsarExportFormat | null;
  readonly reason: string | null;
  readonly requiresApproval: boolean;
  readonly approvedBy: number | null;
  readonly approvedAt: string | null;
  readonly decisionComment: string | null;
  readonly retainedExceptions: readonly DsarRetainedExceptionItem[];
  readonly summary: Record<string, unknown> | null;
  readonly downloadUrl: string | null;
  readonly exportExpiresAt: string | null;
  readonly dueAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

export interface DsarDownloadPayload {
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

export interface ConsentDefinitionItem {
  readonly id: number;
  readonly purposeCode: string;
  readonly policyVersion: string;
  readonly title: string;
  readonly description: string;
  readonly classificationLevel: DataClassificationLevel;
  readonly isMandatory: boolean;
  readonly validityDays: number | null;
  readonly isActive: boolean;
}

export interface UserConsentItem {
  readonly id: number;
  readonly userId: number;
  readonly purposeCode: string;
  readonly policyVersion: string;
  readonly consentStatus: 'GRANTED' | 'WITHDRAWN' | 'EXPIRED';
  readonly grantedAt: string;
  readonly withdrawnAt: string | null;
  readonly withdrawReason: string | null;
  readonly expiresAt: string | null;
  readonly collectionSource: string;
}

export interface LegalHoldItem {
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
  readonly holdStatus: number;
  readonly holdStatusName: string;
  readonly startsAt: string;
  readonly expiresAt: string | null;
  readonly releasedAt: string | null;
  readonly releaseReason: string | null;
}
