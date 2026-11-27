import type {
  AccessReviewDecisionCode,
  AccessReviewDecisionName,
  AccessReviewStatusCode,
  AccessReviewStatusName,
  BreakGlassStatusCode,
  BreakGlassStatusName,
  PrivilegedGrantStatusCode,
  PrivilegedGrantStatusName,
  PrivilegedReviewSource,
  PrivilegedSensitivityLevel,
  PrivilegedTargetType,
} from '../enum/privileged-access.enum.js';

export interface PrivilegedAccessRuntimeConfig {
  readonly enabled: boolean;
  readonly breakGlassEnabled: boolean;
  readonly periodicReviewEnabled: boolean;
  readonly enforceStepUpMfa: boolean;
  readonly requireApprovalDefault: boolean;
  readonly maxGrantDurationMinutes: number;
  readonly breakGlassMaxMinutes: number;
  readonly alertRoleCodes: readonly string[];
  readonly alertCooldownSeconds: number;
  readonly alertCreateIncidentForCritical: boolean;
  readonly reviewCycleDays: number;
  readonly reviewDueDays: number;
  readonly revokeSessionsOnGrantExpiry: boolean;
}

export interface PrivilegedTargetView {
  readonly id: number;
  readonly targetType: PrivilegedTargetType;
  readonly targetCode: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly sensitivityLevel: PrivilegedSensitivityLevel;
  readonly requireMfaStepUp: boolean;
  readonly requireApproval: boolean;
  readonly autoApproveAllowed: boolean;
  readonly maxGrantMinutes: number;
  readonly alertOnUse: boolean;
  readonly reviewIntervalDays: number;
  readonly isEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PrivilegedUserDirectoryItemView {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: number;
  readonly statusName: string;
  readonly roles: readonly {
    readonly roleId: number;
    readonly code: string;
    readonly name: string;
  }[];
  readonly privilegedRoleCodes: readonly string[];
  readonly isStandingPrivileged: boolean;
  readonly isLinkedBreakGlass: boolean;
  readonly breakGlassCode: string | null;
  readonly breakGlassStatus: BreakGlassStatusName | null;
}

export interface PrivilegedGrantView {
  readonly id: number;
  readonly grantCode: string;
  readonly userId: number;
  readonly username: string | null;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly targetType: PrivilegedTargetType;
  readonly targetCode: string;
  readonly roleId: number | null;
  readonly reason: string;
  readonly ticketRef: string | null;
  readonly durationMinutes: number;
  readonly status: PrivilegedGrantStatusCode;
  readonly statusName: PrivilegedGrantStatusName;
  readonly requiresApproval: boolean;
  readonly requestedBy: number;
  readonly requestedAt: string;
  readonly approvedBy: number | null;
  readonly approvedAt: string | null;
  readonly approvalComment: string | null;
  readonly startsAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedBy: number | null;
  readonly revokedAt: string | null;
  readonly revokeReason: string | null;
  readonly autoRevoked: boolean;
  readonly stepUpVerified: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BreakGlassAccountView {
  readonly id: number;
  readonly code: string;
  readonly userId: number;
  readonly username: string | null;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly userStatus: number | null;
  readonly label: string;
  readonly description: string | null;
  readonly roleCode: string;
  readonly status: BreakGlassStatusCode;
  readonly statusName: BreakGlassStatusName;
  readonly requireMfa: boolean;
  readonly maxActivationMinutes: number;
  readonly alertRecipients: readonly string[];
  readonly lastActivatedBy: number | null;
  readonly lastActivationReason: string | null;
  readonly lastTicketRef: string | null;
  readonly activatedAt: string | null;
  readonly expiresAt: string | null;
  readonly sealedBy: number | null;
  readonly sealedAt: string | null;
  readonly sealReason: string | null;
  readonly activationCount: number;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PrivilegedUsageAlertView {
  readonly id: number;
  readonly eventType: string;
  readonly severity: string;
  readonly actorUserId: number | null;
  readonly actorUsername: string | null;
  readonly targetType: PrivilegedTargetType | null;
  readonly targetCode: string | null;
  readonly action: string;
  readonly endpoint: string | null;
  readonly httpMethod: string | null;
  readonly ipAddress: string | null;
  readonly details: Record<string, unknown> | null;
  readonly notifiedRecipients: readonly string[];
  readonly notificationDispatchId: number | null;
  readonly incidentId: number | null;
  readonly acknowledgedBy: number | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgeNote: string | null;
  readonly createdAt: string;
}

export interface PrivilegedAccessReviewItemView {
  readonly id: number;
  readonly reviewId: number;
  readonly userId: number;
  readonly username: string;
  readonly email: string | null;
  readonly grantSource: PrivilegedReviewSource;
  readonly targetType: PrivilegedTargetType;
  readonly targetCode: string;
  readonly roleId: number | null;
  readonly grantId: number | null;
  readonly breakGlassId: number | null;
  readonly decision: AccessReviewDecisionCode;
  readonly decisionName: AccessReviewDecisionName;
  readonly decidedBy: number | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly enforcementApplied: boolean;
  readonly enforcementError: string | null;
  readonly createdAt: string;
}

export interface PrivilegedAccessReviewView {
  readonly id: number;
  readonly reviewCode: string;
  readonly title: string;
  readonly description: string | null;
  readonly triggerSource: string;
  readonly status: AccessReviewStatusCode;
  readonly statusName: AccessReviewStatusName;
  readonly dueAt: string;
  readonly completedAt: string | null;
  readonly totalItems: number;
  readonly decidedItems: number;
  readonly keptItems: number;
  readonly revokedItems: number;
  readonly createdBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PrivilegedAccessReviewDetailView extends PrivilegedAccessReviewView {
  readonly items: readonly PrivilegedAccessReviewItemView[];
}

export interface PrivilegedAccessOverviewView {
  readonly runtimeConfig: PrivilegedAccessRuntimeConfig;
  readonly targetsTotal: number;
  readonly targetsEnabled: number;
  readonly pendingGrantsCount: number;
  readonly activeGrantsCount: number;
  readonly breakGlassTotal: number;
  readonly breakGlassActiveCount: number;
  readonly unacknowledgedAlertsCount: number;
  readonly openReviewsCount: number;
  readonly standingPrivilegedUsersCount: number;
}

export interface PrivilegedExpirationSweepResult {
  readonly expiredGrantsCount: number;
  readonly expiredGrantIds: readonly number[];
  readonly autoSealedBreakGlassCount: number;
  readonly autoSealedBreakGlassIds: readonly number[];
}

export interface PrivilegedReviewScheduleResult {
  readonly created: boolean;
  readonly reviewId: number | null;
  readonly reviewCode: string | null;
  readonly totalItems: number;
}
