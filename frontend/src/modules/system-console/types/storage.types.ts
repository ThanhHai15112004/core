import type { Section } from './database.types';

export type { Section };
export type StorageRange = '15m' | '1h' | '6h' | '24h';
export type StorageMetric = 'upload' | 'download' | 'latency' | 'operations' | 'errors';
export type StorageTab = 'overview' | 'traffic' | 'containers' | 'objects' | 'uploads' | 'usage' | 'lifecycle' | 'errors' | 'operations' | 'configuration';
export type StorageHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'reconnecting' | 'unknown';
export type StorageCapability =
  | 'listObjects'
  | 'usage'
  | 'capacity'
  | 'containers'
  | 'multipart'
  | 'signedUrl'
  | 'lifecycle'
  | 'versioning'
  | 'retention'
  | 'download'
  | 'preview'
  | 'httpStatus';
export type StorageOp = 'put' | 'get' | 'delete' | 'head' | 'list';
export type StorageErrorKind = 'not_found' | 'permission' | 'timeout' | 'connection' | 'no_space' | 'throttled' | 'other';
export type ObjectKind = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'text' | 'other';
export type AgeBucket = 'lt1d' | '1to7d' | '7to30d' | '30to90d' | 'gt90d' | 'unknown';
export type ObjectAge = 'lt1d' | '1to7d' | '7to30d' | 'gt30d' | 'gt90d';
export type StorageEventType =
  | 'connection_lost'
  | 'connection_recovered'
  | 'alert_started'
  | 'alert_recovered'
  | 'object_deleted'
  | 'object_downloaded'
  | 'signed_url_created'
  | 'upload_aborted';
export type StorageOperationAction = 'delete_object' | 'delete_version' | 'download' | 'signed_url' | 'preview' | 'abort_upload' | 'test';

export interface ProviderInfo {
  driver: 'local' | 's3';
  product: string;
  location: string;
  endpoint: string | null;
  region: string | null;
}

export interface StorageAlert {
  id: string;
  rule: string;
  severity: 'warning' | 'critical' | 'info';
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string;
  tab: StorageTab;
  container: string | null;
}

export interface TransferPerf {
  bytes: number;
  bytesPerSec: number | null;
  ops: number;
  opsPerMin: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  failures: number;
  failureRatePercent: number | null;
}

export interface OperationRow {
  op: StorageOp;
  ops: number;
  perMin: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  failures: number;
}

export interface Capacity {
  totalBytes: number | null;
  freeBytes: number | null;
  source: 'filesystem' | 'config' | null;
  usedBytes: number | null;
  percent: number | null;
}

export interface Growth {
  todayBytes: number | null;
  d7Bytes: number | null;
  d30Bytes: number | null;
  todayObjects: number | null;
  createdToday: number | null;
  deletedTodayEstimate: number | null;
}

export interface ContainerRow {
  name: string;
  objects: number;
  bytes: number;
  growth24hBytes: number | null;
  createdToday: number;
  uploadBytes: number;
  downloadBytes: number;
  ops: number;
  errors: number;
  newest: string | null;
}

export interface StorageReport {
  usedBytes: number | null;
  growthBytes: number | null;
  objects: number | null;
  uploads: number;
  downloads: number;
  uploadedBytes: number;
  downloadedBytes: number;
  failedOps: number;
}

export interface StorageEvent {
  id: string;
  at: string;
  type: StorageEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  runtime: string | null;
  tab: StorageTab | null;
}

export interface StorageSettings {
  delete: boolean;
  download: boolean;
  signedUrl: boolean;
  preview: boolean;
  abortUpload: boolean;
  signedUrlMaxSec: number;
  largeObjectBytes: number;
  staleUploadMin: number;
}

export interface StorageOverview {
  generatedAt: string;
  range: StorageRange;
  provider: ProviderInfo;
  environment: string;
  capabilities: StorageCapability[];
  health: {
    status: StorageHealthStatus;
    reasons: { code: string; message: string }[];
    state: 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
    since: string;
    lastSuccessAt: string | null;
    pingMs: number | null;
    lastError: string | null;
  };
  kpis: {
    usedBytes: number | null;
    objects: number | null;
    objectsTruncated: boolean;
    uploadBytesPerSec: number | null;
    downloadBytesPerSec: number | null;
    opsPerSec: number | null;
    errorRatePercent: number | null;
    failedOps: number;
    growthTodayBytes: number | null;
    containers: number | null;
  };
  capacity: Section<Capacity>;
  growth: Growth;
  upload: TransferPerf;
  download: TransferPerf;
  operations: OperationRow[];
  topContainers: ContainerRow[];
  uploads: { active: number; completedPerMin: number | null; failed: number; stale: number | null; multipart: number | null };
  alerts: StorageAlert[];
  relatedImpact: { apiP95Ms: { current: number | null; baseline: number | null; changePercent: number | null }; queueWaiting: number | null };
  report: { today: StorageReport; yesterday: StorageReport };
  events: StorageEvent[];
  usageAt: string | null;
  usageTruncated: boolean;
  settings: StorageSettings;
}

export interface StorageSeries {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface StorageMetrics {
  metric: StorageMetric;
  range: StorageRange;
  resolutionSec: number | null;
  unit: string;
  series: StorageSeries[];
}

export interface StorageErrorItem {
  at: string;
  op: StorageOp;
  key: string;
  container: string;
  size: number | null;
  kind: StorageErrorKind;
  code: string | null;
  httpStatus: number | null;
  message: string;
  runtime: string | null;
  correlationId: string | null;
}

export interface StorageTraffic {
  range: StorageRange;
  upload: TransferPerf;
  download: TransferPerf;
  operations: OperationRow[];
  http: Section<{ classes: { cls: string; count: number; percent: number | null }[]; topErrors: { code: string; count: number }[] }>;
  errorsByKind: Record<StorageErrorKind, number>;
}

export interface LargestObject {
  key: string;
  container: string;
  size: number;
  kind: ObjectKind;
  lastModified: number | null;
  large: boolean;
}

export interface StorageUsage {
  usageAt: string | null;
  truncated: boolean;
  scannedObjects: number | null;
  totalObjects: number | null;
  usedBytes: number | null;
  capacity: Section<Capacity>;
  growth: Growth;
  history: { t: number; bytes: number; objects: number }[];
  byKind: { kind: ObjectKind; objects: number; bytes: number }[];
  byAge: { bucket: AgeBucket; objects: number; bytes: number }[];
  largest: LargestObject[];
  largeObjectBytes: number;
}

export interface StorageContainers {
  containers: ContainerRow[];
  range: StorageRange;
  usageAt: string | null;
  truncated: boolean;
  location: string;
}

export interface ContainerDetail {
  container: ContainerRow;
  range: StorageRange;
  history: { t: number; bytes: number; objects: number }[];
  byKind: { kind: ObjectKind; objects: number; bytes: number }[];
  largest: LargestObject[];
  recentErrors: StorageErrorItem[];
  traffic: { upload: StorageSeries; download: StorageSeries };
}

export interface ObjectRow {
  key: string;
  container: string;
  kind: ObjectKind;
  size: number;
  lastModified: string | null;
}

export interface StorageObjects {
  objects: Section<ObjectRow[]>;
  cursor: string;
  done: boolean;
  examined: number;
}

export interface ObjectDetail {
  key: string;
  size: number;
  contentType: string | null;
  lastModified: string | null;
  createdAt: string | null;
  etag: string | null;
  storageClass: string | null;
  versionId: string | null;
  checksum: string | null;
  container: string;
  kind: ObjectKind;
  versions: { versionId: string; size: number; lastModified: string | null; isLatest: boolean; deleteMarker: boolean }[] | null;
  retention: { mode: string | null; retainUntil: string | null; legalHold: boolean; active: boolean } | null;
  large: boolean;
  sensitive: boolean;
  previewable: boolean;
  settings: StorageSettings;
  capabilities: StorageCapability[];
}

export type ObjectPreview =
  | { kind: 'image'; contentType: string; base64: string; size: number }
  | { kind: 'text'; contentType: string; text: string; truncated: boolean; size: number; redacted: boolean };

export interface ActiveUpload {
  id: string;
  key: string;
  container: string;
  size: number | null;
  sentBytes: number;
  startedAt: number;
  startedAtIso: string;
  ageSec: number;
  percent: number | null;
  multipart: boolean;
  runtime: string | null;
}

export interface MultipartUpload {
  uploadId: string;
  key: string;
  container: string;
  initiated: string | null;
  parts: number | null;
  uploadedBytes: number | null;
  ageMin: number | null;
  stale: boolean;
}

export interface StorageUploads {
  active: ActiveUpload[];
  multipart: Section<MultipartUpload[]>;
  failedUploads: StorageErrorItem[];
  failedDownloads: StorageErrorItem[];
  completedPerMin: number | null;
  avgUploadMs: number | null;
  staleUploadMin: number;
  abortEnabled: boolean;
}

export interface LifecycleRule {
  id: string;
  status: 'enabled' | 'disabled';
  prefix: string;
  actions: { type: string; days: number | null; storageClass: string | null }[];
}

export interface StorageLifecycle {
  lifecycle: Section<{ rules: LifecycleRule[]; versioning: 'enabled' | 'suspended' | 'disabled' | null; objectLock: boolean | null }>;
  estimate: { rule: string; prefix: string; days: number; objects: number; bytes: number; capped: boolean }[] | null;
}

export interface StorageErrors {
  counts: Record<StorageErrorKind, number>;
  byOp: Record<StorageOp, number>;
  total: number;
  items: StorageErrorItem[];
  range: StorageRange;
}

export interface StorageOperation {
  id: string;
  at: string;
  action: StorageOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

export interface StorageConfig {
  items: { key: string; value: string | number | boolean | null; sensitive?: boolean; group: string }[];
}

export interface StorageTest {
  ok: boolean;
  steps: { step: 'connect' | 'write' | 'read' | 'verify' | 'delete'; ok: boolean; ms: number | null; error: string | null }[];
  totalMs: number;
  failedStep: string | null;
  at: string;
}

export interface ObjectFilter {
  container: string;
  prefix: string;
  kind: ObjectKind | '';
  age: ObjectAge | '';
  minSizeMb: string;
}
