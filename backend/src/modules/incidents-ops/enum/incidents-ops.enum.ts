export const INCIDENT_SEVERITY = {
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
} as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITY)[keyof typeof INCIDENT_SEVERITY];
export const ALL_INCIDENT_SEVERITIES = Object.values(
  INCIDENT_SEVERITY,
) as readonly IncidentSeverity[];

export const INCIDENT_STATUS = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  MITIGATED: 'MITIGATED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;

export type IncidentStatus = (typeof INCIDENT_STATUS)[keyof typeof INCIDENT_STATUS];
export const ALL_INCIDENT_STATUSES = Object.values(INCIDENT_STATUS) as readonly IncidentStatus[];

export const INCIDENT_SOURCE = {
  SIEM: 'SIEM',
  METRICS: 'METRICS',
  MANUAL: 'MANUAL',
} as const;

export type IncidentSource = (typeof INCIDENT_SOURCE)[keyof typeof INCIDENT_SOURCE];
export const ALL_INCIDENT_SOURCES = Object.values(INCIDENT_SOURCE) as readonly IncidentSource[];

export const SIEM_DRIVER = {
  INTERNAL_LOG: 'internal_log',
  WEBHOOK: 'webhook',
  SPLUNK_HEC: 'splunk_hec',
  ELASTIC: 'elastic',
} as const;

export type SiemDriver = (typeof SIEM_DRIVER)[keyof typeof SIEM_DRIVER];
export const ALL_SIEM_DRIVERS = Object.values(SIEM_DRIVER) as readonly SiemDriver[];

export const SIEM_DISPATCH_STATUS = {
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;

export type SiemDispatchStatus = (typeof SIEM_DISPATCH_STATUS)[keyof typeof SIEM_DISPATCH_STATUS];

export const POSTMORTEM_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
} as const;

export type PostmortemStatus = (typeof POSTMORTEM_STATUS)[keyof typeof POSTMORTEM_STATUS];
export const ALL_POSTMORTEM_STATUSES = Object.values(
  POSTMORTEM_STATUS,
) as readonly PostmortemStatus[];

export const INCIDENTS_SETTING_KEYS = {
  DEFAULT_OWNER_USER_ID: 'incidents.default_owner_user_id',
  DEDUP_WINDOW_MINUTES: 'incidents.dedup_window_minutes',
  SIEM_ENABLED: 'siem.enabled',
  SIEM_DRIVER: 'siem.driver',
  SIEM_ENDPOINT: 'siem.endpoint',
  SIEM_AUTH_TOKEN: 'siem.auth_token',
} as const;

export const INCIDENTS_DEFAULTS = {
  DEFAULT_OWNER_USER_ID: 1,
  DEDUP_WINDOW_MINUTES: 60,
  SIEM_ENABLED: false,
  SIEM_DRIVER: SIEM_DRIVER.INTERNAL_LOG,
  SIEM_ENDPOINT: '',
  SIEM_TIMEOUT_MS: 5000,
  INCIDENT_CODE_SEQUENCE_KEY: 'incidents.incident_code',
} as const;

export const DEFAULT_RESPONSE_SLA_MINUTES: Readonly<Record<IncidentSeverity, number>> = {
  P1: 15,
  P2: 30,
  P3: 120,
  P4: 1440,
};

export const DEFAULT_RESOLUTION_SLA_MINUTES: Readonly<Record<IncidentSeverity, number>> = {
  P1: 60,
  P2: 240,
  P3: 1440,
  P4: 4320,
};

export const INCIDENTS_OPS_EVENTS = {
  INCIDENT_CREATED: 'incidents.incident.created',
  INCIDENT_REPEATED: 'incidents.incident.repeated',
  INCIDENT_ACKNOWLEDGED: 'incidents.incident.acknowledged',
  INCIDENT_MITIGATED: 'incidents.incident.mitigated',
  INCIDENT_RESOLVED: 'incidents.incident.resolved',
  POSTMORTEM_PUBLISHED: 'incidents.postmortem.published',
  SIEM_DISPATCHED: 'incidents.siem.dispatched',
} as const;
