export type DbErrorKind =
  | 'timeout'
  | 'connection'
  | 'deadlock'
  | 'lock_timeout'
  | 'cancelled'
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'query';

/** Lỗi query đã lưu — SQL đã chuẩn hoá, message đã bỏ literal, không có params. */
export interface DbErrorRecord {
  /** epoch ms */
  at: number;
  kind: DbErrorKind;
  code: string | null;
  message: string;
  sql: string;
  runtime: string | null;
  instance: string | null;
  correlationId: string | null;
}

/** Bản ghi query chậm — SQL đã chuẩn hoá, kèm ngữ cảnh requestId/traceId để truy vết. */
export interface DbSlowQueryRecord {
  /** epoch ms */
  at: number;
  durationMs: number;
  thresholdMs: number;
  sql: string;
  runtime: string | null;
  requestId: string | null;
  traceId: string | null;
  correlationId: string | null;
}

export type DbBackupRunStatus = 'success' | 'failed' | 'running' | 'unknown';

export interface DbBackupReportRecord {
  id: string;
  at: string;
  status: DbBackupRunStatus;
  durationMs: number | null;
  sizeBytes: number | null;
  location: string | null;
  provider: string | null;
  retentionDays: number | null;
  nextScheduledAt: string | null;
  error: string | null;
  reportedBy: string | null;
}

export type DbEventType =
  | 'connection_lost'
  | 'connection_recovered'
  | 'replica_fallback'
  | 'replica_recovered'
  | 'replication_lag'
  | 'deadlock'
  | 'alert_started'
  | 'alert_recovered'
  | 'query_cancelled'
  | 'session_terminated'
  | 'migration_completed'
  | 'migration_failed';

export interface DbEventRecord {
  id: string;
  /** epoch ms */
  at: number;
  type: DbEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  /** Tham số cho message (dịch lúc đọc). */
  params: Record<string, string | number>;
  runtime: string | null;
}

export type ConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'disabled';

/** Trạng thái kết nối do mỗi runtime báo. */
export interface ConnectionStatus {
  state: ConnectionState;
  /** ISO */
  since: string;
  lastSuccessAt: string | null;
  lastPingMs: number | null;
  lastError: { code: string | null; message: string } | null;
  attempts: number;
}
