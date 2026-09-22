import type { CacheDriverName } from '@packages/config/index.js';

export type CacheCapability =
  | 'keyspace'
  | 'namespaces'
  | 'ttl'
  | 'memory'
  | 'keyExplorer'
  | 'valuePreview'
  | 'serverStats'
  | 'clients'
  | 'evictions';

/** Một phần số liệu: có dữ liệu, hoặc lý do không có (không làm hỏng cả trang). */
export type CacheSection<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

/** Metadata một key đã quét (key không có prefix). */
export interface ScannedKey {
  key: string;
  /** ms còn lại; null = không TTL. */
  ttlMs: number | null;
  /** null khi không đo được. */
  bytes: number | null;
  type: string | null;
}

export type TtlBucketId = 'lt1m' | '1to10m' | '10to60m' | '1to24h' | 'gt24h' | 'none';
export const TTL_BUCKETS: readonly TtlBucketId[] = [
  'lt1m',
  '1to10m',
  '10to60m',
  '1to24h',
  'gt24h',
  'none',
];

export interface NamespaceStat {
  name: string;
  keys: number;
  bytes: number;
  persistent: number;
  /** TTL trung bình của key có hết hạn (ms). */
  avgTtlMs: number | null;
  /** Số key hết hạn trong 60s tới. */
  expiringSoon: number;
}

export interface LargeKey {
  key: string;
  namespace: string;
  bytes: number;
  type: string | null;
  ttlMs: number | null;
}

/** Tổng hợp keyspace của cache tại một thời điểm. */
export interface KeyspaceSnapshot {
  /** epoch ms */
  at: number;
  driver: CacheDriverName;
  totalKeys: number;
  /** Số key đã quét (≤ totalKeys khi bị giới hạn). */
  scannedKeys: number;
  truncated: boolean;
  totalBytes: number;
  /** Có key không đo được kích thước. */
  bytesPartial: boolean;
  persistent: number;
  expiring: number;
  avgTtlMs: number | null;
  /** Key hết hạn trong 60s tới — dự báo expiration spike. */
  expiringNext60s: number;
  ttlDistribution: Record<TtlBucketId, number>;
  namespaces: NamespaceStat[];
  largestKeys: LargeKey[];
  durationMs: number;
}

export interface KeyTypeInfo {
  key: string;
  namespace: string;
  type: string;
  ttlMs: number | null;
  bytes: number | null;
  encoding: string | null;
  /** Độ dài: số byte (string) / số phần tử (hash, list, set, zset, stream). */
  length: number | null;
}

/** Mẫu value (chưa redact — tầng API sẽ redact trước khi trả ra). */
export type ValueSample =
  | { kind: 'json'; value: unknown; truncated: boolean }
  | { kind: 'text'; value: string; truncated: boolean }
  | { kind: 'entries'; value: unknown; truncated: boolean; total: number | null };

export interface KeyPage {
  keys: ScannedKey[];
  /** '0' = hết. */
  cursor: string;
  /** Số key đã duyệt qua ở lượt này (kể cả bị lọc). */
  examined: number;
}

export interface KeyFilter {
  /** glob tương đối vùng cache (vd. `user:*`); rỗng = tất cả. */
  match: string;
  type: string | null;
  ttl: 'any' | 'persistent' | 'expiring' | 'lt1m';
  namespace: string | null;
}

/** Số liệu Redis server (dùng chung với project khác nếu Redis dùng chung). */
export interface ServerInfo {
  version: string | null;
  mode: string | null;
  uptimeSec: number | null;
  usedMemory: number | null;
  peakMemory: number | null;
  maxMemory: number | null;
  maxMemoryPolicy: string | null;
  fragmentationRatio: number | null;
  rssMemory: number | null;
  connectedClients: number | null;
  maxClients: number | null;
  blockedClients: number | null;
  rejectedConnections: number | null;
  evictedKeys: number | null;
  expiredKeys: number | null;
  keyspaceHits: number | null;
  keyspaceMisses: number | null;
  opsPerSec: number | null;
  /** Số key theo DB (db0, db1…). */
  keyspace: { db: string; keys: number; expires: number }[];
  currentDb: number;
}

export interface CacheClient {
  id: string;
  name: string;
  runtime: string | null;
  /** client BullMQ (kết nối riêng của queue). */
  bull: boolean;
  addr: string | null;
  ageSec: number | null;
  idleSec: number | null;
  db: number | null;
  command: string | null;
  /** Đang chờ lệnh blocking (BZPOPMIN, BRPOPLPUSH…). */
  blocked: boolean;
}

export interface CacheMonitoringProvider {
  readonly driver: CacheDriverName;
  readonly capabilities: ReadonlySet<CacheCapability>;
  /** Quét toàn bộ (có giới hạn) để lập snapshot. */
  scanAll(limit: number): Promise<{ keys: ScannedKey[]; total: number; truncated: boolean }>;
  scanPage(filter: KeyFilter, cursor: string, count: number): Promise<KeyPage>;
  keyInfo(key: string): Promise<KeyTypeInfo | null>;
  sample(key: string, maxBytes: number, maxItems: number): Promise<ValueSample | null>;
  serverInfo(): Promise<ServerInfo>;
  clients(): Promise<CacheClient[]>;
  ping(): Promise<number>;
}

export const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
