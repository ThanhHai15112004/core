import type { Section } from './database.types';

export type { Section };
export type CacheRange = '15m' | '1h' | '6h' | '24h';
export type CacheMetric = 'hitRate' | 'reads' | 'operations' | 'memory' | 'keys' | 'evictions';
export type CacheTab = 'overview' | 'namespaces' | 'keys' | 'memory' | 'ttl' | 'connections' | 'events' | 'operations' | 'configuration';
export type CacheHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'reconnecting' | 'unknown';
export type CacheSeverity = 'warning' | 'critical' | 'info';
export type CacheCapability = 'keyspace' | 'namespaces' | 'ttl' | 'memory' | 'keyExplorer' | 'valuePreview' | 'serverStats' | 'clients' | 'evictions';
export type TtlBucketId = 'lt1m' | '1to10m' | '10to60m' | '1to24h' | 'gt24h' | 'none';
export type CacheErrorKind = 'connection' | 'timeout' | 'command' | 'oom' | 'serialization';
export type CacheEventType =
  'connection_lost' | 'connection_recovered' | 'alert_started' | 'alert_recovered' | 'key_deleted' | 'namespace_cleared' | 'cache_flushed';
export type CacheOperationAction = 'delete_key' | 'clear_namespace' | 'flush_all';

export interface CacheAlert {
  id: string;
  rule: string;
  severity: CacheSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string;
  tab: CacheTab;
  namespace: string | null;
}

export interface CacheHealth {
  status: CacheHealthStatus;
  reasons: { code: string; message: string }[];
  state: 'connected' | 'connecting' | 'reconnecting' | 'unavailable';
  since: string;
  lastSuccessAt: string | null;
  pingMs: number | null;
  lastError: string | null;
}

export interface CacheMemoryKpi {
  cacheBytes: number | null;
  limitBytes: number | null;
  limitSource: 'maxmemory' | 'config' | null;
  percent: number | null;
}

export interface CacheKpis {
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
  memory: CacheMemoryKpi;
  evictionsPerMin: number | null;
  evictedInRange: number | null;
  expiredPerMin: number | null;
  connections: number | null;
  serverOpsPerSec: number | null;
}

export interface KeyspaceSummary {
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

export interface NamespaceRow {
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
  session: boolean;
  sensitive: boolean;
  alert: string | null;
}

export interface ImpactItem {
  current: number | null;
  baseline: number | null;
  changePercent: number | null;
  unit: string;
}

export interface CacheReport {
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

export interface CacheEvent {
  id: string;
  at: string;
  type: CacheEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  runtime: string | null;
  tab: CacheTab | null;
}

export interface ServerMemory {
  usedBytes: number | null;
  peakBytes: number | null;
  maxBytes: number | null;
  percent: number | null;
  policy: string | null;
  fragmentationRatio: number | null;
  rssBytes: number | null;
}

export interface CacheOverview {
  generatedAt: string;
  range: CacheRange;
  driver: 'redis' | 'memory';
  environment: string;
  capabilities: CacheCapability[];
  health: CacheHealth;
  kpis: CacheKpis;
  hitRate: {
    currentPercent: number | null;
    baselinePercent: number | null;
    changePoints: number | null;
    reads: number;
    status: 'normal' | 'low' | 'insufficient';
  };
  alerts: CacheAlert[];
  keyspace: KeyspaceSummary | null;
  topNamespaces: NamespaceRow[];
  server: Section<ServerMemory>;
  largestNamespace: { name: string; bytes: number } | null;
  relatedImpact: {
    dbQueriesPerSec: ImpactItem;
    apiP95Ms: ImpactItem;
    missRatePercent: ImpactItem;
    windowMin: number;
    baselineMin: number;
  };
  report: { today: CacheReport; yesterday: CacheReport };
  events: CacheEvent[];
  settings: {
    actionsEnabled: boolean;
    flushEnabled: boolean;
    valuePreview: boolean;
    largeKeyBytes: number;
    expirySpikeKeys: number;
    hitRateWarnPercent: number;
  };
}

export interface CacheSeries {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface CacheMetrics {
  metric: CacheMetric;
  range: CacheRange;
  resolutionSec: number | null;
  unit: string;
  series: CacheSeries[];
  serverWide: boolean;
}

export interface CacheNamespaces {
  keyspace: KeyspaceSummary | null;
  namespaces: NamespaceRow[];
  range: CacheRange;
  depth: number;
}

export interface LargeKey {
  key: string;
  namespace: string;
  bytes: number;
  type: string | null;
  ttlMs: number | null;
  large: boolean;
}

export interface NamespaceDetail {
  namespace: NamespaceRow;
  range: CacheRange;
  history: { keys: CacheSeries; bytes: CacheSeries; hits: CacheSeries; misses: CacheSeries };
  largestKeys: LargeKey[];
  actionsEnabled: boolean;
}

export interface KeyRow {
  key: string;
  namespace: string;
  type: string | null;
  bytes: number | null;
  ttlMs: number | null;
}

export interface CacheKeys {
  keys: Section<KeyRow[]>;
  cursor: string;
  done: boolean;
  examined: number;
  prefix: string;
}

export type ValueSample =
  | { kind: 'json'; value: unknown; truncated: boolean }
  | { kind: 'text'; value: string; truncated: boolean }
  | { kind: 'entries'; value: unknown; truncated: boolean; total: number | null };

export interface KeyDetail {
  key: string;
  fullKey: string;
  namespace: string;
  type: string;
  ttlMs: number | null;
  bytes: number | null;
  encoding: string | null;
  length: number | null;
  large: boolean;
  value: { state: 'shown'; sample: ValueSample; redacted: boolean } | { state: 'hidden'; reason: 'disabled' | 'sensitive' | 'unsupported' };
  actionsEnabled: boolean;
}

export interface CacheMemory {
  cacheBytes: number | null;
  bytesPartial: boolean;
  limit: CacheMemoryKpi;
  server: Section<ServerMemory>;
  byNamespace: { name: string; bytes: number; keys: number; percent: number | null }[];
  largestKeys: LargeKey[];
  evictions: Section<{ perMin: number | null; inRange: number | null; total: number | null; policy: string | null }>;
  scannedAt: string | null;
  largeKeyBytes: number;
}

export interface CacheTtl {
  keyspace: KeyspaceSummary | null;
  persistentByNamespace: { name: string; persistent: number; keys: number }[];
  expiringSoonByNamespace: { name: string; count: number }[];
  expiredPerMin: number | null;
  expirySpikeKeys: number;
}

export interface CacheClient {
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

export interface CacheClients {
  clients: Section<CacheClient[]>;
  byRuntime: { runtime: string; connections: number; blocked: number; bull: number }[];
  server: Section<{
    connectedClients: number | null;
    maxClients: number | null;
    percent: number | null;
    blockedClients: number | null;
    rejectedConnections: number | null;
  }>;
}

export interface CacheErrors {
  counts: Record<CacheErrorKind, number>;
  total: number;
  items: {
    at: string;
    kind: CacheErrorKind;
    operation: string;
    namespace: string;
    message: string;
    runtime: string | null;
    correlationId: string | null;
  }[];
  range: CacheRange;
}

export interface CacheOperation {
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

export interface FlushImpact {
  environment: string;
  keys: number | null;
  bytes: number | null;
  truncated: boolean;
  sessionKeys: number;
  sessionNamespaces: string[];
  flushEnabled: boolean;
  scannedAt: string | null;
}

export interface CacheConfig {
  items: { key: string; value: string | number | boolean | null; sensitive?: boolean; group: string }[];
}

export interface CachePing {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  state: string;
  at: string;
}

export interface KeyFilter {
  match: string;
  type: string;
  ttl: 'any' | 'persistent' | 'expiring' | 'lt1m';
  namespace: string;
}
