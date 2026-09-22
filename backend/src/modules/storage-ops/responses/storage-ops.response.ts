import type {
  ActiveUpload,
  AgeBucket,
  Capacity,
  LargestObject,
  LifecycleInfo,
  MultipartUpload,
  ObjectDetail,
  ObjectKind,
  ProviderInfo,
  StorageCapability,
  StorageConnectionState,
  StorageErrorKind,
  StorageEventType,
  StorageOp,
  StorageOperationAction,
  StorageSection,
  StorageTestResult,
} from '@packages/storage/index.js';

export type StorageRange = '15m' | '1h' | '6h' | '24h';
export type StorageMetric = 'upload' | 'download' | 'latency' | 'operations' | 'errors';
export type StorageSeverity = 'warning' | 'critical' | 'info';
export type StorageHealthStatus =
  'healthy' | 'degraded' | 'unavailable' | 'reconnecting' | 'unknown';
export type SectionDto<T> = StorageSection<T>;

export interface StorageAlertDto {
  id: string;
  rule: string;
  severity: StorageSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string;
  tab: string;
  container: string | null;
}

export interface StorageHealthDto {
  status: StorageHealthStatus;
  reasons: { code: string; message: string }[];
  state: StorageConnectionState;
  since: string;
  lastSuccessAt: string | null;
  pingMs: number | null;
  lastError: string | null;
}

/** Hiệu năng một chiều (upload hoặc download) trong khoảng đang xem. */
export interface TransferPerfDto {
  bytes: number;
  bytesPerSec: number | null;
  ops: number;
  opsPerMin: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  failures: number;
  failureRatePercent: number | null;
}

export interface OperationRowDto {
  op: StorageOp;
  ops: number;
  perMin: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  failures: number;
}

export interface CapacityDto extends Capacity {
  usedBytes: number | null;
  percent: number | null;
}

export interface GrowthDto {
  todayBytes: number | null;
  d7Bytes: number | null;
  d30Bytes: number | null;
  todayObjects: number | null;
  /** Object tạo/sửa hôm nay (theo lastModified). */
  createdToday: number | null;
  /** Ước tính: số object đầu ngày + tạo hôm nay − hiện tại. */
  deletedTodayEstimate: number | null;
}

export interface ContainerRowDto {
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

export interface StorageReportDto {
  usedBytes: number | null;
  growthBytes: number | null;
  objects: number | null;
  uploads: number;
  downloads: number;
  uploadedBytes: number;
  downloadedBytes: number;
  failedOps: number;
}

export interface StorageEventDto {
  id: string;
  at: string;
  type: StorageEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  runtime: string | null;
  tab: string | null;
}

export interface StorageSettingsDto {
  delete: boolean;
  download: boolean;
  signedUrl: boolean;
  preview: boolean;
  abortUpload: boolean;
  signedUrlMaxSec: number;
  largeObjectBytes: number;
  staleUploadMin: number;
}

export interface StorageOverviewDto {
  generatedAt: string;
  range: StorageRange;
  provider: ProviderInfo;
  environment: string;
  capabilities: StorageCapability[];
  health: StorageHealthDto;
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
  capacity: SectionDto<CapacityDto>;
  growth: GrowthDto;
  upload: TransferPerfDto;
  download: TransferPerfDto;
  operations: OperationRowDto[];
  topContainers: ContainerRowDto[];
  uploads: {
    active: number;
    completedPerMin: number | null;
    failed: number;
    stale: number | null;
    multipart: number | null;
  };
  alerts: StorageAlertDto[];
  relatedImpact: {
    apiP95Ms: { current: number | null; baseline: number | null; changePercent: number | null };
    queueWaiting: number | null;
  };
  report: { today: StorageReportDto; yesterday: StorageReportDto };
  events: StorageEventDto[];
  usageAt: string | null;
  usageTruncated: boolean;
  settings: StorageSettingsDto;
}

export interface StorageSeriesDto {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface StorageMetricsDto {
  metric: StorageMetric;
  range: StorageRange;
  resolutionSec: number | null;
  unit: string;
  series: StorageSeriesDto[];
}

export interface StorageTrafficDto {
  range: StorageRange;
  upload: TransferPerfDto;
  download: TransferPerfDto;
  operations: OperationRowDto[];
  /** Chỉ provider HTTP (S3): phân bố 2xx/4xx/5xx và mã lỗi hay gặp. */
  http: SectionDto<{
    classes: { cls: string; count: number; percent: number | null }[];
    topErrors: { code: string; count: number }[];
  }>;
  errorsByKind: Record<StorageErrorKind, number>;
}

export interface StorageUsageDto {
  usageAt: string | null;
  truncated: boolean;
  scannedObjects: number | null;
  totalObjects: number | null;
  usedBytes: number | null;
  capacity: SectionDto<CapacityDto>;
  growth: GrowthDto;
  history: { t: number; bytes: number; objects: number }[];
  byKind: { kind: ObjectKind; objects: number; bytes: number }[];
  byAge: { bucket: AgeBucket; objects: number; bytes: number }[];
  largest: (LargestObject & { large: boolean })[];
  largeObjectBytes: number;
}

export interface StorageContainersDto {
  containers: ContainerRowDto[];
  range: StorageRange;
  usageAt: string | null;
  truncated: boolean;
  location: string;
}

export interface ContainerDetailDto {
  container: ContainerRowDto;
  range: StorageRange;
  history: { t: number; bytes: number; objects: number }[];
  byKind: { kind: ObjectKind; objects: number; bytes: number }[];
  largest: (LargestObject & { large: boolean })[];
  recentErrors: StorageErrorDto[];
  traffic: { upload: StorageSeriesDto; download: StorageSeriesDto };
}

export interface ObjectRowDto {
  key: string;
  container: string;
  kind: ObjectKind;
  size: number;
  lastModified: string | null;
}

export interface StorageObjectsDto {
  objects: SectionDto<ObjectRowDto[]>;
  cursor: string;
  done: boolean;
  examined: number;
}

export interface ObjectDetailDto extends Omit<
  ObjectDetail,
  'lastModified' | 'createdAt' | 'versions' | 'retention'
> {
  lastModified: string | null;
  createdAt: string | null;
  versions:
    | {
        versionId: string;
        size: number;
        lastModified: string | null;
        isLatest: boolean;
        deleteMarker: boolean;
      }[]
    | null;
  retention: {
    mode: string | null;
    retainUntil: string | null;
    legalHold: boolean;
    active: boolean;
  } | null;
  large: boolean;
  sensitive: boolean;
  previewable: boolean;
  settings: StorageSettingsDto;
  capabilities: StorageCapability[];
}

export interface StorageUploadsDto {
  active: (ActiveUpload & { startedAtIso: string; ageSec: number; percent: number | null })[];
  multipart: SectionDto<
    (Omit<MultipartUpload, 'initiated'> & {
      initiated: string | null;
      ageMin: number | null;
      stale: boolean;
    })[]
  >;
  failedUploads: StorageErrorDto[];
  failedDownloads: StorageErrorDto[];
  completedPerMin: number | null;
  avgUploadMs: number | null;
  staleUploadMin: number;
  abortEnabled: boolean;
}

export interface StorageLifecycleDto {
  lifecycle: SectionDto<LifecycleInfo>;
  /** Ước tính từ snapshot usage: object khớp rule expire đã quá tuổi. */
  estimate:
    | {
        rule: string;
        prefix: string;
        days: number;
        objects: number;
        bytes: number;
        capped: boolean;
      }[]
    | null;
}

export interface StorageErrorDto {
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

export interface StorageErrorsDto {
  counts: Record<StorageErrorKind, number>;
  byOp: Record<StorageOp, number>;
  total: number;
  items: StorageErrorDto[];
  range: StorageRange;
}

export interface StorageOperationDto {
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

export interface StorageConfigDto {
  items: {
    key: string;
    value: string | number | boolean | null;
    sensitive?: boolean;
    group: string;
  }[];
}

export type StorageTestDto = StorageTestResult & { at: string };
