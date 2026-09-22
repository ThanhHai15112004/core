export type CacheErrorKind = 'connection' | 'timeout' | 'command' | 'oom' | 'serialization';

/** Lỗi cache đã lưu — không có value, chỉ namespace của key. */
export interface CacheErrorRecord {
  /** epoch ms */
  at: number;
  kind: CacheErrorKind;
  operation: 'get' | 'set' | 'delete' | 'has' | 'clear';
  namespace: string;
  message: string;
  runtime: string | null;
  instance: string | null;
  correlationId: string | null;
}

export type CacheEventType =
  | 'connection_lost'
  | 'connection_recovered'
  | 'alert_started'
  | 'alert_recovered'
  | 'key_deleted'
  | 'namespace_cleared'
  | 'cache_flushed';

export interface CacheEventRecord {
  id: string;
  /** epoch ms */
  at: number;
  type: CacheEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  /** Tham số cho message (dịch lúc đọc). */
  params: Record<string, string | number>;
  runtime: string | null;
}

export type CacheOperationAction = 'delete_key' | 'clear_namespace' | 'flush_all';

/** Một thao tác quản trị cache (audit trail). */
export interface CacheOperationRecord {
  id: string;
  /** epoch ms */
  at: number;
  action: CacheOperationAction;
  target: string;
  result: 'success' | 'failed';
  /** Số key đã xoá. */
  affected: number;
  durationMs: number;
  /** Chưa có đăng nhập cho /ops → null; UI hiện "Console (chưa đăng nhập)". */
  actor: string | null;
  ip: string | null;
  error: string | null;
}

export type CacheConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'unavailable';

export interface CacheConnectionStatus {
  state: CacheConnectionState;
  /** ISO — thời điểm vào trạng thái hiện tại. */
  since: string;
  lastSuccessAt: string | null;
  lastError: string | null;
}
