import type { ComplianceCheckHistoryEntity } from '../entities/compliance-check-history.entity.js';
import type { ComplianceControlEntity } from '../entities/compliance-control.entity.js';
import type { ComplianceEvidenceEntity } from '../entities/compliance-evidence.entity.js';
import type { ComplianceVendorDataAssessmentEntity } from '../entities/compliance-vendor-data-assessment.entity.js';
import type { ComplianceVendorEntity } from '../entities/compliance-vendor.entity.js';
import type {
  ComplianceCheckHistoryView,
  ComplianceControlView,
  ComplianceEvidenceView,
  ComplianceVendorView,
  VendorDataAssessmentView,
} from '../types/compliance.types.js';
import {
  classifyDueStatus,
  computeDaysUntil,
  hasVendorFallbackPlan,
  parseJsonNumberList,
  parseJsonObjectOrNull,
  parseJsonStringList,
} from './compliance.helper.js';

export function mapControlToView(
  entity: ComplianceControlEntity,
  reminderDaysBefore = 30,
  now: Date = new Date(),
): ComplianceControlView {
  return {
    id: Number(entity.id),
    controlCode: entity.controlCode,
    title: entity.title,
    description: entity.description,
    domain: entity.domain,
    frameworkTags: parseJsonStringList(entity.frameworkTagsJson),
    ownerUserId:
      entity.ownerUserId !== null && entity.ownerUserId !== undefined
        ? Number(entity.ownerUserId)
        : null,
    organizationUnitId:
      entity.organizationUnitId !== null && entity.organizationUnitId !== undefined
        ? Number(entity.organizationUnitId)
        : null,
    frequency: entity.frequency,
    status: entity.status,
    lastCheckedAt: entity.lastCheckedAt ? entity.lastCheckedAt.toISOString() : null,
    nextCheckDueAt: entity.nextCheckDueAt ? entity.nextCheckDueAt.toISOString() : null,
    lastCheckResult: entity.lastCheckResult ?? null,
    dueStatus: classifyDueStatus(entity.nextCheckDueAt, reminderDaysBefore, now),
    daysUntilDue: computeDaysUntil(entity.nextCheckDueAt, now),
    metadata: parseJsonObjectOrNull(entity.metadataJson),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function mapCheckHistoryToView(
  entity: ComplianceCheckHistoryEntity,
  control?: ComplianceControlEntity | null,
): ComplianceCheckHistoryView {
  return {
    id: Number(entity.id),
    controlId: Number(entity.controlId),
    controlCode: control?.controlCode ?? null,
    controlTitle: control?.title ?? null,
    checkedByUserId: Number(entity.checkedByUserId),
    checkedAt: entity.checkedAt.toISOString(),
    result: entity.result,
    score: entity.score !== null && entity.score !== undefined ? Number(entity.score) : null,
    findings: entity.findings,
    remediationPlan: entity.remediationPlan,
    remediationDueAt: entity.remediationDueAt ? entity.remediationDueAt.toISOString() : null,
    evidenceIds: parseJsonNumberList(entity.evidenceIdsJson),
    metadata: parseJsonObjectOrNull(entity.metadataJson),
    createdAt: entity.createdAt.toISOString(),
  };
}

export function mapEvidenceToView(entity: ComplianceEvidenceEntity): ComplianceEvidenceView {
  return {
    id: Number(entity.id),
    controlId: Number(entity.controlId),
    checkHistoryId:
      entity.checkHistoryId !== null && entity.checkHistoryId !== undefined
        ? Number(entity.checkHistoryId)
        : null,
    vendorId:
      entity.vendorId !== null && entity.vendorId !== undefined ? Number(entity.vendorId) : null,
    evidenceType: entity.evidenceType,
    title: entity.title,
    description: entity.description,
    fileId: entity.fileId !== null && entity.fileId !== undefined ? Number(entity.fileId) : null,
    auditLogId:
      entity.auditLogId !== null && entity.auditLogId !== undefined
        ? Number(entity.auditLogId)
        : null,
    logReference: entity.logReference,
    reportHistoryId:
      entity.reportHistoryId !== null && entity.reportHistoryId !== undefined
        ? Number(entity.reportHistoryId)
        : null,
    reportCode: entity.reportCode,
    externalUrl: entity.externalUrl,
    checksumSha256: entity.checksumSha256,
    collectedByUserId: Number(entity.collectedByUserId),
    collectedAt: entity.collectedAt.toISOString(),
    validUntil: entity.validUntil ? entity.validUntil.toISOString() : null,
    status: entity.status,
    metadata: parseJsonObjectOrNull(entity.metadataJson),
    createdAt: entity.createdAt.toISOString(),
  };
}

export function mapVendorToView(
  entity: ComplianceVendorEntity,
  options?: {
    readonly contractExpiringDaysBefore?: number;
    readonly reviewReminderDaysBefore?: number;
    readonly now?: Date;
  },
): ComplianceVendorView {
  const now = options?.now ?? new Date();
  const contractWindow = options?.contractExpiringDaysBefore ?? 45;
  const reviewWindow = options?.reviewReminderDaysBefore ?? 30;

  return {
    id: Number(entity.id),
    vendorCode: entity.vendorCode,
    name: entity.name,
    category: entity.category,
    criticality: entity.criticality,
    status: entity.status,
    providerEntryId:
      entity.providerEntryId !== null && entity.providerEntryId !== undefined
        ? Number(entity.providerEntryId)
        : null,
    websiteUrl: entity.websiteUrl,
    contactEmail: entity.contactEmail,
    ownerUserId:
      entity.ownerUserId !== null && entity.ownerUserId !== undefined
        ? Number(entity.ownerUserId)
        : null,
    organizationUnitId:
      entity.organizationUnitId !== null && entity.organizationUnitId !== undefined
        ? Number(entity.organizationUnitId)
        : null,
    contractStartDate: entity.contractStartDate ? entity.contractStartDate.toISOString() : null,
    contractEndDate: entity.contractEndDate ? entity.contractEndDate.toISOString() : null,
    contractDueStatus: classifyDueStatus(entity.contractEndDate, contractWindow, now),
    daysUntilContractEnd: computeDaysUntil(entity.contractEndDate, now),
    autoRenew: Boolean(entity.autoRenew),
    reviewFrequency: entity.reviewFrequency,
    lastReviewedAt: entity.lastReviewedAt ? entity.lastReviewedAt.toISOString() : null,
    nextReviewDueAt: entity.nextReviewDueAt ? entity.nextReviewDueAt.toISOString() : null,
    reviewDueStatus: classifyDueStatus(entity.nextReviewDueAt, reviewWindow, now),
    daysUntilReviewDue: computeDaysUntil(entity.nextReviewDueAt, now),
    dpaSigned: Boolean(entity.dpaSigned),
    dpaFileId:
      entity.dpaFileId !== null && entity.dpaFileId !== undefined ? Number(entity.dpaFileId) : null,
    fallbackVendorName: entity.fallbackVendorName,
    fallbackStrategy: entity.fallbackStrategy,
    migrationRunbook: entity.migrationRunbook,
    rtoHours:
      entity.rtoHours !== null && entity.rtoHours !== undefined ? Number(entity.rtoHours) : null,
    exitPlanTestedAt: entity.exitPlanTestedAt ? entity.exitPlanTestedAt.toISOString() : null,
    hasFallbackPlan: hasVendorFallbackPlan(entity),
    metadata: parseJsonObjectOrNull(entity.metadataJson),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function mapDataAssessmentToView(
  entity: ComplianceVendorDataAssessmentEntity,
  vendor?: ComplianceVendorEntity | null,
): VendorDataAssessmentView {
  return {
    id: Number(entity.id),
    vendorId: Number(entity.vendorId),
    vendorName: vendor?.name ?? null,
    dataCategory: entity.dataCategory,
    classificationLevel: entity.classificationLevel,
    allowedDataFields: parseJsonStringList(entity.allowedDataFieldsJson),
    prohibitedDataFields: parseJsonStringList(entity.prohibitedDataFieldsJson),
    processingPurpose: entity.processingPurpose,
    dataFlowDirection: entity.dataFlowDirection,
    storageRegions: parseJsonStringList(entity.storageRegionsJson),
    crossBorderTransfer: Boolean(entity.crossBorderTransfer),
    transferMechanism: entity.transferMechanism,
    retentionDays:
      entity.retentionDays !== null && entity.retentionDays !== undefined
        ? Number(entity.retentionDays)
        : null,
    encryptionInTransit: Boolean(entity.encryptionInTransit),
    encryptionAtRest: Boolean(entity.encryptionAtRest),
    subprocessors: parseJsonStringList(entity.subprocessorsJson),
    riskLevel: entity.riskLevel,
    approvalStatus: entity.approvalStatus,
    reviewedByUserId:
      entity.reviewedByUserId !== null && entity.reviewedByUserId !== undefined
        ? Number(entity.reviewedByUserId)
        : null,
    reviewedAt: entity.reviewedAt ? entity.reviewedAt.toISOString() : null,
    nextReviewDueAt: entity.nextReviewDueAt ? entity.nextReviewDueAt.toISOString() : null,
    notes: entity.notes,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
