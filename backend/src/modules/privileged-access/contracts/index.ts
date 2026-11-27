import {
  ACCESS_REVIEW_DECISION,
  ACCESS_REVIEW_STATUS,
  type AccessReviewDecisionCode,
  type AccessReviewDecisionName,
  type AccessReviewStatusCode,
  type AccessReviewStatusName,
  BREAK_GLASS_STATUS,
  type BreakGlassStatusCode,
  type BreakGlassStatusName,
  PRIVILEGED_GRANT_STATUS,
  type PrivilegedGrantStatusCode,
  type PrivilegedGrantStatusName,
} from '../enum/privileged-access.enum.js';
import type {
  PrivilegedAccessOverviewView,
  PrivilegedExpirationSweepResult,
  PrivilegedReviewScheduleResult,
} from '../types/privileged-access.types.js';

export * from '../enum/privileged-access.enum.js';
export * from '../types/privileged-access.types.js';

export function getGrantStatusName(code: number): PrivilegedGrantStatusName {
  switch (Number(code)) {
    case PRIVILEGED_GRANT_STATUS.ACTIVE:
      return 'ACTIVE';
    case PRIVILEGED_GRANT_STATUS.REJECTED:
      return 'REJECTED';
    case PRIVILEGED_GRANT_STATUS.EXPIRED:
      return 'EXPIRED';
    case PRIVILEGED_GRANT_STATUS.REVOKED:
      return 'REVOKED';
    case PRIVILEGED_GRANT_STATUS.CANCELLED:
      return 'CANCELLED';
    case PRIVILEGED_GRANT_STATUS.PENDING_APPROVAL:
    default:
      return 'PENDING_APPROVAL';
  }
}

export function parseGrantStatusCode(value: unknown): PrivilegedGrantStatusCode | undefined {
  if (typeof value === 'number' && value >= 1 && value <= 6) {
    return value as PrivilegedGrantStatusCode;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (trimmed in PRIVILEGED_GRANT_STATUS) {
      return PRIVILEGED_GRANT_STATUS[trimmed as PrivilegedGrantStatusName];
    }
    const num = Number(trimmed);
    if (Number.isInteger(num) && num >= 1 && num <= 6) {
      return num as PrivilegedGrantStatusCode;
    }
  }
  return undefined;
}

export function getBreakGlassStatusName(code: number): BreakGlassStatusName {
  switch (Number(code)) {
    case BREAK_GLASS_STATUS.ACTIVE:
      return 'ACTIVE';
    case BREAK_GLASS_STATUS.LOCKED:
      return 'LOCKED';
    case BREAK_GLASS_STATUS.REVOKED:
      return 'REVOKED';
    case BREAK_GLASS_STATUS.SEALED:
    default:
      return 'SEALED';
  }
}

export function getAccessReviewStatusName(code: number): AccessReviewStatusName {
  switch (Number(code)) {
    case ACCESS_REVIEW_STATUS.COMPLETED:
      return 'COMPLETED';
    case ACCESS_REVIEW_STATUS.CANCELLED:
      return 'CANCELLED';
    case ACCESS_REVIEW_STATUS.OPEN:
    default:
      return 'OPEN';
  }
}

export function getAccessReviewDecisionName(code: number): AccessReviewDecisionName {
  switch (Number(code)) {
    case ACCESS_REVIEW_DECISION.KEEP:
      return 'KEEP';
    case ACCESS_REVIEW_DECISION.REVOKE:
      return 'REVOKE';
    case ACCESS_REVIEW_DECISION.PENDING:
    default:
      return 'PENDING';
  }
}

export type {
  PrivilegedGrantStatusCode,
  BreakGlassStatusCode,
  AccessReviewStatusCode,
  AccessReviewDecisionCode,
};

export interface IPrivilegedAccessPublicService {
  getOverview(): Promise<PrivilegedAccessOverviewView>;
  sweepExpiredAccess(now?: Date): Promise<PrivilegedExpirationSweepResult>;
  runScheduledReviewCheck(now?: Date): Promise<PrivilegedReviewScheduleResult>;
}

export const PRIVILEGED_ACCESS_PUBLIC_SERVICE = Symbol('PRIVILEGED_ACCESS_PUBLIC_SERVICE');
