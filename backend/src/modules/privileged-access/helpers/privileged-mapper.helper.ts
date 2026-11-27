import { safeJsonParseObject, safeJsonParseStringArray } from '@packages/kernel/index.js';
import {
  getAccessReviewDecisionName,
  getAccessReviewStatusName,
  getBreakGlassStatusName,
  getGrantStatusName,
} from '../contracts/index.js';
import type { PrivilegedAccessGrantEntity } from '../entities/privileged-access-grant.entity.js';
import type { PrivilegedAccessReviewItemEntity } from '../entities/privileged-access-review-item.entity.js';
import type { PrivilegedAccessReviewEntity } from '../entities/privileged-access-review.entity.js';
import type { PrivilegedAccessTargetEntity } from '../entities/privileged-access-target.entity.js';
import type { PrivilegedBreakGlassAccountEntity } from '../entities/privileged-break-glass-account.entity.js';
import type { PrivilegedUsageAlertEntity } from '../entities/privileged-usage-alert.entity.js';
import type {
  BreakGlassAccountView,
  PrivilegedAccessReviewDetailView,
  PrivilegedAccessReviewItemView,
  PrivilegedAccessReviewView,
  PrivilegedGrantView,
  PrivilegedTargetView,
  PrivilegedUsageAlertView,
} from '../types/privileged-access.types.js';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export interface BasicUserSummaryLike {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly status?: number;
}

export function mapTargetEntityToView(entity: PrivilegedAccessTargetEntity): PrivilegedTargetView {
  return {
    id: Number(entity.id),
    targetType: entity.targetType,
    targetCode: entity.targetCode,
    displayName: entity.displayName,
    description: entity.description ?? null,
    sensitivityLevel: entity.sensitivityLevel,
    requireMfaStepUp: Boolean(entity.requireMfaStepUp),
    requireApproval: Boolean(entity.requireApproval),
    autoApproveAllowed: Boolean(entity.autoApproveAllowed),
    maxGrantMinutes: Number(entity.maxGrantMinutes),
    alertOnUse: Boolean(entity.alertOnUse),
    reviewIntervalDays: Number(entity.reviewIntervalDays),
    isEnabled: Boolean(entity.isEnabled),
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapGrantEntityToView(
  entity: PrivilegedAccessGrantEntity,
  user?: BasicUserSummaryLike | null,
): PrivilegedGrantView {
  const status = Number(entity.status) as PrivilegedGrantView['status'];
  return {
    id: Number(entity.id),
    grantCode: entity.grantCode,
    userId: Number(entity.userId),
    username: user?.username ?? null,
    email: user?.email ?? null,
    fullName: user?.fullName ?? null,
    targetType: entity.targetType,
    targetCode: entity.targetCode,
    roleId: entity.roleId !== null && entity.roleId !== undefined ? Number(entity.roleId) : null,
    reason: entity.reason,
    ticketRef: entity.ticketRef ?? null,
    durationMinutes: Number(entity.durationMinutes),
    status,
    statusName: getGrantStatusName(status),
    requiresApproval: Boolean(entity.requiresApproval),
    requestedBy: Number(entity.requestedBy),
    requestedAt: toIso(entity.requestedAt) ?? new Date().toISOString(),
    approvedBy:
      entity.approvedBy !== null && entity.approvedBy !== undefined
        ? Number(entity.approvedBy)
        : null,
    approvedAt: toIso(entity.approvedAt),
    approvalComment: entity.approvalComment ?? null,
    startsAt: toIso(entity.startsAt),
    expiresAt: toIso(entity.expiresAt),
    revokedBy:
      entity.revokedBy !== null && entity.revokedBy !== undefined ? Number(entity.revokedBy) : null,
    revokedAt: toIso(entity.revokedAt),
    revokeReason: entity.revokeReason ?? null,
    autoRevoked: Boolean(entity.autoRevoked),
    stepUpVerified: Boolean(entity.stepUpVerified),
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapBreakGlassEntityToView(
  entity: PrivilegedBreakGlassAccountEntity,
  user?: BasicUserSummaryLike | null,
): BreakGlassAccountView {
  const status = Number(entity.status) as BreakGlassAccountView['status'];
  return {
    id: Number(entity.id),
    code: entity.code,
    userId: Number(entity.userId),
    username: user?.username ?? null,
    email: user?.email ?? null,
    fullName: user?.fullName ?? null,
    userStatus: user?.status !== undefined ? Number(user.status) : null,
    label: entity.label,
    description: entity.description ?? null,
    roleCode: entity.roleCode,
    status,
    statusName: getBreakGlassStatusName(status),
    requireMfa: Boolean(entity.requireMfa),
    maxActivationMinutes: Number(entity.maxActivationMinutes),
    alertRecipients: safeJsonParseStringArray(entity.alertRecipientsJson),
    lastActivatedBy:
      entity.lastActivatedBy !== null && entity.lastActivatedBy !== undefined
        ? Number(entity.lastActivatedBy)
        : null,
    lastActivationReason: entity.lastActivationReason ?? null,
    lastTicketRef: entity.lastTicketRef ?? null,
    activatedAt: toIso(entity.activatedAt),
    expiresAt: toIso(entity.expiresAt),
    sealedBy:
      entity.sealedBy !== null && entity.sealedBy !== undefined ? Number(entity.sealedBy) : null,
    sealedAt: toIso(entity.sealedAt),
    sealReason: entity.sealReason ?? null,
    activationCount: Number(entity.activationCount),
    lastUsedAt: toIso(entity.lastUsedAt),
    lastUsedIp: entity.lastUsedIp ?? null,
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapAlertEntityToView(entity: PrivilegedUsageAlertEntity): PrivilegedUsageAlertView {
  const parsedDetails = entity.detailsJson ? safeJsonParseObject(entity.detailsJson) : null;
  return {
    id: Number(entity.id),
    eventType: entity.eventType,
    severity: entity.severity,
    actorUserId:
      entity.actorUserId !== null && entity.actorUserId !== undefined
        ? Number(entity.actorUserId)
        : null,
    actorUsername: entity.actorUsername ?? null,
    targetType: entity.targetType ?? null,
    targetCode: entity.targetCode ?? null,
    action: entity.action,
    endpoint: entity.endpoint ?? null,
    httpMethod: entity.httpMethod ?? null,
    ipAddress: entity.ipAddress ?? null,
    details: parsedDetails && Object.keys(parsedDetails).length > 0 ? parsedDetails : null,
    notifiedRecipients: safeJsonParseStringArray(entity.notifiedRecipientsJson),
    notificationDispatchId:
      entity.notificationDispatchId !== null && entity.notificationDispatchId !== undefined
        ? Number(entity.notificationDispatchId)
        : null,
    incidentId:
      entity.incidentId !== null && entity.incidentId !== undefined
        ? Number(entity.incidentId)
        : null,
    acknowledgedBy:
      entity.acknowledgedBy !== null && entity.acknowledgedBy !== undefined
        ? Number(entity.acknowledgedBy)
        : null,
    acknowledgedAt: toIso(entity.acknowledgedAt),
    acknowledgeNote: entity.acknowledgeNote ?? null,
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
  };
}

export function mapReviewItemEntityToView(
  entity: PrivilegedAccessReviewItemEntity,
): PrivilegedAccessReviewItemView {
  const decision = Number(entity.decision) as PrivilegedAccessReviewItemView['decision'];
  return {
    id: Number(entity.id),
    reviewId: Number(entity.reviewId),
    userId: Number(entity.userId),
    username: entity.username,
    email: entity.email ?? null,
    grantSource: entity.grantSource,
    targetType: entity.targetType,
    targetCode: entity.targetCode,
    roleId: entity.roleId !== null && entity.roleId !== undefined ? Number(entity.roleId) : null,
    grantId:
      entity.grantId !== null && entity.grantId !== undefined ? Number(entity.grantId) : null,
    breakGlassId:
      entity.breakGlassId !== null && entity.breakGlassId !== undefined
        ? Number(entity.breakGlassId)
        : null,
    decision,
    decisionName: getAccessReviewDecisionName(decision),
    decidedBy:
      entity.decidedBy !== null && entity.decidedBy !== undefined ? Number(entity.decidedBy) : null,
    decidedAt: toIso(entity.decidedAt),
    decisionNote: entity.decisionNote ?? null,
    enforcementApplied: Boolean(entity.enforcementApplied),
    enforcementError: entity.enforcementError ?? null,
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
  };
}

export function mapReviewEntityToView(
  entity: PrivilegedAccessReviewEntity,
): PrivilegedAccessReviewView {
  const status = Number(entity.status) as PrivilegedAccessReviewView['status'];
  return {
    id: Number(entity.id),
    reviewCode: entity.reviewCode,
    title: entity.title,
    description: entity.description ?? null,
    triggerSource: entity.triggerSource,
    status,
    statusName: getAccessReviewStatusName(status),
    dueAt: toIso(entity.dueAt) ?? new Date().toISOString(),
    completedAt: toIso(entity.completedAt),
    totalItems: Number(entity.totalItems),
    decidedItems: Number(entity.decidedItems),
    keptItems: Number(entity.keptItems),
    revokedItems: Number(entity.revokedItems),
    createdBy:
      entity.createdBy !== null && entity.createdBy !== undefined ? Number(entity.createdBy) : null,
    createdAt: toIso(entity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entity.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapReviewDetailToView(
  entity: PrivilegedAccessReviewEntity,
  items: readonly PrivilegedAccessReviewItemEntity[],
): PrivilegedAccessReviewDetailView {
  return {
    ...mapReviewEntityToView(entity),
    items: items.map(mapReviewItemEntityToView),
  };
}
