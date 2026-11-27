export const COMPLIANCE_PERMISSIONS = {
  READ: 'compliance.read',
  MANAGE: 'compliance.manage',
  CHECK: 'compliance.check',
  VENDOR_MANAGE: 'compliance.vendor.manage',
  REPORT: 'compliance.report',
} as const;

export const COMPLIANCE_FEATURE_FLAGS = {
  ENABLED: 'compliance.enabled',
  CONTROLS_ENABLED: 'compliance.controls.enabled',
  VENDORS_ENABLED: 'compliance.vendors.enabled',
  REPORTS_ENABLED: 'compliance.reports.enabled',
} as const;

export const COMPLIANCE_SETTING_KEYS = {
  REVIEW_REMINDER_DAYS_BEFORE: 'compliance.review.reminder_days_before',
  CONTRACT_EXPIRING_DAYS_BEFORE: 'compliance.contract.expiring_days_before',
  EVIDENCE_EXPIRING_DAYS_BEFORE: 'compliance.evidence.expiring_days_before',
  REPORT_FILE_TTL_SECONDS: 'compliance.report.file_ttl_seconds',
} as const;

export const COMPLIANCE_SEQUENCE_KEYS = {
  CONTROL_CODE: 'compliance.control_code',
  VENDOR_CODE: 'compliance.vendor_code',
} as const;

export const CONTROL_FREQUENCY = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  SEMI_ANNUAL: 'SEMI_ANNUAL',
  ANNUAL: 'ANNUAL',
  AD_HOC: 'AD_HOC',
} as const;

export type ControlFrequency = (typeof CONTROL_FREQUENCY)[keyof typeof CONTROL_FREQUENCY];

export const CONTROL_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  RETIRED: 'RETIRED',
} as const;

export type ControlStatus = (typeof CONTROL_STATUS)[keyof typeof CONTROL_STATUS];

export const CONTROL_CHECK_RESULT = {
  PASS: 'PASS',
  PARTIAL: 'PARTIAL',
  FAIL: 'FAIL',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;

export type ControlCheckResult = (typeof CONTROL_CHECK_RESULT)[keyof typeof CONTROL_CHECK_RESULT];

export const EVIDENCE_TYPE = {
  FILE: 'FILE',
  LOG: 'LOG',
  REPORT: 'REPORT',
  LINK: 'LINK',
} as const;

export type EvidenceType = (typeof EVIDENCE_TYPE)[keyof typeof EVIDENCE_TYPE];

export const EVIDENCE_STATUS = {
  VALID: 'VALID',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUS)[keyof typeof EVIDENCE_STATUS];

export const VENDOR_CATEGORY = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  CLOUD: 'CLOUD',
  PAYMENT: 'PAYMENT',
  AI: 'AI',
  OTHER: 'OTHER',
} as const;

export type VendorCategory = (typeof VENDOR_CATEGORY)[keyof typeof VENDOR_CATEGORY];

export const VENDOR_STATUS = {
  ACTIVE: 'ACTIVE',
  UNDER_REVIEW: 'UNDER_REVIEW',
  SUSPENDED: 'SUSPENDED',
  OFFBOARDED: 'OFFBOARDED',
} as const;

export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];

export const COMPLIANCE_RISK_LEVEL = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type ComplianceRiskLevel =
  (typeof COMPLIANCE_RISK_LEVEL)[keyof typeof COMPLIANCE_RISK_LEVEL];

export const DATA_FLOW_DIRECTION = {
  OUTBOUND: 'OUTBOUND',
  INBOUND: 'INBOUND',
  BIDIRECTIONAL: 'BIDIRECTIONAL',
} as const;

export type DataFlowDirection = (typeof DATA_FLOW_DIRECTION)[keyof typeof DATA_FLOW_DIRECTION];

export const ASSESSMENT_APPROVAL_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  CONDITIONAL: 'CONDITIONAL',
  REJECTED: 'REJECTED',
} as const;

export type AssessmentApprovalStatus =
  (typeof ASSESSMENT_APPROVAL_STATUS)[keyof typeof ASSESSMENT_APPROVAL_STATUS];

export const COMPLIANCE_DUE_STATUS = {
  OVERDUE: 'OVERDUE',
  DUE_SOON: 'DUE_SOON',
  ON_TRACK: 'ON_TRACK',
  UNSCHEDULED: 'UNSCHEDULED',
} as const;

export type ComplianceDueStatus =
  (typeof COMPLIANCE_DUE_STATUS)[keyof typeof COMPLIANCE_DUE_STATUS];
