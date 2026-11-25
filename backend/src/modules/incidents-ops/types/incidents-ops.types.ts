import type {
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  PostmortemStatus,
  SiemDispatchStatus,
  SiemDriver,
} from '../enum/incidents-ops.enum.js';

export interface IncidentTimelineEntry {
  readonly at: string;
  readonly action: string;
  readonly actorUserId: number | null;
  readonly note?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface PreventiveActionItem {
  readonly id: string;
  readonly title: string;
  readonly ownerUserId?: number | null;
  readonly dueDate?: string | null;
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'DONE';
}

export interface IncidentSeverityPolicyView {
  readonly id: number;
  readonly severity: IncidentSeverity;
  readonly name: string;
  readonly description: string | null;
  readonly responseSlaMinutes: number;
  readonly resolutionSlaMinutes: number;
  readonly autoEscalate: boolean;
  readonly isSystem: boolean;
  readonly updatedAt: string;
}

export interface IncidentRunbookView {
  readonly id: number;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly alertCode: string | null;
  readonly defaultSeverity: IncidentSeverity;
  readonly triageSteps: string[];
  readonly mitigationSteps: string[];
  readonly verificationSteps: string[];
  readonly isActive: boolean;
  readonly isSystem: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AlertOwnerMappingView {
  readonly id: number;
  readonly alertCode: string;
  readonly alertName: string;
  readonly source: IncidentSource;
  readonly defaultSeverity: IncidentSeverity;
  readonly ownerUserId: number;
  readonly backupOwnerUserId: number | null;
  readonly runbookId: number | null;
  readonly notifyChannels: string[];
  readonly isEnabled: boolean;
  readonly isSystem: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IncidentView {
  readonly id: number;
  readonly incidentCode: string;
  readonly title: string;
  readonly description: string | null;
  readonly source: IncidentSource;
  readonly alertCode: string;
  readonly fingerprint: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly ownerUserId: number;
  readonly runbookId: number | null;
  readonly occurrenceCount: number;
  readonly suppressedCount: number;
  readonly isRepeated: boolean;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly slaDueAt: string | null;
  readonly slaBreached: boolean;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: number | null;
  readonly mitigatedAt: string | null;
  readonly mitigatedBy: number | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: number | null;
  readonly recoverySeconds: number | null;
  readonly rootCause: string | null;
  readonly mitigationSummary: string | null;
  readonly resolutionNote: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly timeline: IncidentTimelineEntry[];
  readonly siemDeliveryStatus: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IncidentDetailView extends IncidentView {
  readonly runbook: IncidentRunbookView | null;
  readonly postmortem: IncidentPostmortemView | null;
}

export interface IncidentPostmortemView {
  readonly id: number;
  readonly incidentId: number;
  readonly incidentCode: string;
  readonly title: string;
  readonly summary: string;
  readonly impactSummary: string | null;
  readonly rootCauseAnalysis: string;
  readonly lessonsLearned: string;
  readonly preventiveActions: PreventiveActionItem[];
  readonly status: PostmortemStatus;
  readonly authorId: number | null;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SiemDispatchLogView {
  readonly id: number;
  readonly eventType: string;
  readonly alertCode: string | null;
  readonly severity: string;
  readonly driver: SiemDriver | string;
  readonly destination: string;
  readonly status: SiemDispatchStatus;
  readonly httpStatus: number | null;
  readonly attemptCount: number;
  readonly errorMessage: string | null;
  readonly payload: Record<string, unknown> | null;
  readonly incidentId: number | null;
  readonly actorUserId: number | null;
  readonly ipAddress: string | null;
  readonly dispatchedAt: string;
}

export interface IncidentsOverviewView {
  readonly openTotal: number;
  readonly openBySeverity: Readonly<Record<IncidentSeverity, number>>;
  readonly slaBreachedCount: number;
  readonly repeatedIncidentsCount: number;
  readonly totalSuppressedAlerts: number;
  readonly avgRecoverySeconds: number | null;
  readonly siem: {
    readonly enabled: boolean;
    readonly driver: SiemDriver;
    readonly endpointMasked: string | null;
    readonly sentLast24h: number;
    readonly failedLast24h: number;
  };
}

export interface IngestIncidentAlertInput {
  readonly source: IncidentSource;
  readonly alertCode: string;
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly severityHint?: IncidentSeverity | string | undefined;
  readonly fingerprint?: string | undefined;
  readonly actorUserId?: number | null | undefined;
  readonly targetUserId?: number | null | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly module?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly siemDeliveryStatus?: Record<string, unknown> | null | undefined;
}

export interface IncidentsRuntimeConfig {
  readonly defaultOwnerUserId: number;
  readonly dedupWindowMinutes: number;
  readonly siemEnabled: boolean;
  readonly siemDriver: SiemDriver;
  readonly siemEndpoint: string;
  readonly siemAuthToken: string;
}
