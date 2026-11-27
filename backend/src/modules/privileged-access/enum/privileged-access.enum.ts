export const PRIVILEGED_TARGET_TYPE = {
  ROLE: 'ROLE',
  PERMISSION: 'PERMISSION',
} as const;

export type PrivilegedTargetType =
  (typeof PRIVILEGED_TARGET_TYPE)[keyof typeof PRIVILEGED_TARGET_TYPE];

export const PRIVILEGED_SENSITIVITY_LEVEL = {
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type PrivilegedSensitivityLevel =
  (typeof PRIVILEGED_SENSITIVITY_LEVEL)[keyof typeof PRIVILEGED_SENSITIVITY_LEVEL];

export const PRIVILEGED_GRANT_STATUS = {
  PENDING_APPROVAL: 1,
  ACTIVE: 2,
  REJECTED: 3,
  EXPIRED: 4,
  REVOKED: 5,
  CANCELLED: 6,
} as const;

export type PrivilegedGrantStatusCode =
  (typeof PRIVILEGED_GRANT_STATUS)[keyof typeof PRIVILEGED_GRANT_STATUS];
export type PrivilegedGrantStatusName = keyof typeof PRIVILEGED_GRANT_STATUS;

export const BREAK_GLASS_STATUS = {
  SEALED: 1,
  ACTIVE: 2,
  LOCKED: 3,
  REVOKED: 4,
} as const;

export type BreakGlassStatusCode = (typeof BREAK_GLASS_STATUS)[keyof typeof BREAK_GLASS_STATUS];
export type BreakGlassStatusName = keyof typeof BREAK_GLASS_STATUS;

export const ACCESS_REVIEW_STATUS = {
  OPEN: 1,
  COMPLETED: 2,
  CANCELLED: 3,
} as const;

export type AccessReviewStatusCode =
  (typeof ACCESS_REVIEW_STATUS)[keyof typeof ACCESS_REVIEW_STATUS];
export type AccessReviewStatusName = keyof typeof ACCESS_REVIEW_STATUS;

export const ACCESS_REVIEW_DECISION = {
  PENDING: 1,
  KEEP: 2,
  REVOKE: 3,
} as const;

export type AccessReviewDecisionCode =
  (typeof ACCESS_REVIEW_DECISION)[keyof typeof ACCESS_REVIEW_DECISION];
export type AccessReviewDecisionName = keyof typeof ACCESS_REVIEW_DECISION;

export const PRIVILEGED_REVIEW_SOURCE = {
  STANDING_ROLE: 'STANDING_ROLE',
  TEMPORARY_GRANT: 'TEMPORARY_GRANT',
  BREAK_GLASS: 'BREAK_GLASS',
} as const;

export type PrivilegedReviewSource =
  (typeof PRIVILEGED_REVIEW_SOURCE)[keyof typeof PRIVILEGED_REVIEW_SOURCE];

export const PRIVILEGED_ALERT_EVENT_TYPE = {
  TARGET_UPDATED: 'TARGET_UPDATED',
  PRIVILEGED_ACTION_USED: 'PRIVILEGED_ACTION_USED',
  STEP_UP_MFA_BLOCKED: 'STEP_UP_MFA_BLOCKED',
  GRANT_REQUESTED: 'GRANT_REQUESTED',
  GRANT_APPROVED: 'GRANT_APPROVED',
  GRANT_REJECTED: 'GRANT_REJECTED',
  GRANT_REVOKED: 'GRANT_REVOKED',
  GRANT_EXPIRED: 'GRANT_EXPIRED',
  BREAK_GLASS_CREATED: 'BREAK_GLASS_CREATED',
  BREAK_GLASS_ACTIVATED: 'BREAK_GLASS_ACTIVATED',
  BREAK_GLASS_LOGIN: 'BREAK_GLASS_LOGIN',
  BREAK_GLASS_SEALED: 'BREAK_GLASS_SEALED',
  BREAK_GLASS_AUTO_SEALED: 'BREAK_GLASS_AUTO_SEALED',
  REVIEW_CREATED: 'REVIEW_CREATED',
  REVIEW_ITEM_REVOKED: 'REVIEW_ITEM_REVOKED',
} as const;

export type PrivilegedAlertEventType =
  (typeof PRIVILEGED_ALERT_EVENT_TYPE)[keyof typeof PRIVILEGED_ALERT_EVENT_TYPE];

export const PRIVILEGED_SETTING_KEYS = {
  ENFORCE_STEP_UP_MFA: 'privileged_access.enforce_step_up_mfa',
  REQUIRE_APPROVAL_DEFAULT: 'privileged_access.require_approval_default',
  MAX_GRANT_DURATION_MINUTES: 'privileged_access.max_grant_duration_minutes',
  BREAK_GLASS_MAX_MINUTES: 'privileged_access.break_glass_max_minutes',
  ALERT_ROLE_CODES: 'privileged_access.alert_role_codes',
  ALERT_COOLDOWN_SECONDS: 'privileged_access.alert_cooldown_seconds',
  ALERT_CREATE_INCIDENT_FOR_CRITICAL: 'privileged_access.alert_create_incident_for_critical',
  REVIEW_CYCLE_DAYS: 'privileged_access.review_cycle_days',
  REVIEW_DUE_DAYS: 'privileged_access.review_due_days',
  REVOKE_SESSIONS_ON_GRANT_EXPIRY: 'privileged_access.revoke_sessions_on_grant_expiry',
} as const;

export const PRIVILEGED_FEATURE_FLAGS = {
  ENABLED: 'privileged_access.enabled',
  BREAK_GLASS_ENABLED: 'privileged_access.break_glass.enabled',
  PERIODIC_REVIEW_ENABLED: 'privileged_access.periodic_review.enabled',
} as const;

export const PRIVILEGED_DEFAULTS = {
  ENFORCE_STEP_UP_MFA: true,
  REQUIRE_APPROVAL_DEFAULT: true,
  MAX_GRANT_DURATION_MINUTES: 240,
  BREAK_GLASS_MAX_MINUTES: 60,
  ALERT_ROLE_CODES: ['admin_security', 'super_admin'] as readonly string[],
  ALERT_COOLDOWN_SECONDS: 60,
  ALERT_CREATE_INCIDENT_FOR_CRITICAL: true,
  REVIEW_CYCLE_DAYS: 90,
  REVIEW_DUE_DAYS: 14,
  REVOKE_SESSIONS_ON_GRANT_EXPIRY: false,
} as const;
