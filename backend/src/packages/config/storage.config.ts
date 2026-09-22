import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;
const listOr = (key: string, fallback: string[]): string[] => {
  const raw = env(key, false);
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

export type StorageDriverName = 'local' | 's3';

export const storageConfig = () => ({
  /** `local`: filesystem dưới `localPath`; `s3`: S3-compatible (AWS S3, MinIO…). */
  driver: (env('STORAGE_DRIVER', false) === 's3' ? 's3' : 'local') as StorageDriverName,
  localPath: env('STORAGE_LOCAL_PATH', false) || './uploads',
  s3: {
    /** Trống = AWS S3 theo region; MinIO: `http://host:9000`. */
    endpoint: env('STORAGE_S3_ENDPOINT', false) || null,
    region: env('STORAGE_S3_REGION', false) || 'us-east-1',
    bucket: env('STORAGE_S3_BUCKET', false) || '',
    forcePathStyle: booleanOr('STORAGE_S3_FORCE_PATH_STYLE', false),
    /** Tên secret (SecretService) chứa access/secret key; không có thì đọc env trực tiếp. */
    accessKeySecret: env('STORAGE_S3_ACCESS_KEY_SECRET', false) || 'STORAGE_S3_ACCESS_KEY',
    secretKeySecret: env('STORAGE_S3_SECRET_KEY_SECRET', false) || 'STORAGE_S3_SECRET_KEY',
    timeoutMs: numberOr('STORAGE_S3_TIMEOUT_MS', 30_000),
  },
  /** Dung lượng cấp cho storage (GB) khi provider không tự báo (S3/MinIO); 0 = không biết. */
  capacityGb: numberOr('STORAGE_CAPACITY_GB', 0),
  /** Giới hạn số object quét mỗi lần chụp usage. */
  scanMaxObjects: Math.max(100, numberOr('STORAGE_SCAN_MAX_OBJECTS', 200_000)),
  /** Multipart upload dở lâu hơn chừng này (phút) là "stale". */
  staleUploadMin: numberOr('STORAGE_STALE_UPLOAD_MIN', 60),
  largeObjectMb: numberOr('STORAGE_LARGE_OBJECT_MB', 500),
  /** Prefix chứa dữ liệu nhạy cảm — không bao giờ preview nội dung. */
  sensitivePrefixes: listOr('STORAGE_SENSITIVE_PREFIXES', ['private/', 'contracts/', 'secrets/']),
  signedUrlMaxSec: numberOr('STORAGE_SIGNED_URL_MAX_SEC', 24 * 3600),
  rules: {
    capacityWarnPercent: numberOr('STORAGE_CAPACITY_WARN_PERCENT', 80),
    capacityCritPercent: numberOr('STORAGE_CAPACITY_CRIT_PERCENT', 90),
    /** Tăng 24h ≥ N × mức tăng trung bình/ngày của 7 ngày trước → tăng bất thường. */
    growthFactor: numberOr('STORAGE_GROWTH_FACTOR', 3),
    /** Bỏ qua tăng trưởng dưới mức này (MB) để không báo động với storage nhỏ. */
    growthMinMb: numberOr('STORAGE_GROWTH_MIN_MB', 100),
    failureRatePercent: numberOr('STORAGE_FAILURE_RATE_PERCENT', 5),
    minOps: numberOr('STORAGE_RULE_MIN_OPS', 20),
    putP95Ms: numberOr('STORAGE_PUT_P95_MS', 3000),
    staleUploads: numberOr('STORAGE_STALE_UPLOADS', 1),
  },
  delete: booleanOr('OPS_STORAGE_DELETE_ENABLED', true),
  download: booleanOr('OPS_STORAGE_DOWNLOAD_ENABLED', true),
  signedUrl: booleanOr('OPS_STORAGE_SIGNED_URL_ENABLED', true),
  preview: booleanOr('OPS_STORAGE_PREVIEW_ENABLED', false),
  abortUpload: booleanOr('OPS_STORAGE_ABORT_UPLOAD_ENABLED', true),
});

export type StorageConfig = ReturnType<typeof storageConfig>;
