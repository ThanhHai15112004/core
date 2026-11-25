import type { Tone } from '@core/theme';

export const INCIDENTS_TABS = ['incidents', 'governance', 'siem'] as const;
export type IncidentsTab = (typeof INCIDENTS_TABS)[number];

export const INCIDENT_SEVERITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'MITIGATED', 'RESOLVED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SEVERITY_TONE: Record<IncidentSeverity, Tone> = {
  P1: 'crit',
  P2: 'warn',
  P3: 'info',
  P4: 'unknown',
};

export const INCIDENT_STATUS_TONE: Record<IncidentStatus, Tone> = {
  OPEN: 'crit',
  ACKNOWLEDGED: 'warn',
  MITIGATED: 'info',
  RESOLVED: 'ok',
  CLOSED: 'ok',
};
