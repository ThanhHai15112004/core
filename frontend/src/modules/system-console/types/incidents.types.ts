import type { IncidentSeverity, IncidentStatus } from '../constants/incidents';

export interface PaginatedResultDto<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number | null;
    totalPages: number | null;
  };
}

export interface IncidentsOverviewDto {
  openTotal: number;
  openBySeverity: Record<IncidentSeverity, number>;
  slaBreachedCount: number;
  repeatedIncidentsCount: number;
  totalSuppressedAlerts: number;
  avgRecoverySeconds: number | null;
  siem: {
    enabled: boolean;
    driver: string;
    endpointMasked: string | null;
    sentLast24h: number;
    failedLast24h: number;
  };
}

export interface IncidentSeverityPolicyDto {
  id: number;
  severity: IncidentSeverity;
  name: string;
  description: string | null;
  responseSlaMinutes: number;
  resolutionSlaMinutes: number;
  autoEscalate: boolean;
  isSystem: boolean;
  updatedAt: string;
}

export interface IncidentRunbookDto {
  id: number;
  code: string;
  title: string;
  description: string | null;
  alertCode: string | null;
  defaultSeverity: IncidentSeverity;
  triageSteps: string[];
  mitigationSteps: string[];
  verificationSteps: string[];
  isActive: boolean;
  isSystem: boolean;
}

export interface AlertOwnerMappingDto {
  id: number;
  alertCode: string;
  alertName: string;
  source: 'SIEM' | 'METRICS' | 'MANUAL';
  defaultSeverity: IncidentSeverity;
  ownerUserId: number;
  backupOwnerUserId: number | null;
  runbookId: number | null;
  notifyChannels: string[];
  isEnabled: boolean;
  isSystem: boolean;
}

export interface PreventiveActionDto {
  id: string;
  title: string;
  ownerUserId?: number | null;
  dueDate?: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE';
}

export interface IncidentPostmortemDto {
  id: number;
  incidentId: number;
  incidentCode: string;
  title: string;
  summary: string;
  impactSummary: string | null;
  rootCauseAnalysis: string;
  lessonsLearned: string;
  preventiveActions: PreventiveActionDto[];
  status: 'DRAFT' | 'PUBLISHED';
  authorId: number | null;
  publishedAt: string | null;
}

export interface IncidentDto {
  id: number;
  incidentCode: string;
  title: string;
  description: string | null;
  source: 'SIEM' | 'METRICS' | 'MANUAL';
  alertCode: string;
  fingerprint: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  ownerUserId: number;
  runbookId: number | null;
  occurrenceCount: number;
  suppressedCount: number;
  isRepeated: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  recoverySeconds: number | null;
  rootCause: string | null;
  mitigationSummary: string | null;
}

export interface IncidentDetailDto extends IncidentDto {
  runbook: IncidentRunbookDto | null;
  postmortem: IncidentPostmortemDto | null;
}

export interface SiemDispatchLogDto {
  id: number;
  eventType: string;
  alertCode: string | null;
  severity: string;
  driver: string;
  destination: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  httpStatus: number | null;
  errorMessage: string | null;
  incidentId: number | null;
  actorUserId: number | null;
  ipAddress: string | null;
  dispatchedAt: string;
}
