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
  since: string;
  tab: string;
  container: string | null;
}

export interface StorageHealthDto {
  status: StorageHealthStatus;
  reasons: { code: string; message: string }[];
  state: StorageConnectionState;
  lastSuccessAt: string | null;
  pingMs: number | null;
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
  /** Lỗi ghi nhận cho container trong khoảng (danh sách lỗi gần nhất). */
  errors: number;
  newest: string | null;
}

export interface StorageReportDto {
  usedBytes: number | null;
  growthBytes: number | null;
  objects: number | null;
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
  signedUrlMaxSec: number;
}

export interface StorageOverviewDto {
  range: StorageRange;
  provider: ProviderInfo;
  environment: string;
  capabilities: StorageCapability[];
  health: StorageHealthDto;
  kpis: {
    usedBytes: number | null;
    objects: number | null;
    objectsTruncated: boolean;
    failedOps: number;
    growthTodayBytes: number | null;
    containers: number | null;
  };
  capacity: SectionDto<CapacityDto>;
  growth: Pick<GrowthDto, 'createdToday' | 'd7Bytes'>;
  topContainers: ContainerRowDto[];
  uploads: {
    active: number;
    failed: number;
    stale: number | null;
  };
  alerts: StorageAlertDto[];
  report: { today: StorageReportDto; yesterday: StorageReportDto };
  usageAt: string | null;
  usageTruncated: boolean;
  settings: { largeObjectBytes: number };
}

export interface StorageUsageDto {
  usageAt: string | null;
  truncated: boolean;
  scannedObjects: number | null;
  totalObjects: number | null;
  growth: GrowthDto;
  history: { t: number; bytes: number; objects: number }[];
  byKind: { kind: ObjectKind; objects: number; bytes: number }[];
  byAge: { bucket: AgeBucket; objects: number; bytes: number }[];
  largest: (LargestObject & { large: boolean })[];
  largeObjectBytes: number;
}

export interface StorageContainersDto {
  containers: ContainerRowDto[];
  usageAt: string | null;
  truncated: boolean;
  location: string;
}

export interface ContainerDetailDto {
  container: ContainerRowDto;
  history: { t: number; bytes: number }[];
  byKind: { kind: ObjectKind; objects: number; bytes: number }[];
  largest: (LargestObject & { large: boolean })[];
  recentErrors: StorageErrorDto[];
}

export interface ObjectRowDto {
  key: string;
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
}

export interface StorageUploadsDto {
  active: (ActiveUpload & { ageSec: number; percent: number | null })[];
  multipart: SectionDto<
    (Omit<MultipartUpload, 'initiated'> & {
      initiated: string | null;
      ageMin: number | null;
      stale: boolean;
    })[]
  >;
  failedUploads: StorageErrorDto[];
  failedDownloads: StorageErrorDto[];
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
  items: StorageErrorDto[];
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

export type StorageTestDto = StorageTestResult;
