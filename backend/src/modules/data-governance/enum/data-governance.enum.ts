import {
  DATA_CLASSIFICATION_LEVEL,
  type DataClassificationLevel,
  SENSITIVE_FIELD_MASK_STRATEGY,
  type SensitiveFieldMaskStrategy,
} from '@packages/kernel/index.js';

export {
  DATA_CLASSIFICATION_LEVEL,
  type DataClassificationLevel,
  SENSITIVE_FIELD_MASK_STRATEGY,
  type SensitiveFieldMaskStrategy,
};

export const CLASSIFICATION_LEVEL_ORDER: Readonly<Record<DataClassificationLevel, number>> = {
  PUBLIC: 1,
  INTERNAL: 2,
  CONFIDENTIAL: 3,
  RESTRICTED: 4,
} as const;

export const RETENTION_ACTION = {
  PURGE: 'PURGE',
  ANONYMIZE: 'ANONYMIZE',
  ARCHIVE: 'ARCHIVE',
  RETAIN_LEGAL: 'RETAIN_LEGAL',
} as const;

export type RetentionAction = (typeof RETENTION_ACTION)[keyof typeof RETENTION_ACTION];

export const DSAR_REQUEST_TYPE = {
  ACCESS: 'ACCESS',
  ERASURE: 'ERASURE',
  EXPORT: 'EXPORT',
} as const;

export type DsarRequestType = (typeof DSAR_REQUEST_TYPE)[keyof typeof DSAR_REQUEST_TYPE];

export const DSAR_EXPORT_FORMAT = {
  JSON: 'json',
  CSV: 'csv',
} as const;

export type DsarExportFormat = (typeof DSAR_EXPORT_FORMAT)[keyof typeof DSAR_EXPORT_FORMAT];

export const DSAR_STATUS = {
  PENDING: 1,
  PENDING_APPROVAL: 2,
  APPROVED: 3,
  COMPLETED: 4,
  PARTIALLY_COMPLETED: 5,
  REJECTED: 6,
  BLOCKED_LEGAL_HOLD: 7,
  CANCELLED: 8,
} as const;

export type DsarStatusCode = (typeof DSAR_STATUS)[keyof typeof DSAR_STATUS];
export type DsarStatusName = keyof typeof DSAR_STATUS;

export const DSAR_STATUS_NAMES: Readonly<Record<number, DsarStatusName>> = {
  1: 'PENDING',
  2: 'PENDING_APPROVAL',
  3: 'APPROVED',
  4: 'COMPLETED',
  5: 'PARTIALLY_COMPLETED',
  6: 'REJECTED',
  7: 'BLOCKED_LEGAL_HOLD',
  8: 'CANCELLED',
};

export const CONSENT_STATUS = {
  GRANTED: 'GRANTED',
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'EXPIRED',
} as const;

export type ConsentStatus = (typeof CONSENT_STATUS)[keyof typeof CONSENT_STATUS];

export const LEGAL_HOLD_SCOPE_TYPE = {
  USER: 'USER',
  DATA_TYPE: 'DATA_TYPE',
  RESOURCE: 'RESOURCE',
} as const;

export type LegalHoldScopeType = (typeof LEGAL_HOLD_SCOPE_TYPE)[keyof typeof LEGAL_HOLD_SCOPE_TYPE];

export const LEGAL_HOLD_STATUS = {
  ACTIVE: 1,
  RELEASED: 2,
  EXPIRED: 3,
} as const;

export type LegalHoldStatusCode = (typeof LEGAL_HOLD_STATUS)[keyof typeof LEGAL_HOLD_STATUS];
export type LegalHoldStatusName = keyof typeof LEGAL_HOLD_STATUS;

export const LEGAL_HOLD_STATUS_NAMES: Readonly<Record<number, LegalHoldStatusName>> = {
  1: 'ACTIVE',
  2: 'RELEASED',
  3: 'EXPIRED',
};

export const DATA_GOVERNANCE_PERMISSIONS = {
  READ: 'data-governance.read',
  MANAGE: 'data-governance.manage',
  SENSITIVE_READ: 'data-governance.sensitive.read',
  DSAR_REQUEST: 'data-governance.dsar.request',
  DSAR_APPROVE: 'data-governance.dsar.approve',
  CONSENT_MANAGE: 'data-governance.consent.manage',
  LEGAL_HOLD_MANAGE: 'data-governance.legal_hold.manage',
} as const;

export const DATA_GOVERNANCE_FEATURE_FLAGS = {
  ENABLED: 'data-governance.enabled',
  DSAR_ENABLED: 'data-governance.dsar.enabled',
  CONSENT_ENABLED: 'data-governance.consent.enabled',
  LEGAL_HOLD_ENABLED: 'data-governance.legal_hold.enabled',
} as const;

export const DATA_GOVERNANCE_SETTING_KEYS = {
  DSAR_SLA_DAYS: 'data-governance.dsar.sla_days',
  DSAR_EXPORT_TTL_MINUTES: 'data-governance.dsar.export_ttl_minutes',
  ERASURE_REQUIRE_APPROVAL: 'data-governance.dsar.erasure_require_approval',
  ALLOW_SELF_APPROVAL: 'data-governance.dsar.allow_self_approval',
  DEFAULT_RETENTION_DAYS: 'data-governance.retention.default_days',
} as const;

export const DATA_GOVERNANCE_SEQUENCES = {
  DSAR_CODE: 'data-governance.dsar_code',
  LEGAL_HOLD_CODE: 'data-governance.legal_hold_code',
} as const;

export const DATA_GOVERNANCE_CODE_TYPES = {
  CLASSIFICATION_LEVEL: 'data_governance.classification_level',
  DSAR_STATUS: 'data_governance.dsar_status',
  LEGAL_HOLD_STATUS: 'data_governance.legal_hold_status',
} as const;
