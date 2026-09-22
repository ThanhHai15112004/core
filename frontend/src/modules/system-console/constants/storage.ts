import type { AgeBucket, ObjectAge, ObjectKind, StorageCapability, StorageHealthStatus, StorageMetric, StorageRange, StorageTab } from '../types/storage.types';
import type { StatusTone } from '../utils/status-tone';

export const STORAGE_TABS: StorageTab[] = [
  'overview',
  'traffic',
  'containers',
  'objects',
  'uploads',
  'usage',
  'lifecycle',
  'errors',
  'operations',
  'configuration',
];
export const STORAGE_RANGES: StorageRange[] = ['15m', '1h', '6h', '24h'];
export const DEFAULT_STORAGE_RANGE: StorageRange = '1h';
export const STORAGE_METRICS: StorageMetric[] = ['upload', 'download', 'latency', 'operations', 'errors'];
export const OBJECT_KINDS: ObjectKind[] = ['image', 'video', 'audio', 'document', 'archive', 'text', 'other'];
export const OBJECT_AGES: ObjectAge[] = ['lt1d', '1to7d', '7to30d', 'gt30d', 'gt90d'];
export const AGE_BUCKETS: AgeBucket[] = ['lt1d', '1to7d', '7to30d', '30to90d', 'gt90d', 'unknown'];
export const OBJECT_PAGE_SIZE = 100;
/** Thời hạn chọn được cho signed URL (giây). */
export const SIGNED_URL_TTLS = [900, 3600, 6 * 3600, 24 * 3600] as const;

/** Tab cần capability nào (provider không hỗ trợ → "Không hỗ trợ"). */
export const TAB_CAPABILITY: Partial<Record<StorageTab, StorageCapability>> = {
  objects: 'listObjects',
  containers: 'containers',
  lifecycle: 'lifecycle',
};

export const STORAGE_HEALTH_TONE: Record<StorageHealthStatus, StatusTone> = {
  healthy: 'ok',
  degraded: 'warn',
  reconnecting: 'warn',
  unavailable: 'crit',
  unknown: 'unknown',
};

export const STORAGE_SERIES_COLORS: Record<string, string> = {
  uploadBytes: 'var(--scp-series-1)',
  uploadsPerMin: 'var(--scp-series-2)',
  downloadBytes: 'var(--scp-series-4)',
  downloadsPerMin: 'var(--scp-series-2)',
  putP95: 'var(--scp-series-1)',
  getP95: 'var(--scp-series-4)',
  deleteP95: 'var(--scp-series-3)',
  putPerMin: 'var(--scp-series-1)',
  getPerMin: 'var(--scp-series-4)',
  deletePerMin: 'var(--scp-series-3)',
  headPerMin: 'var(--scp-series-2)',
  listPerMin: 'var(--scp-series-5)',
  errorsPerMin: 'var(--scp-danger)',
  uploadErrorsPerMin: 'var(--scp-warning)',
  downloadErrorsPerMin: 'var(--scp-series-3)',
  bytes: 'var(--scp-series-1)',
  objects: 'var(--scp-series-2)',
};

export const STORAGE_CONFIRM = { delete: 'DELETE', abort: 'ABORT' } as const;
