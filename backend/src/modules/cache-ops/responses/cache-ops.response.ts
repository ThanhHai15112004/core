import type {
  CacheCapability,
  CacheConnectionState,
  CacheErrorKind,
  CacheEventType,
  CacheOperationAction,
  CacheSection,
  TtlBucketId,
  ValueSample,
} from '@packages/cache/index.js';

export type CacheRange = '15m' | '1h' | '6h' | '24h';
export type CacheMetric = 'hitRate' | 'reads' | 'operations' | 'memory' | 'keys' | 'evictions';
export type CacheSeverity = 'warning' | 'critical' | 'info';
export type CacheHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'reconnecting' | 'unknown';

export type SectionDto<T> = CacheSection<T>;

export interface CacheReasonDto {
  code: string;
  message: string;
}

export interface CacheAlertDto {
  id: string;
  rule: string;
  severity: CacheSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  /** ISO */
  since: string;
  tab: string;
  /** Namespace liên quan (cảnh báo theo namespace). */
  namespace: string | null;
}

export interface CacheHealthDto {
  status: CacheHealthStatus;
  reasons: CacheReasonDto[];
  state: CacheConnectionState;
  since: string;
  lastSuccessAt: string | null;
  pingMs: number | null;
  lastError: string | null;
}

/** Hit rate hiện tại (5 phút gần nhất) so với baseline (60 phút trước đó). */
export interface HitRateContextDto {
  currentPercent: number | null;
  baselinePercent: number | null;
  changePoints: number | null;
  reads: number;
  /** `insufficient` = chưa đủ lượt đọc để đánh giá. */
  status: 'normal' | 'low' | 'insufficient';
}

export interface ServerMemoryDto {
  usedBytes: number | null;
  peakBytes: number | null;
  maxBytes: number | null;
  percent: number | null;
  policy: string | null;
  fragmentationRatio: number | null;
  rssBytes: number | null;
}

export interface CacheMemoryKpiDto {
  /** Dung lượng của riêng cache core (MEMORY USAGE các key trong vùng cache). */
  cacheBytes: number | null;
  /** Hạn mức tính % : maxmemory của server hoặc CACHE_MEMORY_LIMIT_MB. */
  limitBytes: number | null;
  limitSource: 'maxmemory' | 'config' | null;
  /** % so với hạn mức (server used khi dùng maxmemory; cache bytes khi dùng hạn mức cấu hình). */
  percent: number | null;
}

export interface CacheKpisDto {
  hitRatePercent: number | null;
  missRatePercent: number | null;
  hits: number;
  misses: number;
  opsPerSec: number | null;
  getsPerSec: number | null;
  setsPerSec: number | null;
  deletesPerSec: number | null;
  avgOpMs: number | null;
  p95OpMs: number | null;
  errors: number;
  keys: number | null;
  keysTruncated: boolean;
  memory: CacheMemoryKpiDto;
  /** Toàn Redis server (dùng chung) — null với driver memory. */
  evictionsPerMin: number | null;
  evictedInRange: number | null;
  expiredPerMin: number | null;
  /** Kết nối của core (không tính project khác). */
  connections: number | null;
  serverOpsPerSec: number | null;
}

export interface KeyspaceSummaryDto {
  /** ISO — thời điểm quét. */
  at: string;
  totalKeys: number;
  scannedKeys: number;
  truncated: boolean;
  totalBytes: number;
  bytesPartial: boolean;
  persistent: number;
  expiring: number;
  avgTtlMs: number | null;
  expiringNext60s: number;
  ttlDistribution: Record<TtlBucketId, number>;
  durationMs: number;
}

export interface NamespaceRowDto {
  name: string;
  keys: number;
  bytes: number;
  persistent: number;
  avgTtlMs: number | null;
  expiringSoon: number;
  hits: number;
  misses: number;
  hitRatePercent: number | null;
  sets: number;
  /** Namespace chứa session (flush có thể đăng xuất user). */
  session: boolean;
  /** Value luôn ẩn. */
  sensitive: boolean;
  /** Có key/cảnh báo đáng chú ý. */
  alert: string | null;
}

export interface ImpactItemDto {
  current: number | null;
  baseline: number | null;
  changePercent: number | null;
  unit: string;
}

export interface RelatedImpactDto {
  dbQueriesPerSec: ImpactItemDto;
  apiP95Ms: ImpactItemDto;
  missRatePercent: ImpactItemDto;
  windowMin: number;
  baselineMin: number;
}

export interface CacheReportDto {
  hits: number;
  misses: number;
  hitRatePercent: number | null;
  sets: number;
  deletes: number;
  errors: number;
  peakMemoryBytes: number | null;
  evictions: number | null;
  expired: number | null;
  peakKeys: number | null;
}

export interface CacheEventDto {
  id: string;
  at: string;
  type: CacheEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  runtime: string | null;
  tab: string | null;
}

export interface CacheSettingsDto {
  actionsEnabled: boolean;
  flushEnabled: boolean;
  valuePreview: boolean;
  largeKeyBytes: number;
  expirySpikeKeys: number;
  hitRateWarnPercent: number;
}

export interface CacheOverviewDto {
  generatedAt: string;
  range: CacheRange;
  driver: string;
  environment: string;
  capabilities: CacheCapability[];
  health: CacheHealthDto;
  kpis: CacheKpisDto;
  hitRate: HitRateContextDto;
  alerts: CacheAlertDto[];
  keyspace: KeyspaceSummaryDto | null;
  topNamespaces: NamespaceRowDto[];
  server: SectionDto<ServerMemoryDto>;
  largestNamespace: { name: string; bytes: number } | null;
  relatedImpact: RelatedImpactDto;
  report: { today: CacheReportDto; yesterday: CacheReportDto };
  events: CacheEventDto[];
  settings: CacheSettingsDto;
}

export interface CacheSeriesDto {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface CacheMetricsDto {
  metric: CacheMetric;
  range: CacheRange;
  resolutionSec: number | null;
  unit: string;
  series: CacheSeriesDto[];
  /** Series lấy từ toàn Redis server (dùng chung). */
  serverWide: boolean;
}

export interface CacheNamespacesDto {
  keyspace: KeyspaceSummaryDto | null;
  namespaces: NamespaceRowDto[];
  range: CacheRange;
  depth: number;
}

export interface NamespaceDetailDto {
  namespace: NamespaceRowDto;
  range: CacheRange;
  history: {
    keys: CacheSeriesDto;
    bytes: CacheSeriesDto;
    hits: CacheSeriesDto;
    misses: CacheSeriesDto;
  };
  largestKeys: LargeKeyDto[];
  actionsEnabled: boolean;
}

export interface LargeKeyDto {
  key: string;
  namespace: string;
  bytes: number;
  type: string | null;
  ttlMs: number | null;
  large: boolean;
}

export interface KeyRowDto {
  key: string;
  namespace: string;
  type: string | null;
  bytes: number | null;
  ttlMs: number | null;
}

export interface CacheKeysDto {
  keys: SectionDto<KeyRowDto[]>;
  cursor: string;
  done: boolean;
  examined: number;
  prefix: string;
}

export interface KeyDetailDto {
  key: string;
  fullKey: string;
  namespace: string;
  type: string;
  ttlMs: number | null;
  bytes: number | null;
  encoding: string | null;
  length: number | null;
  large: boolean;
  value:
    | { state: 'shown'; sample: ValueSample; redacted: boolean }
    | { state: 'hidden'; reason: 'disabled' | 'sensitive' | 'unsupported' };
  actionsEnabled: boolean;
}

export interface CacheMemoryDto {
  cacheBytes: number | null;
  bytesPartial: boolean;
  limit: CacheMemoryKpiDto;
  server: SectionDto<ServerMemoryDto>;
  byNamespace: { name: string; bytes: number; keys: number; percent: number | null }[];
  largestKeys: LargeKeyDto[];
  evictions: SectionDto<{
    perMin: number | null;
    inRange: number | null;
    total: number | null;
    policy: string | null;
  }>;
  scannedAt: string | null;
  largeKeyBytes: number;
}

export interface CacheTtlDto {
  keyspace: KeyspaceSummaryDto | null;
  persistentByNamespace: { name: string; persistent: number; keys: number }[];
  expiringSoonByNamespace: { name: string; count: number }[];
  expiredPerMin: number | null;
  expirySpikeKeys: number;
}

export interface CacheClientDto {
  id: string;
  name: string;
  runtime: string | null;
  bull: boolean;
  addr: string | null;
  ageSec: number | null;
  idleSec: number | null;
  command: string | null;
  blocked: boolean;
}

export interface CacheClientsDto {
  clients: SectionDto<CacheClientDto[]>;
  byRuntime: { runtime: string; connections: number; blocked: number; bull: number }[];
  server: SectionDto<{
    connectedClients: number | null;
    maxClients: number | null;
    percent: number | null;
    blockedClients: number | null;
    rejectedConnections: number | null;
  }>;
}

export interface CacheErrorRecordDto {
  at: string;
  kind: CacheErrorKind;
  operation: string;
  namespace: string;
  message: string;
  runtime: string | null;
  correlationId: string | null;
}

export interface CacheErrorsDto {
  counts: Record<CacheErrorKind, number>;
  total: number;
  items: CacheErrorRecordDto[];
  range: CacheRange;
}

export interface CacheOperationDto {
  id: string;
  at: string;
  action: CacheOperationAction;
  target: string;
  result: 'success' | 'failed';
  affected: number;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

export interface FlushImpactDto {
  environment: string;
  keys: number | null;
  bytes: number | null;
  truncated: boolean;
  sessionKeys: number;
  sessionNamespaces: string[];
  flushEnabled: boolean;
  scannedAt: string | null;
}

export interface CacheConfigDto {
  items: {
    key: string;
    value: string | number | boolean | null;
    sensitive?: boolean;
    group: string;
  }[];
}

export interface PingResultDto {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  state: string;
  at: string;
}
