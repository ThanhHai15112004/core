import {
  type PersonalDataErasureExceptionItem,
  safeJsonParse,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import type { DataClassificationEntity } from '../entities/data-classification.entity.js';
import type { DataLegalHoldEntity } from '../entities/data-legal-hold.entity.js';
import type { DataSensitiveFieldEntity } from '../entities/data-sensitive-field.entity.js';
import type { PrivacyConsentDefinitionEntity } from '../entities/privacy-consent-definition.entity.js';
import type { PrivacyDsarRequestEntity } from '../entities/privacy-dsar-request.entity.js';
import type { PrivacyUserConsentEntity } from '../entities/privacy-user-consent.entity.js';
import {
  DSAR_STATUS_NAMES,
  LEGAL_HOLD_STATUS_NAMES,
} from '../enum/data-governance.enum.js';
import type {
  ConsentDefinitionView,
  DataClassificationView,
  DsarRequestView,
  LegalHoldView,
  SensitiveFieldView,
  UserConsentView,
} from '../types/data-governance.types.js';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export function mapClassificationToView(entity: DataClassificationEntity): DataClassificationView {
  return {
    id: entity.id,
    dataTypeCode: entity.dataTypeCode,
    displayName: entity.displayName,
    moduleName: entity.moduleName,
    classificationLevel: entity.classificationLevel,
    containsPii: entity.containsPii,
    retentionDays: entity.retentionDays,
    retentionAction: entity.retentionAction,
    legalBasis: entity.legalBasis,
    description: entity.description,
    isEnabled: entity.isEnabled,
    lastEnforcedAt: toIso(entity.lastEnforcedAt),
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapSensitiveFieldToView(entity: DataSensitiveFieldEntity): SensitiveFieldView {
  return {
    id: entity.id,
    resourceType: entity.resourceType,
    fieldPath: entity.fieldPath,
    displayName: entity.displayName,
    classificationLevel: entity.classificationLevel,
    maskStrategy: entity.maskStrategy,
    redactInLog: entity.redactInLog,
    maskInExport: entity.maskInExport,
    requiredPermission: entity.requiredPermission,
    description: entity.description,
    isEnabled: entity.isEnabled,
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapDsarRequestToView(entity: PrivacyDsarRequestEntity): DsarRequestView {
  const statusName = DSAR_STATUS_NAMES[entity.status] ?? 'PENDING';
  const exceptions =
    safeJsonParse<PersonalDataErasureExceptionItem[]>(entity.exceptionsJson, []) ?? [];
  const summary = entity.summaryJson
    ? safeJsonParseObject<Record<string, unknown>>(entity.summaryJson)
    : null;
  const isExpired =
    entity.exportExpiresAt !== null && new Date(entity.exportExpiresAt).getTime() <= Date.now();
  const downloadUrl =
    entity.exportToken && !isExpired
      ? `/api/v1/data-governance/dsar/downloads/${encodeURIComponent(entity.exportToken)}`
      : null;

  return {
    id: entity.id,
    requestCode: entity.requestCode,
    requestType: entity.requestType,
    subjectUserId: entity.subjectUserId,
    requestedBy: entity.requestedBy,
    status: entity.status,
    statusName,
    exportFormat: entity.exportFormat,
    reason: entity.reason,
    requiresApproval: entity.requiresApproval,
    approvedBy: entity.approvedBy,
    approvedAt: toIso(entity.approvedAt),
    decisionComment: entity.decisionComment,
    retainedExceptions: exceptions,
    summary,
    downloadUrl,
    exportExpiresAt: toIso(entity.exportExpiresAt),
    dueAt: toIso(entity.dueAt) ?? new Date().toISOString(),
    completedAt: toIso(entity.completedAt),
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapConsentDefinitionToView(
  entity: PrivacyConsentDefinitionEntity,
): ConsentDefinitionView {
  return {
    id: entity.id,
    purposeCode: entity.purposeCode,
    policyVersion: entity.policyVersion,
    title: entity.title,
    description: entity.description,
    classificationLevel: entity.classificationLevel,
    isMandatory: entity.isMandatory,
    validityDays: entity.validityDays,
    isActive: entity.isActive,
    publishedAt: toIso(entity.publishedAt) ?? new Date().toISOString(),
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapUserConsentToView(entity: PrivacyUserConsentEntity): UserConsentView {
  return {
    id: entity.id,
    userId: entity.userId,
    purposeCode: entity.purposeCode,
    policyVersion: entity.policyVersion,
    consentStatus: entity.consentStatus,
    grantedAt: toIso(entity.grantedAt) ?? new Date().toISOString(),
    withdrawnAt: toIso(entity.withdrawnAt),
    withdrawReason: entity.withdrawReason,
    expiresAt: toIso(entity.expiresAt),
    collectionSource: entity.collectionSource,
    ipAddress: entity.ipAddress,
    userAgent: entity.userAgent,
    recordedBy: entity.recordedBy,
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
  };
}

export function mapLegalHoldToView(entity: DataLegalHoldEntity): LegalHoldView {
  return {
    id: entity.id,
    holdCode: entity.holdCode,
    title: entity.title,
    caseReference: entity.caseReference,
    reason: entity.reason,
    scopeType: entity.scopeType,
    targetUserId: entity.targetUserId,
    dataTypeCode: entity.dataTypeCode,
    resourceType: entity.resourceType,
    resourceId: entity.resourceId,
    holdStatus: entity.holdStatus,
    holdStatusName: LEGAL_HOLD_STATUS_NAMES[entity.holdStatus] ?? 'ACTIVE',
    startsAt: toIso(entity.startsAt) ?? new Date().toISOString(),
    expiresAt: toIso(entity.expiresAt),
    createdBy: entity.createdBy,
    releasedBy: entity.releasedBy,
    releasedAt: toIso(entity.releasedAt),
    releaseReason: entity.releaseReason,
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}
