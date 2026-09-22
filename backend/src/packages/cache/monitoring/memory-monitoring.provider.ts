import { performance } from 'node:perf_hooks';
import type { MemoryCacheDriver } from '../drivers/memory-cache.driver.js';
import { namespaceOf } from '../utils/namespace.js';
import { globMatch } from './redis-monitoring.provider.js';
import type {
  CacheCapability,
  CacheClient,
  CacheMonitoringProvider,
  KeyFilter,
  KeyPage,
  KeyTypeInfo,
  ScannedKey,
  ServerInfo,
  ValueSample,
} from './monitoring.types.js';

export class CacheCapabilityUnsupportedError extends Error {
  constructor(capability: string) {
    super(`Capability ${capability} is not supported by this cache driver`);
  }
}

const typeOf = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v;

/**
 * Theo dõi cache in-memory của process hiện tại. Không có số liệu server (memory giới hạn, eviction, client):
 * mỗi runtime có Map riêng — số liệu tổng hợp giữa runtime lấy từ snapshot mỗi runtime tự publish.
 */
export class MemoryMonitoringProvider implements CacheMonitoringProvider {
  public readonly driver = 'memory' as const;
  public readonly capabilities: ReadonlySet<CacheCapability> = new Set<CacheCapability>([
    'keyspace',
    'namespaces',
    'ttl',
    'memory',
    'keyExplorer',
    'valuePreview',
  ]);

  constructor(
    private readonly store: MemoryCacheDriver,
    private readonly depth: number,
  ) {}

  private scanned(now = Date.now()): ScannedKey[] {
    return this.store.entries(now).map(([key, e]) => ({
      key,
      ttlMs: e.expiresAt === null ? null : Math.max(0, e.expiresAt - now),
      bytes: e.bytes,
      type: typeOf(e.value),
    }));
  }

  public async scanAll(limit: number) {
    const all = this.scanned();
    return { keys: all.slice(0, limit), total: all.length, truncated: all.length > limit };
  }

  public async scanPage(filter: KeyFilter, cursor: string, count: number): Promise<KeyPage> {
    const offset = Number(cursor) || 0;
    const all = this.scanned().sort((a, b) => a.key.localeCompare(b.key));
    const matched = all.filter(
      (k) =>
        (!filter.match || globMatch(filter.match, k.key)) &&
        (!filter.namespace || namespaceOf(k.key, this.depth) === filter.namespace) &&
        (!filter.type || k.type === filter.type) &&
        (filter.ttl !== 'persistent' || k.ttlMs === null) &&
        (filter.ttl !== 'expiring' || k.ttlMs !== null) &&
        (filter.ttl !== 'lt1m' || (k.ttlMs !== null && k.ttlMs < 60_000)),
    );
    const page = matched.slice(offset, offset + count);
    const next = offset + count < matched.length ? String(offset + count) : '0';
    return { keys: page, cursor: next, examined: page.length };
  }

  public async keyInfo(key: string): Promise<KeyTypeInfo | null> {
    const e = this.store.entry(key);
    if (!e) return null;
    const length = Array.isArray(e.value)
      ? e.value.length
      : e.value && typeof e.value === 'object'
        ? Object.keys(e.value).length
        : typeof e.value === 'string'
          ? Buffer.byteLength(e.value, 'utf8')
          : null;
    return {
      key,
      namespace: namespaceOf(key, this.depth),
      type: typeOf(e.value),
      ttlMs: e.expiresAt === null ? null : Math.max(0, e.expiresAt - Date.now()),
      bytes: e.bytes,
      encoding: null,
      length,
    };
  }

  public async sample(key: string, maxBytes: number): Promise<ValueSample | null> {
    const e = this.store.entry(key);
    if (!e) return null;
    if (e.bytes <= maxBytes) return { kind: 'json', value: e.value, truncated: false };
    const text = JSON.stringify(e.value) ?? '';
    return { kind: 'text', value: text.slice(0, maxBytes), truncated: true };
  }

  public async serverInfo(): Promise<ServerInfo> {
    throw new CacheCapabilityUnsupportedError('serverStats');
  }

  public async clients(): Promise<CacheClient[]> {
    throw new CacheCapabilityUnsupportedError('clients');
  }

  public async ping(): Promise<number> {
    const started = performance.now();
    await this.store.has('__ping__');
    return Number((performance.now() - started).toFixed(3));
  }
}
