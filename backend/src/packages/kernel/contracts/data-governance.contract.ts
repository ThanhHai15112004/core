export const DATA_GOVERNANCE_QUEUE_TOPICS = {
  RETENTION_SWEEP_TICK: 'data-governance.retention.sweep.tick',
  GOVERNANCE_EXPIRATION_TICK: 'data-governance.expiration.sweep.tick',
} as const;

export type DataGovernanceQueueTopic =
  (typeof DATA_GOVERNANCE_QUEUE_TOPICS)[keyof typeof DATA_GOVERNANCE_QUEUE_TOPICS];

export const DATA_GOVERNANCE_DOMAIN_EVENTS = {
  CLASSIFICATION_UPDATED: 'data-governance.classification.updated',
  SENSITIVE_FIELD_UPDATED: 'data-governance.sensitive-field.updated',
  RETENTION_EXECUTED: 'data-governance.retention.executed',
  DSAR_CREATED: 'data-governance.dsar.created',
  DSAR_APPROVED: 'data-governance.dsar.approved',
  DSAR_REJECTED: 'data-governance.dsar.rejected',
  DSAR_COMPLETED: 'data-governance.dsar.completed',
  CONSENT_DEFINITION_SAVED: 'data-governance.consent.definition.saved',
  CONSENT_GRANTED: 'data-governance.consent.granted',
  CONSENT_WITHDRAWN: 'data-governance.consent.withdrawn',
  LEGAL_HOLD_CREATED: 'data-governance.legal-hold.created',
  LEGAL_HOLD_RELEASED: 'data-governance.legal-hold.released',
} as const;

export type DataGovernanceDomainEventName =
  (typeof DATA_GOVERNANCE_DOMAIN_EVENTS)[keyof typeof DATA_GOVERNANCE_DOMAIN_EVENTS];

export const DATA_CLASSIFICATION_LEVEL = {
  PUBLIC: 'PUBLIC',
  INTERNAL: 'INTERNAL',
  CONFIDENTIAL: 'CONFIDENTIAL',
  RESTRICTED: 'RESTRICTED',
} as const;

export type DataClassificationLevel =
  (typeof DATA_CLASSIFICATION_LEVEL)[keyof typeof DATA_CLASSIFICATION_LEVEL];

export const SENSITIVE_FIELD_MASK_STRATEGY = {
  FULL: 'FULL',
  PARTIAL: 'PARTIAL',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  HASH: 'HASH',
} as const;

export type SensitiveFieldMaskStrategy =
  (typeof SENSITIVE_FIELD_MASK_STRATEGY)[keyof typeof SENSITIVE_FIELD_MASK_STRATEGY];

export interface SensitiveFieldActorContext {
  readonly id?: number | null | undefined;
  readonly roles?: readonly string[] | undefined;
  readonly permissions?: readonly string[] | undefined;
}

export interface SensitiveFieldPolicyRule {
  readonly resourceType: string;
  readonly fieldPath: string;
  readonly classificationLevel: DataClassificationLevel;
  readonly maskStrategy: SensitiveFieldMaskStrategy;
  readonly redactInLog: boolean;
  readonly maskInExport: boolean;
  readonly requiredPermission: string | null;
}

export interface ExportDatasetSanitizeInput {
  readonly moduleName: string;
  readonly profileCode: string;
  readonly csvContent?: string | undefined;
  readonly actor?: SensitiveFieldActorContext | undefined;
}

export interface ExportDatasetSanitizeResult {
  readonly csvContent?: string | undefined;
  readonly maskedColumns: readonly string[];
}

export interface ISensitiveFieldPolicyEvaluator {
  getLogRedactFieldNames(): readonly string[];
  listRulesForResource(resourceType: string): Promise<readonly SensitiveFieldPolicyRule[]>;
  sanitizeRecordForActor<T extends Record<string, unknown>>(
    resourceType: string,
    record: T,
    actor?: SensitiveFieldActorContext,
    context?: 'read' | 'export',
  ): Promise<T>;
  sanitizeCsvExport?(input: ExportDatasetSanitizeInput): Promise<ExportDatasetSanitizeResult>;
}

export interface LegalHoldCheckQuery {
  readonly userId?: number | null | undefined;
  readonly dataTypeCode?: string | null | undefined;
  readonly resourceType?: string | null | undefined;
  readonly resourceId?: string | number | null | undefined;
}

export interface LegalHoldMatchedItem {
  readonly holdId: number;
  readonly holdCode: string;
  readonly title: string;
  readonly scopeType: 'USER' | 'DATA_TYPE' | 'RESOURCE';
  readonly caseReference: string | null;
  readonly reason: string;
  readonly expiresAt: string | null;
}

export interface LegalHoldCheckDecision {
  readonly onHold: boolean;
  readonly holds: readonly LegalHoldMatchedItem[];
}

export interface ILegalHoldGuardEvaluator {
  checkLegalHold(query: LegalHoldCheckQuery): Promise<LegalHoldCheckDecision>;
  assertNotOnLegalHold(query: LegalHoldCheckQuery): Promise<void>;
}

export interface PersonalDataModuleSection {
  readonly moduleName: string;
  readonly dataTypeCode: string;
  readonly classificationLevel: DataClassificationLevel;
  readonly recordCount: number;
  readonly records: readonly Record<string, unknown>[];
}

export interface PersonalDataErasureExceptionItem {
  readonly moduleName: string;
  readonly dataTypeCode: string;
  readonly reasonCode: string;
  readonly reason: string;
  readonly retainedCount: number;
}

export interface PersonalDataErasureModuleResult {
  readonly moduleName: string;
  readonly dataTypeCode: string;
  readonly erasedCount: number;
  readonly anonymizedCount: number;
  readonly retainedExceptions: readonly PersonalDataErasureExceptionItem[];
}

export interface PersonalDataErasureOptions {
  readonly subjectUserId: number;
  readonly actorUserId: number | null;
  readonly requestCode: string;
  readonly excludedDataTypeCodes?: readonly string[] | undefined;
  readonly reason?: string | null | undefined;
}

export interface IPersonalDataContributor {
  readonly contributorKey: string;
  readonly moduleName: string;
  readonly dataTypeCode: string;
  readonly defaultClassification: DataClassificationLevel;
  collectPersonalData(subjectUserId: number): Promise<PersonalDataModuleSection>;
  eraseOrAnonymizePersonalData?(
    options: PersonalDataErasureOptions,
  ): Promise<PersonalDataErasureModuleResult>;
}

export interface RetentionPolicyExecutionInput {
  readonly dataTypeCode: string;
  readonly retentionDays: number;
  readonly retentionAction: 'PURGE' | 'ANONYMIZE' | 'ARCHIVE' | 'RETAIN_LEGAL';
  readonly cutoffDate: Date;
  readonly dryRun?: boolean | undefined;
  readonly isUserUnderLegalHold: (userId: number) => Promise<boolean>;
  readonly isResourceUnderLegalHold: (
    resourceType: string,
    resourceId: string | number,
  ) => Promise<boolean>;
}

export interface RetentionPolicyExecutionResult {
  readonly dataTypeCode: string;
  readonly scannedCount: number;
  readonly affectedCount: number;
  readonly skippedLegalHoldCount: number;
  readonly actionApplied: string;
}

export interface IRetentionExecutor {
  readonly dataTypeCode: string;
  readonly moduleName: string;
  executeRetention(input: RetentionPolicyExecutionInput): Promise<RetentionPolicyExecutionResult>;
}
