import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  CONSENT_STATUS,
  DATA_CLASSIFICATION_LEVEL,
  DSAR_EXPORT_FORMAT,
  DSAR_REQUEST_TYPE,
  LEGAL_HOLD_SCOPE_TYPE,
  RETENTION_ACTION,
  SENSITIVE_FIELD_MASK_STRATEGY,
} from '../enum/data-governance.enum.js';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const tokenParamSchema = z.object({
  token: z.string().trim().min(8).max(200),
});

const classificationLevelSchema = z.enum([
  DATA_CLASSIFICATION_LEVEL.PUBLIC,
  DATA_CLASSIFICATION_LEVEL.INTERNAL,
  DATA_CLASSIFICATION_LEVEL.CONFIDENTIAL,
  DATA_CLASSIFICATION_LEVEL.RESTRICTED,
]);

const retentionActionSchema = z.enum([
  RETENTION_ACTION.PURGE,
  RETENTION_ACTION.ANONYMIZE,
  RETENTION_ACTION.ARCHIVE,
  RETENTION_ACTION.RETAIN_LEGAL,
]);

const maskStrategySchema = z.enum([
  SENSITIVE_FIELD_MASK_STRATEGY.FULL,
  SENSITIVE_FIELD_MASK_STRATEGY.PARTIAL,
  SENSITIVE_FIELD_MASK_STRATEGY.EMAIL,
  SENSITIVE_FIELD_MASK_STRATEGY.PHONE,
  SENSITIVE_FIELD_MASK_STRATEGY.HASH,
]);

export const ListDataClassificationsQuerySchema = z.object({
  classificationLevel: optionalQueryParam(classificationLevelSchema),
  moduleName: optionalQueryParam(z.string().trim().max(64)),
  isEnabled: optionalQueryParam(booleanQueryParam()),
  q: optionalQueryParam(z.string().trim().max(120)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListDataClassificationsQuery = z.infer<typeof ListDataClassificationsQuerySchema>;

export const UpsertDataClassificationRequestSchema = z.object({
  dataTypeCode: z
    .string()
    .trim()
    .min(2)
    .max(96)
    .regex(/^[a-z0-9._-]+$/i),
  displayName: z.string().trim().min(2).max(160),
  moduleName: z.string().trim().min(2).max(64),
  classificationLevel: classificationLevelSchema,
  containsPii: z.boolean().default(false),
  retentionDays: z.coerce.number().int().min(0).max(36500).default(365),
  retentionAction: retentionActionSchema.default(RETENTION_ACTION.PURGE),
  legalBasis: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isEnabled: z.boolean().default(true),
});
export type UpsertDataClassificationRequest = z.infer<typeof UpsertDataClassificationRequestSchema>;

export const UpdateDataClassificationRequestSchema =
  UpsertDataClassificationRequestSchema.partial();
export type UpdateDataClassificationRequest = z.infer<typeof UpdateDataClassificationRequestSchema>;

export const ListSensitiveFieldsQuerySchema = z.object({
  resourceType: optionalQueryParam(z.string().trim().max(96)),
  classificationLevel: optionalQueryParam(classificationLevelSchema),
  isEnabled: optionalQueryParam(booleanQueryParam()),
  q: optionalQueryParam(z.string().trim().max(120)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListSensitiveFieldsQuery = z.infer<typeof ListSensitiveFieldsQuerySchema>;

export const UpsertSensitiveFieldRequestSchema = z.object({
  resourceType: z.string().trim().min(1).max(96),
  fieldPath: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(2).max(160),
  classificationLevel: classificationLevelSchema.default(DATA_CLASSIFICATION_LEVEL.CONFIDENTIAL),
  maskStrategy: maskStrategySchema.default(SENSITIVE_FIELD_MASK_STRATEGY.FULL),
  redactInLog: z.boolean().default(true),
  maskInExport: z.boolean().default(true),
  requiredPermission: z.string().trim().max(128).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isEnabled: z.boolean().default(true),
});
export type UpsertSensitiveFieldRequest = z.infer<typeof UpsertSensitiveFieldRequestSchema>;

export const UpdateSensitiveFieldRequestSchema = UpsertSensitiveFieldRequestSchema.partial();
export type UpdateSensitiveFieldRequest = z.infer<typeof UpdateSensitiveFieldRequestSchema>;

export const EvaluateSensitivePayloadRequestSchema = z.object({
  resourceType: z.string().trim().min(1).max(96),
  context: z.enum(['read', 'export']).default('read'),
  payload: z.record(z.string(), z.unknown()),
});
export type EvaluateSensitivePayloadRequest = z.infer<typeof EvaluateSensitivePayloadRequestSchema>;

export const RunRetentionSweepRequestSchema = z.object({
  dataTypeCode: z.string().trim().max(96).optional(),
  dryRun: z.boolean().default(false),
});
export type RunRetentionSweepRequest = z.infer<typeof RunRetentionSweepRequestSchema>;

export const ListDsarRequestsQuerySchema = z.object({
  requestType: optionalQueryParam(
    z.enum([DSAR_REQUEST_TYPE.ACCESS, DSAR_REQUEST_TYPE.ERASURE, DSAR_REQUEST_TYPE.EXPORT]),
  ),
  subjectUserId: optionalQueryParam(intQueryParam({ min: 1 })),
  status: optionalQueryParam(intQueryParam({ min: 1, max: 8 })),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 100 })),
});
export type ListDsarRequestsQuery = z.infer<typeof ListDsarRequestsQuerySchema>;

export const CreateDsarRequestSchema = z.object({
  requestType: z.enum([
    DSAR_REQUEST_TYPE.ACCESS,
    DSAR_REQUEST_TYPE.ERASURE,
    DSAR_REQUEST_TYPE.EXPORT,
  ]),
  subjectUserId: z.coerce.number().int().positive().optional(),
  exportFormat: z.enum([DSAR_EXPORT_FORMAT.JSON, DSAR_EXPORT_FORMAT.CSV]).optional(),
  reason: z.string().trim().max(1000).nullable().optional(),
  excludedDataTypeCodes: z.array(z.string().trim().min(1).max(96)).max(50).optional(),
});
export type CreateDsarRequest = z.infer<typeof CreateDsarRequestSchema>;

export const ApproveDsarRequestSchema = z.object({
  comment: z.string().trim().max(500).optional(),
  excludedDataTypeCodes: z.array(z.string().trim().min(1).max(96)).max(50).optional(),
  customExceptions: z
    .array(
      z.object({
        moduleName: z.string().trim().min(1).max(64),
        dataTypeCode: z.string().trim().min(1).max(96),
        reasonCode: z.string().trim().min(1).max(64).default('LEGAL_EXCEPTION'),
        reason: z.string().trim().min(2).max(500),
        retainedCount: z.coerce.number().int().min(0).default(1),
      }),
    )
    .max(30)
    .optional(),
});
export type ApproveDsarRequest = z.infer<typeof ApproveDsarRequestSchema>;

export const RejectDsarRequestSchema = z.object({
  comment: z.string().trim().min(3).max(500),
});
export type RejectDsarRequest = z.infer<typeof RejectDsarRequestSchema>;

export const ListConsentDefinitionsQuerySchema = z.object({
  purposeCode: optionalQueryParam(z.string().trim().max(64)),
  isActive: optionalQueryParam(booleanQueryParam()),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListConsentDefinitionsQuery = z.infer<typeof ListConsentDefinitionsQuerySchema>;

export const UpsertConsentDefinitionRequestSchema = z.object({
  purposeCode: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9._-]+$/i),
  policyVersion: z.string().trim().min(1).max(32),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(2).max(1000),
  classificationLevel: classificationLevelSchema.default(DATA_CLASSIFICATION_LEVEL.INTERNAL),
  isMandatory: z.boolean().default(false),
  validityDays: z.coerce.number().int().min(1).max(36500).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type UpsertConsentDefinitionRequest = z.infer<typeof UpsertConsentDefinitionRequestSchema>;

export const ListUserConsentsQuerySchema = z.object({
  userId: optionalQueryParam(intQueryParam({ min: 1 })),
  purposeCode: optionalQueryParam(z.string().trim().max(64)),
  consentStatus: optionalQueryParam(
    z.enum([CONSENT_STATUS.GRANTED, CONSENT_STATUS.WITHDRAWN, CONSENT_STATUS.EXPIRED]),
  ),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListUserConsentsQuery = z.infer<typeof ListUserConsentsQuerySchema>;

export const GrantConsentRequestSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  purposeCode: z.string().trim().min(2).max(64),
  policyVersion: z.string().trim().min(1).max(32).optional(),
  collectionSource: z.string().trim().min(2).max(64).default('PORTAL'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type GrantConsentRequest = z.infer<typeof GrantConsentRequestSchema>;

export const WithdrawConsentRequestSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  purposeCode: z.string().trim().min(2).max(64),
  reason: z.string().trim().max(500).optional(),
});
export type WithdrawConsentRequest = z.infer<typeof WithdrawConsentRequestSchema>;

export const ListLegalHoldsQuerySchema = z.object({
  scopeType: optionalQueryParam(
    z.enum([
      LEGAL_HOLD_SCOPE_TYPE.USER,
      LEGAL_HOLD_SCOPE_TYPE.DATA_TYPE,
      LEGAL_HOLD_SCOPE_TYPE.RESOURCE,
    ]),
  ),
  targetUserId: optionalQueryParam(intQueryParam({ min: 1 })),
  holdStatus: optionalQueryParam(intQueryParam({ min: 1, max: 3 })),
  q: optionalQueryParam(z.string().trim().max(120)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 100 })),
});
export type ListLegalHoldsQuery = z.infer<typeof ListLegalHoldsQuerySchema>;

export const CreateLegalHoldRequestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  caseReference: z.string().trim().max(120).nullable().optional(),
  reason: z.string().trim().min(3).max(1000),
  scopeType: z.enum([
    LEGAL_HOLD_SCOPE_TYPE.USER,
    LEGAL_HOLD_SCOPE_TYPE.DATA_TYPE,
    LEGAL_HOLD_SCOPE_TYPE.RESOURCE,
  ]),
  targetUserId: z.coerce.number().int().positive().nullable().optional(),
  dataTypeCode: z.string().trim().max(96).nullable().optional(),
  resourceType: z.string().trim().max(96).nullable().optional(),
  resourceId: z.string().trim().max(128).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type CreateLegalHoldRequest = z.infer<typeof CreateLegalHoldRequestSchema>;

export const ReleaseLegalHoldRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type ReleaseLegalHoldRequest = z.infer<typeof ReleaseLegalHoldRequestSchema>;

export const CheckLegalHoldQuerySchema = z.object({
  userId: optionalQueryParam(intQueryParam({ min: 1 })),
  dataTypeCode: optionalQueryParam(z.string().trim().max(96)),
  resourceType: optionalQueryParam(z.string().trim().max(96)),
  resourceId: optionalQueryParam(z.string().trim().max(128)),
});
export type CheckLegalHoldQuery = z.infer<typeof CheckLegalHoldQuerySchema>;
