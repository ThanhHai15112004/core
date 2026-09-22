import type { StorageDriverName } from '@packages/config/index.js';
import type { ObjectMeta } from '../drivers/storage-driver.js';
import type { ObjectKind } from '../utils/object-kind.js';

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

/** Một phần số liệu: có dữ liệu, hoặc lý do không có. */
export type StorageSection<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

export interface ScannedObject {
  key: string;
  size: number;
  /** epoch ms */
  lastModified: number | null;
  contentType: string | null;
}

export interface ObjectPage {
  objects: ScannedObject[];
  /** '' = hết. */
  cursor: string;
  examined: number;
}

export interface ObjectFilter {
  container: string | null;
  prefix: string;
  kind: ObjectKind | null;
  minSize: number | null;
  maxSize: number | null;
  /** Tuổi tối thiểu / tối đa (ms, theo lastModified). */
  minAgeMs: number | null;
  maxAgeMs: number | null;
}

export interface ObjectVersion {
  versionId: string;
  size: number;
  lastModified: number | null;
  isLatest: boolean;
  deleteMarker: boolean;
}

export interface ObjectRetention {
  mode: string | null;
  /** epoch ms */
  retainUntil: number | null;
  legalHold: boolean;
}

export interface ObjectDetail extends ObjectMeta {
  container: string;
  kind: ObjectKind;
  versions: ObjectVersion[] | null;
  retention: ObjectRetention | null;
}

export interface Capacity {
  totalBytes: number | null;
  freeBytes: number | null;
  /** filesystem: statfs thật; config: STORAGE_CAPACITY_GB; null: provider quản lý (không giới hạn/không biết). */
  source: 'filesystem' | 'config' | null;
}

export interface MultipartUpload {
  uploadId: string;
  key: string;
  container: string;
  /** epoch ms */
  initiated: number | null;
  parts: number | null;
  uploadedBytes: number | null;
}

export interface LifecycleRule {
  id: string;
  status: 'enabled' | 'disabled';
  prefix: string;
  /** Hành động: expire / transition / abortMultipart / noncurrentExpire. */
  actions: { type: string; days: number | null; storageClass: string | null }[];
}

export interface LifecycleInfo {
  rules: LifecycleRule[];
  versioning: 'enabled' | 'suspended' | 'disabled' | null;
  objectLock: boolean | null;
}

export interface ProviderInfo {
  driver: StorageDriverName;
  /** Tên hiển thị: Local Filesystem, MinIO, AWS S3, S3-compatible. */
  product: string;
  /** Root path (local) hoặc bucket (s3). */
  location: string;
  endpoint: string | null;
  region: string | null;
}

export interface StorageMonitoringProvider {
  readonly capabilities: ReadonlySet<StorageCapability>;
  info(): ProviderInfo;
  ping(): Promise<number>;
  /** Quét (có giới hạn) để lập snapshot usage. */
  scan(limit: number): Promise<{ objects: ScannedObject[]; total: number; truncated: boolean }>;
  listPage(filter: ObjectFilter, cursor: string, count: number): Promise<ObjectPage>;
  detail(key: string): Promise<ObjectDetail | null>;
  capacity(): Promise<Capacity>;
  multipart(): Promise<MultipartUpload[]>;
  lifecycle(): Promise<LifecycleInfo>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  signedUrl(key: string, ttlSec: number): Promise<string>;
  /** Đọc tối đa `bytes` byte đầu (preview). */
  readHead(key: string, bytes: number): Promise<Buffer>;
}
