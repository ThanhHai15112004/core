import type { Tone } from '@core/theme';
import type { AgeBucket, ObjectAge, ObjectKind, StorageErrorKind, StorageHealthStatus, StorageOp, StorageRange, StorageTab } from '../types/storage.types';
import type { TabAlias } from '../shell/useSectionRoute';

/** Tab hiển thị (Cấu hình mở dạng sheet ⚙). */
export const STORAGE_TABS = ['overview', 'objects', 'uploads', 'activity'] as const;
export type StoragePageTab = (typeof STORAGE_TABS)[number];

/** Tab cũ → tab mới (link cũ, `tab` trong cảnh báo / sự kiện của backend). */
export const STORAGE_TAB_ALIASES: Partial<Record<StorageTab, TabAlias<StoragePageTab>>> = {
  containers: { tab: 'objects' },
  usage: { tab: 'overview' },
  lifecycle: { tab: 'overview' },
  errors: { tab: 'activity' },
  operations: { tab: 'activity' },
  configuration: { tab: 'overview', query: { settings: '1' } },
};

export const STORAGE_RANGES: StorageRange[] = ['15m', '1h', '6h', '24h'];
export const OBJECT_KINDS: ObjectKind[] = ['image', 'video', 'audio', 'document', 'archive', 'text', 'other'];
export const OBJECT_AGES: ObjectAge[] = ['lt1d', '1to7d', '7to30d', 'gt30d', 'gt90d'];
export const AGE_BUCKETS: AgeBucket[] = ['lt1d', '1to7d', '7to30d', '30to90d', 'gt90d', 'unknown'];
export const STORAGE_OPS: StorageOp[] = ['put', 'get', 'delete', 'head', 'list'];
export const STORAGE_ERROR_KINDS: StorageErrorKind[] = ['not_found', 'permission', 'timeout', 'connection', 'no_space', 'throttled', 'other'];
/** Bộ lọc kích thước tối thiểu (MB). */
export const MIN_SIZE_MB_OPTIONS = ['1', '10', '100', '1024'] as const;
/** Thời hạn chọn được cho signed URL (giây). */
export const SIGNED_URL_TTLS = [900, 3600, 6 * 3600, 24 * 3600] as const;
/** Số object mỗi trang (phân trang theo cursor). */
export const OBJECT_PAGE_SIZE = 100;
/** Container gốc (object không nằm trong thư mục / prefix nào). */
export const ROOT_CONTAINER = '(root)';
/** Số mục trên danh sách "top" của Tổng quan. */
export const TOP_LIST_SIZE = 6;
/** Số object lớn nhất trong chi tiết container. */
export const CONTAINER_LARGEST_LIMIT = 10;
/** Lịch sử dung lượng chụp mỗi giờ — cần ít nhất ngần này điểm mới vẽ. */
export const HISTORY_MIN_POINTS = 2;
/** Mức % dung lượng coi là cao (khi backend không gửi ngưỡng riêng). */
export const CAPACITY_THRESHOLDS = { warn: 70, crit: 85 } as const;
export const ACTIVITY_MAX_HEIGHT_PX = 640;
export const OBJECT_TABLE_HEIGHT_PX = 560;
export const PREVIEW_MAX_HEIGHT_PX = 360;
/** Độ dài version id hiển thị. */
export const VERSION_ID_LENGTH = 12;

/** Chữ xác nhận backend yêu cầu. */
export const STORAGE_CONFIRM = { delete: 'DELETE', abort: 'ABORT' } as const;

export const STORAGE_HEALTH_TONE: Record<StorageHealthStatus, Tone> = {
  healthy: 'ok',
  degraded: 'warn',
  reconnecting: 'warn',
  unavailable: 'crit',
  unknown: 'unknown',
};

/** Rule cảnh báo backend gắn với từng ô số liệu. */
export const STORAGE_KPI_RULES = {
  used: ['CAPACITY'],
  growth: ['RAPID_GROWTH'],
  uploads: ['STALE_MULTIPART'],
} as const;
