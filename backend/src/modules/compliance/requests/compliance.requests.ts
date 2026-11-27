import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';
import { DATA_CLASSIFICATION_LEVEL } from '@packages/kernel/index.js';
import {
  ASSESSMENT_APPROVAL_STATUS,
  COMPLIANCE_RISK_LEVEL,
  CONTROL_CHECK_RESULT,
  CONTROL_FREQUENCY,
  CONTROL_STATUS,
  DATA_FLOW_DIRECTION,
  EVIDENCE_STATUS,
  EVIDENCE_TYPE,
  VENDOR_CATEGORY,
  VENDOR_STATUS,
} from '../enum/compliance.enum.js';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const tokenParamSchema = z.object({
  token: z.string().trim().min(8).max(200),
});

const controlFrequencySchema = z.enum([
  CONTROL_FREQUENCY.DAILY,
  CONTROL_FREQUENCY.WEEKLY,
  CONTROL_FREQUENCY.MONTHLY,
  CONTROL_FREQUENCY.QUARTERLY,
  CONTROL_FREQUENCY.SEMI_ANNUAL,
  CONTROL_FREQUENCY.ANNUAL,
  CONTROL_FREQUENCY.AD_HOC,
]);

const controlStatusSchema = z.enum([
  CONTROL_STATUS.DRAFT,
  CONTROL_STATUS.ACTIVE,
  CONTROL_STATUS.RETIRED,
]);

const checkResultSchema = z.enum([
  CONTROL_CHECK_RESULT.PASS,
  CONTROL_CHECK_RESULT.PARTIAL,
  CONTROL_CHECK_RESULT.FAIL,
  CONTROL_CHECK_RESULT.NOT_APPLICABLE,
]);

const evidenceTypeSchema = z.enum([
  EVIDENCE_TYPE.FILE,
  EVIDENCE_TYPE.LOG,
  EVIDENCE_TYPE.REPORT,
  EVIDENCE_TYPE.LINK,
]);

const evidenceStatusSchema = z.enum([
  EVIDENCE_STATUS.VALID,
  EVIDENCE_STATUS.EXPIRED,
  EVIDENCE_STATUS.REVOKED,
]);

const vendorCategorySchema = z.enum([
  VENDOR_CATEGORY.EMAIL,
  VENDOR_CATEGORY.SMS,
  VENDOR_CATEGORY.CLOUD,
  VENDOR_CATEGORY.PAYMENT,
  VENDOR_CATEGORY.AI,
  VENDOR_CATEGORY.OTHER,
]);

const vendorStatusSchema = z.enum([
  VENDOR_STATUS.ACTIVE,
  VENDOR_STATUS.UNDER_REVIEW,
  VENDOR_STATUS.SUSPENDED,
  VENDOR_STATUS.OFFBOARDED,
]);

const riskLevelSchema = z.enum([
  COMPLIANCE_RISK_LEVEL.LOW,
  COMPLIANCE_RISK_LEVEL.MEDIUM,
  COMPLIANCE_RISK_LEVEL.HIGH,
  COMPLIANCE_RISK_LEVEL.CRITICAL,
]);

const classificationLevelSchema = z.enum([
  DATA_CLASSIFICATION_LEVEL.PUBLIC,
  DATA_CLASSIFICATION_LEVEL.INTERNAL,
  DATA_CLASSIFICATION_LEVEL.CONFIDENTIAL,
  DATA_CLASSIFICATION_LEVEL.RESTRICTED,
]);

const dataFlowDirectionSchema = z.enum([
  DATA_FLOW_DIRECTION.OUTBOUND,
  DATA_FLOW_DIRECTION.INBOUND,
  DATA_FLOW_DIRECTION.BIDIRECTIONAL,
]);

const approvalStatusSchema = z.enum([
  ASSESSMENT_APPROVAL_STATUS.PENDING,
  ASSESSMENT_APPROVAL_STATUS.APPROVED,
  ASSESSMENT_APPROVAL_STATUS.CONDITIONAL,
  ASSESSMENT_APPROVAL_STATUS.REJECTED,
]);

export const ListControlsQuerySchema = z.object({
  domain: optionalQueryParam(z.string().trim().max(64)),
  frameworkTag: optionalQueryParam(z.string().trim().max(80)),
  status: optionalQueryParam(controlStatusSchema),
  frequency: optionalQueryParam(controlFrequencySchema),
  ownerUserId: optionalQueryParam(intQueryParam({ min: 1 })),
  organizationUnitId: optionalQueryParam(intQueryParam({ min: 1 })),
  overdueOnly: optionalQueryParam(booleanQueryParam()),
  q: optionalQueryParam(z.string().trim().max(120)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListControlsQuery = z.infer<typeof ListControlsQuerySchema>;

export const CreateControlRequestSchema = z.object({
  controlCode: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9._-]+$/i)
    .optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  domain: z.string().trim().min(2).max(64).default('GENERAL'),
  frameworkTags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
  frequency: controlFrequencySchema.default(CONTROL_FREQUENCY.QUARTERLY),
  status: controlStatusSchema.default(CONTROL_STATUS.ACTIVE),
  nextCheckDueAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CreateControlRequest = z.infer<typeof CreateControlRequestSchema>;

export const UpdateControlRequestSchema = CreateControlRequestSchema.partial();
export type UpdateControlRequest = z.infer<typeof UpdateControlRequestSchema>;

export const ListCheckHistoriesQuerySchema = z.object({
  controlId: optionalQueryParam(intQueryParam({ min: 1 })),
  checkedByUserId: optionalQueryParam(intQueryParam({ min: 1 })),
  result: optionalQueryParam(checkResultSchema),
  fromDate: optionalQueryParam(z.string().trim().max(40)),
  toDate: optionalQueryParam(z.string().trim().max(40)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListCheckHistoriesQuery = z.infer<typeof ListCheckHistoriesQuerySchema>;

export const RecordControlCheckRequestSchema = z.object({
  checkedAt: z.string().datetime().optional(),
  result: checkResultSchema,
  score: z.coerce.number().int().min(0).max(100).nullable().optional(),
  findings: z.string().trim().max(4000).nullable().optional(),
  remediationPlan: z.string().trim().max(4000).nullable().optional(),
  remediationDueAt: z.string().datetime().nullable().optional(),
  nextCheckDueAt: z.string().datetime().nullable().optional(),
  evidenceIds: z.array(z.coerce.number().int().positive()).max(50).default([]),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type RecordControlCheckRequest = z.infer<typeof RecordControlCheckRequestSchema>;

export const ListEvidencesQuerySchema = z.object({
  controlId: optionalQueryParam(intQueryParam({ min: 1 })),
  vendorId: optionalQueryParam(intQueryParam({ min: 1 })),
  checkHistoryId: optionalQueryParam(intQueryParam({ min: 1 })),
  evidenceType: optionalQueryParam(evidenceTypeSchema),
  status: optionalQueryParam(evidenceStatusSchema),
  q: optionalQueryParam(z.string().trim().max(120)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListEvidencesQuery = z.infer<typeof ListEvidencesQuerySchema>;

export const CreateEvidenceRequestSchema = z.object({
  controlId: z.coerce.number().int().positive(),
  checkHistoryId: z.coerce.number().int().positive().nullable().optional(),
  vendorId: z.coerce.number().int().positive().nullable().optional(),
  evidenceType: evidenceTypeSchema,
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  fileId: z.coerce.number().int().positive().nullable().optional(),
  auditLogId: z.coerce.number().int().positive().nullable().optional(),
  logReference: z.string().trim().max(255).nullable().optional(),
  reportHistoryId: z.coerce.number().int().positive().nullable().optional(),
  reportCode: z.string().trim().max(128).nullable().optional(),
  externalUrl: z.string().trim().url().max(500).nullable().optional(),
  checksumSha256: z.string().trim().max(128).nullable().optional(),
  collectedAt: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CreateEvidenceRequest = z.infer<typeof CreateEvidenceRequestSchema>;

export const ListVendorsQuerySchema = z.object({
  category: optionalQueryParam(vendorCategorySchema),
  criticality: optionalQueryParam(riskLevelSchema),
  status: optionalQueryParam(vendorStatusSchema),
  missingFallbackOnly: optionalQueryParam(booleanQueryParam()),
  expiringContractOnly: optionalQueryParam(booleanQueryParam()),
  q: optionalQueryParam(z.string().trim().max(120)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListVendorsQuery = z.infer<typeof ListVendorsQuerySchema>;

export const CreateVendorRequestSchema = z.object({
  vendorCode: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9._-]+$/i)
    .optional(),
  name: z.string().trim().min(2).max(160),
  category: vendorCategorySchema,
  criticality: riskLevelSchema.default(COMPLIANCE_RISK_LEVEL.MEDIUM),
  status: vendorStatusSchema.default(VENDOR_STATUS.ACTIVE),
  providerEntryId: z.coerce.number().int().positive().nullable().optional(),
  websiteUrl: z.string().trim().url().max(255).nullable().optional(),
  contactEmail: z.string().trim().email().max(160).nullable().optional(),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
  contractStartDate: z.string().datetime().nullable().optional(),
  contractEndDate: z.string().datetime().nullable().optional(),
  autoRenew: z.boolean().default(false),
  reviewFrequency: controlFrequencySchema.default(CONTROL_FREQUENCY.SEMI_ANNUAL),
  lastReviewedAt: z.string().datetime().nullable().optional(),
  nextReviewDueAt: z.string().datetime().nullable().optional(),
  dpaSigned: z.boolean().default(false),
  dpaFileId: z.coerce.number().int().positive().nullable().optional(),
  fallbackVendorName: z.string().trim().max(160).nullable().optional(),
  fallbackStrategy: z.string().trim().max(3000).nullable().optional(),
  migrationRunbook: z.string().trim().max(4000).nullable().optional(),
  rtoHours: z.coerce.number().int().min(0).max(8760).nullable().optional(),
  exitPlanTestedAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CreateVendorRequest = z.infer<typeof CreateVendorRequestSchema>;

export const UpdateVendorRequestSchema = CreateVendorRequestSchema.partial();
export type UpdateVendorRequest = z.infer<typeof UpdateVendorRequestSchema>;

export const CreateVendorDataAssessmentRequestSchema = z.object({
  dataCategory: z.string().trim().min(2).max(120),
  classificationLevel: classificationLevelSchema.default(DATA_CLASSIFICATION_LEVEL.INTERNAL),
  allowedDataFields: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  prohibitedDataFields: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  processingPurpose: z.string().trim().min(2).max(500),
  dataFlowDirection: dataFlowDirectionSchema.default(DATA_FLOW_DIRECTION.OUTBOUND),
  storageRegions: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
  crossBorderTransfer: z.boolean().default(false),
  transferMechanism: z.string().trim().max(160).nullable().optional(),
  retentionDays: z.coerce.number().int().min(0).max(36500).nullable().optional(),
  encryptionInTransit: z.boolean().default(true),
  encryptionAtRest: z.boolean().default(true),
  subprocessors: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  riskLevel: riskLevelSchema.default(COMPLIANCE_RISK_LEVEL.MEDIUM),
  approvalStatus: approvalStatusSchema.default(ASSESSMENT_APPROVAL_STATUS.PENDING),
  nextReviewDueAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type CreateVendorDataAssessmentRequest = z.infer<
  typeof CreateVendorDataAssessmentRequestSchema
>;

export const UpdateVendorDataAssessmentRequestSchema =
  CreateVendorDataAssessmentRequestSchema.partial();
export type UpdateVendorDataAssessmentRequest = z.infer<
  typeof UpdateVendorDataAssessmentRequestSchema
>;

export const RunReviewSweepRequestSchema = z.object({
  dryRun: z.boolean().default(false),
});
export type RunReviewSweepRequest = z.infer<typeof RunReviewSweepRequestSchema>;

export const ComplianceReportQuerySchema = z.object({
  frameworkTag: optionalQueryParam(z.string().trim().max(80)),
  domain: optionalQueryParam(z.string().trim().max(64)),
  vendorCategory: optionalQueryParam(vendorCategorySchema),
  organizationUnitId: optionalQueryParam(intQueryParam({ min: 1 })),
  fromDate: optionalQueryParam(z.string().trim().max(40)),
  toDate: optionalQueryParam(z.string().trim().max(40)),
  includeControls: optionalQueryParam(booleanQueryParam()),
  includeVendors: optionalQueryParam(booleanQueryParam()),
});
export type ComplianceReportQuery = z.infer<typeof ComplianceReportQuerySchema>;

export const GenerateComplianceReportRequestSchema = z.object({
  frameworkTag: z.string().trim().max(80).nullable().optional(),
  domain: z.string().trim().max(64).nullable().optional(),
  vendorCategory: vendorCategorySchema.nullable().optional(),
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
  fromDate: z.string().trim().max(40).nullable().optional(),
  toDate: z.string().trim().max(40).nullable().optional(),
  includeControls: z.boolean().default(true),
  includeVendors: z.boolean().default(true),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
  ttlSeconds: z.coerce.number().int().min(60).max(86400).optional(),
});
export type GenerateComplianceReportRequest = z.infer<typeof GenerateComplianceReportRequestSchema>;
