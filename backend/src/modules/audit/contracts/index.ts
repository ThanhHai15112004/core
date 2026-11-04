import type {
  AuditLogPaginatedResult,
  AuditLogRecord,
  SecurityAlertSeverityCode,
  SecurityAnomalyAlert,
  SecurityEventRecord,
  SecurityEventSeverity,
  SecurityEventTypeCode,
} from '@packages/security/index.js';
import type { ListAuditLogsQuery } from '../requests/audit.requests.js';

export const AUDIT_SETTING_KEYS = {
  AUDIT_LOG_PREFIX: 'roles.audit_log',
  AUDIT_LOG_DEFAULT_PAGE_SIZE: 'roles.audit_log.default_page_size',
  AUDIT_LOG_MAX_PAGE_SIZE: 'roles.audit_log.max_page_size',
} as const;

export interface SecurityEventsQueryFilter {
  readonly eventType?: SecurityEventTypeCode | string | undefined;
  readonly actorId?: number | undefined;
  readonly actorUserId?: number | undefined;
  readonly targetUserId?: number | undefined;
  readonly module?: string | undefined;
  readonly limit?: number | undefined;
}

export interface SecurityAlertsQueryFilter {
  readonly anomalyType?: string | undefined;
  readonly severity?: SecurityAlertSeverityCode | SecurityEventSeverity | undefined;
  readonly actorId?: number | undefined;
  readonly actorUserId?: number | undefined;
  readonly eventType?: number | string | undefined;
  readonly limit?: number | undefined;
}

export interface IAuditPublicService {
  listAuditLogs(query?: ListAuditLogsQuery): Promise<AuditLogPaginatedResult>;
  getAuditLogById(id: number): Promise<AuditLogRecord>;
  updateAuditLog(id: number, payload?: unknown): Promise<never>;
  deleteAuditLog(id: number): Promise<never>;
  listSecurityEvents(filter?: SecurityEventsQueryFilter): SecurityEventRecord[];
  listSecurityAlerts(filter?: SecurityAlertsQueryFilter): SecurityAnomalyAlert[];
}

export const AUDIT_PUBLIC_SERVICE = Symbol('AUDIT_PUBLIC_SERVICE');
