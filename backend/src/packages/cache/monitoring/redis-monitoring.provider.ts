import { performance } from 'node:perf_hooks';
import type { ChainableCommander } from 'ioredis';
import type { RedisService } from '@packages/redis/index.js';
import { cacheKeys } from '../constants/cache.keys.js';
import { escapeGlob } from '../drivers/redis-cache.driver.js';
import { namespaceOf, namespacePattern } from '../utils/namespace.js';
import { parseClientList, parseInfo, serverInfoFrom } from './redis-info.js';
import {
  toInt,
  type CacheCapability,
  type CacheClient,
  type CacheMonitoringProvider,
  type KeyFilter,
  type KeyPage,
  type KeyTypeInfo,
  type ScannedKey,
  type ServerInfo,
  type ValueSample,
} from './monitoring.types.js';

const SCAN_COUNT = 500;
const META_BATCH = 200;
/** Khi đã quét đủ `limit` key có metadata, vẫn đếm tiếp (rẻ hơn) tới `limit × COUNT_FACTOR`. */
const COUNT_FACTOR = 10;
/** Số lượt SCAN tối đa cho một trang của Key Explorer (lọc chặt thì trang có thể ít key hơn). */
const PAGE_MAX_ROUNDS = 10;
/**
 * COUNT của mỗi lượt SCAN trong Key Explorer: SCAN duyệt slot của cả DB (gồm key không phải cache),
 * MATCH lọc sau — COUNT lớn để một trang quét được nhiều hơn mà mỗi lệnh vẫn ngắn.
 */
const PAGE_SCAN_COUNT = 1000;
const BLOCKING =
  /^(b[lrz]pop|blmove|blmpop|bzmpop|brpoplpush|bzpop(min|max)|xread|xreadgroup|wait)/i;
const LENGTH_CMD: Record<string, 'strlen' | 'hlen' | 'llen' | 'scard' | 'zcard' | 'xlen'> = {
  string: 'strlen',
  hash: 'hlen',
  list: 'llen',
  set: 'scard',
  zset: 'zcard',
  stream: 'xlen',
};

/** Theo dõi cache Redis. Chỉ đọc, chỉ trong vùng `<prefix>cache:*`; không dùng KEYS, không CONFIG SET. */
export class RedisMonitoringProvider implements CacheMonitoringProvider {
  public readonly driver = 'redis' as const;
  public readonly capabilities: ReadonlySet<CacheCapability> = new Set<CacheCapability>([
    'keyspace',
    'namespaces',
    'ttl',
    'memory',
    'keyExplorer',
    'valuePreview',
    'serverStats',
    'clients',
    'evictions',
  ]);
  private readonly prefix: string;
  /** `MEMORY USAGE` không có (Redis quá cũ / bị chặn) → kích thước không đo được. */
  private memoryUsage: boolean | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly depth: number,
  ) {
    this.prefix = cacheKeys(redis).dataPrefix();
  }

  private get client() {
    return this.redis.client;
  }

  private strip(fullKey: string): string {
    return fullKey.slice(this.prefix.length);
  }

  private async memorySupported(sample: string): Promise<boolean> {
    if (this.memoryUsage !== null) return this.memoryUsage;
    try {
      await this.client.memory('USAGE', sample);
      this.memoryUsage = true;
    } catch {
      this.memoryUsage = false;
    }
    return this.memoryUsage;
  }

  /** PTTL (+ MEMORY USAGE, TYPE) cho một lô key bằng pipeline. */
  private async metadata(fullKeys: string[], withType: boolean): Promise<ScannedKey[]> {
    if (fullKeys.length === 0) return [];
    const memory = await this.memorySupported(fullKeys[0]!);
    const out: ScannedKey[] = [];
    for (let i = 0; i < fullKeys.length; i += META_BATCH) {
      const batch = fullKeys.slice(i, i + META_BATCH);
      const pipe: ChainableCommander = this.client.pipeline();
      for (const k of batch) {
        pipe.pttl(k);
        if (memory) pipe.memory('USAGE', k);
        if (withType) pipe.type(k);
      }
      const res = (await pipe.exec()) ?? [];
      const per = 1 + (memory ? 1 : 0) + (withType ? 1 : 0);
      batch.forEach((k, j) => {
        const row = res.slice(j * per, j * per + per);
        const pttl = toInt(row[0]?.[1]);
        // -2: key vừa hết hạn/bị xoá giữa SCAN và PTTL → bỏ qua.
        if (pttl === -2) return;
        out.push({
          key: this.strip(k),
          ttlMs: pttl === null || pttl < 0 ? null : pttl,
          bytes: memory ? toInt(row[1]?.[1]) : null,
          type: withType ? String(row[per - 1]?.[1] ?? '') || null : null,
        });
      });
    }
    return out;
  }

  public async scanAll(
    limit: number,
  ): Promise<{ keys: ScannedKey[]; total: number; truncated: boolean }> {
    const keys: ScannedKey[] = [];
    let cursor = '0';
    let total = 0;
    const countCap = limit * COUNT_FACTOR;
    do {
      const [next, batch] = await this.client.scan(
        cursor,
        'MATCH',
        `${escapeGlob(this.prefix)}*`,
        'COUNT',
        SCAN_COUNT,
      );
      cursor = next;
      const room = Math.max(0, limit - keys.length);
      if (room > 0) keys.push(...(await this.metadata(batch.slice(0, room), true)));
      total += batch.length;
    } while (cursor !== '0' && total < countCap);
    // SCAN có thể trả trùng key → total là ước lượng trên; khi quét hết thì dùng số đã có metadata.
    const complete = cursor === '0' && total <= limit;
    return {
      keys,
      total: complete ? keys.length : total,
      truncated: !complete,
    };
  }

  public async scanPage(filter: KeyFilter, cursor: string, count: number): Promise<KeyPage> {
    const pattern = filter.namespace
      ? namespacePattern(this.prefix, filter.namespace)
      : `${escapeGlob(this.prefix)}${filter.match || '*'}`;
    const found: ScannedKey[] = [];
    const seen = new Set<string>();
    let examined = 0;
    let rounds = 0;
    do {
      const [next, batch] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        Math.max(count, PAGE_SCAN_COUNT),
      );
      cursor = next;
      examined += batch.length;
      const fresh = batch.filter((k) => !seen.has(k) && k.startsWith(this.prefix));
      fresh.forEach((k) => seen.add(k));
      const meta = await this.metadata(fresh, true);
      for (const k of meta) {
        if (filter.namespace && namespaceOf(k.key, this.depth) !== filter.namespace) continue;
        if (filter.match && filter.namespace && !globMatch(filter.match, k.key)) continue;
        if (filter.type && k.type !== filter.type) continue;
        if (filter.ttl === 'persistent' && k.ttlMs !== null) continue;
        if (filter.ttl === 'expiring' && k.ttlMs === null) continue;
        if (filter.ttl === 'lt1m' && (k.ttlMs === null || k.ttlMs >= 60_000)) continue;
        found.push(k);
      }
      rounds++;
    } while (cursor !== '0' && found.length < count && rounds < PAGE_MAX_ROUNDS);
    return { keys: found, cursor, examined };
  }

  public async keyInfo(key: string): Promise<KeyTypeInfo | null> {
    const full = this.prefix + key;
    const type = await this.client.type(full);
    if (type === 'none') return null;
    const lengthCmd = LENGTH_CMD[type];
    const memory = await this.memorySupported(full);
    const pipe = this.client.pipeline();
    pipe.pttl(full);
    pipe.object('ENCODING', full);
    if (lengthCmd) pipe[lengthCmd](full);
    if (memory) pipe.memory('USAGE', full);
    const res = (await pipe.exec()) ?? [];
    const pttl = toInt(res[0]?.[1]);
    return {
      key,
      namespace: namespaceOf(key, this.depth),
      type,
      ttlMs: pttl === null || pttl < 0 ? null : pttl,
      encoding: typeof res[1]?.[1] === 'string' ? res[1][1] : null,
      length: lengthCmd ? toInt(res[2]?.[1]) : null,
      bytes: memory ? toInt(res[lengthCmd ? 3 : 2]?.[1]) : null,
    };
  }

  public async sample(
    key: string,
    maxBytes: number,
    maxItems: number,
  ): Promise<ValueSample | null> {
    const full = this.prefix + key;
    const type = await this.client.type(full);
    const last = maxItems - 1;
    switch (type) {
      case 'string': {
        const [raw, len] = await Promise.all([
          this.client.getrange(full, 0, maxBytes - 1),
          this.client.strlen(full),
        ]);
        const truncated = len > maxBytes;
        if (!truncated) {
          try {
            return { kind: 'json', value: JSON.parse(raw) as unknown, truncated };
          } catch {
            /* không phải JSON → text */
          }
        }
        return { kind: 'text', value: raw, truncated };
      }
      case 'hash': {
        const [, flat] = await this.client.hscan(full, '0', 'COUNT', maxItems);
        const value: Record<string, unknown> = {};
        for (let i = 0; i + 1 < flat.length && i / 2 < maxItems; i += 2)
          value[flat[i]!] = parseMaybeJson(flat[i + 1]!);
        const total = await this.client.hlen(full);
        return { kind: 'entries', value, truncated: total > maxItems, total };
      }
      case 'list': {
        const [items, total] = await Promise.all([
          this.client.lrange(full, 0, last),
          this.client.llen(full),
        ]);
        return {
          kind: 'entries',
          value: items.map(parseMaybeJson),
          truncated: total > maxItems,
          total,
        };
      }
      case 'set': {
        const [, items] = await this.client.sscan(full, '0', 'COUNT', maxItems);
        const total = await this.client.scard(full);
        return {
          kind: 'entries',
          value: items.slice(0, maxItems),
          truncated: total > maxItems,
          total,
        };
      }
      case 'zset': {
        const [items, total] = await Promise.all([
          this.client.zrange(full, 0, last, 'WITHSCORES'),
          this.client.zcard(full),
        ]);
        const pairs: { member: string; score: number }[] = [];
        for (let i = 0; i + 1 < items.length; i += 2)
          pairs.push({ member: items[i]!, score: Number(items[i + 1]) });
        return { kind: 'entries', value: pairs, truncated: total > maxItems, total };
      }
      case 'none':
        return null;
      default:
        return { kind: 'text', value: '', truncated: true };
    }
  }

  public async serverInfo(): Promise<ServerInfo> {
    const raw = await this.client.info();
    const config = await this.readConfig();
    return serverInfoFrom(parseInfo(raw), config, this.redis.db);
  }

  /** CONFIG GET có thể bị chặn (Redis managed) → bỏ qua; chỉ đọc, không bao giờ CONFIG SET. */
  private async readConfig() {
    const get = async (name: string) => {
      try {
        const res = (await this.client.config('GET', name)) as unknown as string[];
        return res?.[1] ?? null;
      } catch {
        return null;
      }
    };
    const [maxMemory, policy, maxClients] = await Promise.all([
      get('maxmemory'),
      get('maxmemory-policy'),
      get('maxclients'),
    ]);
    return { maxMemory: toInt(maxMemory), policy, maxClients: toInt(maxClients) };
  }

  /** Kết nối của core (tên `core-<runtime>`); kết nối của project khác không được liệt kê. */
  public async clients(): Promise<CacheClient[]> {
    const raw = (await this.client.client('LIST')) as unknown as string;
    return parseClientList(raw)
      .filter((c) => (c['name'] ?? '').startsWith('core-'))
      .map((c) => {
        const name = c['name'] ?? '';
        const bull = name.endsWith('-bull');
        const cmd = c['cmd'] ?? null;
        return {
          id: c['id'] ?? '',
          name,
          runtime: name.replace(/^core-/, '').replace(/-bull$/, '') || null,
          bull,
          addr: c['addr'] ?? null,
          ageSec: nonNegative(toInt(c['age'])),
          idleSec: nonNegative(toInt(c['idle'])),
          db: toInt(c['db']),
          command: cmd,
          // flag `b` = đang chờ lệnh blocking (BullMQ chờ job là bình thường).
          blocked: (c['flags'] ?? '').includes('b') || (cmd !== null && BLOCKING.test(cmd)),
        };
      });
  }

  public async ping(): Promise<number> {
    const started = performance.now();
    await this.client.ping();
    return Number((performance.now() - started).toFixed(2));
  }
}

/** Đồng hồ lệch (vd. WSL) có thể làm `idle`/`age` âm → coi là 0. */
const nonNegative = (n: number | null) => (n === null ? null : Math.max(0, n));

const parseMaybeJson = (s: string): unknown => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return s;
  }
};

/** Glob đơn giản (`*`, `?`) — dùng khi lọc thêm trong một namespace. */
export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  );
  return re.test(value);
}
