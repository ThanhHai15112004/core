export type StorageOp = 'put' | 'get' | 'delete' | 'head' | 'list';

export type StorageErrorKind =
  'not_found' | 'permission' | 'timeout' | 'connection' | 'no_space' | 'throttled' | 'other';

/** Lỗi một thao tác storage — không có nội dung file. */
export interface StorageErrorRecord {
  /** epoch ms */
  at: number;
  op: StorageOp;
  key: string;
  container: string;
  size: number | null;
  kind: StorageErrorKind;
  /** Mã lỗi provider (NoSuchKey, AccessDenied, ENOENT…). */
  code: string | null;
  httpStatus: number | null;
  message: string;
  runtime: string | null;
  correlationId: string | null;
}

export type StorageEventType =
  | 'connection_lost'
  | 'connection_recovered'
  | 'alert_started'
  | 'alert_recovered'
  | 'object_deleted'
  | 'object_downloaded'
  | 'signed_url_created'
  | 'upload_aborted';

export interface StorageEventRecord {
  id: string;
  at: number;
  type: StorageEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  params: Record<string, string | number>;
  runtime: string | null;
}

export type StorageOperationAction =
  | 'delete_object'
  | 'delete_version'
  | 'download'
  | 'signed_url'
  | 'preview'
  | 'abort_upload'
  | 'test';

export interface StorageOperationRecord {
  id: string;
  at: number;
  action: StorageOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

/** Upload đang chạy trong một runtime. */
export interface ActiveUpload {
  id: string;
  key: string;
  container: string;
  size: number | null;
  sentBytes: number;
  /** epoch ms */
  startedAt: number;
  multipart: boolean;
  runtime: string | null;
}

export type StorageConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export interface StorageConnectionStatus {
  state: StorageConnectionState;
  since: string;
  lastSuccessAt: string | null;
  lastPingMs: number | null;
  lastError: string | null;
}
