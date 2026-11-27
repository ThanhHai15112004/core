export type PrivilegedTargetType = 'ROLE' | 'PERMISSION';
export type PrivilegedSensitivityLevel = 'HIGH' | 'CRITICAL';

export interface PrivilegedRuntimeConfig {
  readonly enabled: boolean;
  readonly breakGlassEnabled: boolean;
  readonly periodicReviewEnabled: boolean;
  readonly enforceStepUpMfa: boolean;
  readonly requireApprovalDefault: boolean;
  readonly maxGrantDurationMinutes: number;
  readonly breakGlassMaxMinutes: number;
  readonly alertRoleCodes: readonly string[];
  readonly alertCooldownSeconds: number;
  readonly reviewCycleDays: number;
  readonly reviewDueDays: number;
}

export interface PrivilegedOverviewItem {
  readonly runtimeConfig: PrivilegedRuntimeConfig;
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

export interface PrivilegedTargetItem {
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

export interface PrivilegedUserDirectoryItem {
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
  readonly breakGlassStatus: string | null;
}

export interface PrivilegedGrantItem {
  readonly id: number;
  readonly grantCode: string;
  readonly userId: number;
  readonly username: string | null;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly targetType: PrivilegedTargetType;
  readonly targetCode: string;
  readonly reason: string;
  readonly ticketRef: string | null;
  readonly durationMinutes: number;
  readonly status: number;
  readonly statusName: string;
  readonly requiresApproval: boolean;
  readonly requestedBy: number;
  readonly requestedAt: string;
  readonly approvedBy: number | null;
  readonly approvedAt: string | null;
  readonly startsAt: string | null;
  readonly expiresAt: string | null;
  readonly revokeReason: string | null;
  readonly autoRevoked: boolean;
}

export interface BreakGlassAccountItem {
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
  readonly status: number;
  readonly statusName: string;
  readonly requireMfa: boolean;
  readonly maxActivationMinutes: number;
  readonly alertRecipients: readonly string[];
  readonly lastActivationReason: string | null;
  readonly activatedAt: string | null;
  readonly expiresAt: string | null;
  readonly sealReason: string | null;
  readonly activationCount: number;
  readonly lastUsedAt: string | null;
}

export interface PrivilegedUsageAlertItem {
  readonly id: number;
  readonly eventType: string;
  readonly severity: string;
  readonly actorUserId: number | null;
  readonly actorUsername: string | null;
  readonly targetType: PrivilegedTargetType | null;
  readonly targetCode: string | null;
  readonly action: string;
  readonly endpoint: string | null;
  readonly ipAddress: string | null;
  readonly notifiedRecipients: readonly string[];
  readonly incidentId: number | null;
  readonly acknowledgedBy: number | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgeNote: string | null;
  readonly createdAt: string;
}

export interface PrivilegedReviewItemEntry {
  readonly id: number;
  readonly reviewId: number;
  readonly userId: number;
  readonly username: string;
  readonly email: string | null;
  readonly grantSource: 'STANDING_ROLE' | 'TEMPORARY_GRANT' | 'BREAK_GLASS';
  readonly targetType: PrivilegedTargetType;
  readonly targetCode: string;
  readonly decision: number;
  readonly decisionName: 'PENDING' | 'KEEP' | 'REVOKE';
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly enforcementApplied: boolean;
  readonly enforcementError: string | null;
}

export interface PrivilegedReviewCampaignItem {
  readonly id: number;
  readonly reviewCode: string;
  readonly title: string;
  readonly description: string | null;
  readonly triggerSource: string;
  readonly status: number;
  readonly statusName: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  readonly dueAt: string;
  readonly completedAt: string | null;
  readonly totalItems: number;
  readonly decidedItems: number;
  readonly keptItems: number;
  readonly revokedItems: number;
  readonly createdAt: string;
}

export interface PrivilegedReviewCampaignDetail extends PrivilegedReviewCampaignItem {
  readonly items: readonly PrivilegedReviewItemEntry[];
}
