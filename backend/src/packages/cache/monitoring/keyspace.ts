import type { CacheDriverName } from '@packages/config/index.js';
import { namespaceOf } from '../utils/namespace.js';
import {
  TTL_BUCKETS,
  type KeyspaceSnapshot,
  type LargeKey,
  type NamespaceStat,
  type ScannedKey,
  type TtlBucketId,
} from './monitoring.types.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
export const LARGEST_KEYS_LIMIT = 20;
/** Số namespace tối đa trong snapshot (phần dư gộp vào `(other)`, sắp theo số key). */
export const SNAPSHOT_NAMESPACE_LIMIT = 200;

export function ttlBucketOf(ttlMs: number | null): TtlBucketId {
  if (ttlMs === null) return 'none';
  if (ttlMs < MIN) return 'lt1m';
  if (ttlMs < 10 * MIN) return '1to10m';
  if (ttlMs < HOUR) return '10to60m';
  if (ttlMs < 24 * HOUR) return '1to24h';
  return 'gt24h';
}

interface NsAcc {
  keys: number;
  bytes: number;
  persistent: number;
  ttlSum: number;
  ttlN: number;
  expiringSoon: number;
}

/** Gom danh sách key đã quét thành snapshot keyspace (namespace, TTL, key lớn nhất). */
export function buildKeyspaceSnapshot(input: {
  keys: readonly ScannedKey[];
  total: number;
  truncated: boolean;
  driver: CacheDriverName;
  depth: number;
  at: number;
  durationMs: number;
}): KeyspaceSnapshot {
  const distribution = Object.fromEntries(TTL_BUCKETS.map((b) => [b, 0])) as Record<
    TtlBucketId,
    number
  >;
  const byNs = new Map<string, NsAcc>();
  let totalBytes = 0;
  let bytesPartial = false;
  let ttlSum = 0;
  let ttlN = 0;
  let persistent = 0;
  let soon = 0;
  const largest: LargeKey[] = [];

  for (const k of input.keys) {
    const ns = namespaceOf(k.key, input.depth);
    const acc = byNs.get(ns) ?? {
      keys: 0,
      bytes: 0,
      persistent: 0,
      ttlSum: 0,
      ttlN: 0,
      expiringSoon: 0,
    };
    acc.keys++;
    if (k.bytes === null) bytesPartial = true;
    else {
      acc.bytes += k.bytes;
      totalBytes += k.bytes;
    }
    distribution[ttlBucketOf(k.ttlMs)]++;
    if (k.ttlMs === null) {
      acc.persistent++;
      persistent++;
    } else {
      acc.ttlSum += k.ttlMs;
      acc.ttlN++;
      ttlSum += k.ttlMs;
      ttlN++;
      if (k.ttlMs < MIN) {
        acc.expiringSoon++;
        soon++;
      }
    }
    byNs.set(ns, acc);
    if (k.bytes !== null) {
      largest.push({ key: k.key, namespace: ns, bytes: k.bytes, type: k.type, ttlMs: k.ttlMs });
      if (largest.length > LARGEST_KEYS_LIMIT * 4) {
        largest.sort((a, b) => b.bytes - a.bytes);
        largest.length = LARGEST_KEYS_LIMIT;
      }
    }
  }

  let namespaces: NamespaceStat[] = [...byNs.entries()]
    .map(([name, a]) => ({
      name,
      keys: a.keys,
      bytes: a.bytes,
      persistent: a.persistent,
      avgTtlMs: a.ttlN ? Math.round(a.ttlSum / a.ttlN) : null,
      expiringSoon: a.expiringSoon,
    }))
    .sort((a, b) => b.keys - a.keys || b.bytes - a.bytes);
  if (namespaces.length > SNAPSHOT_NAMESPACE_LIMIT) {
    const rest = namespaces.slice(SNAPSHOT_NAMESPACE_LIMIT - 1);
    const ttlKeys = rest.reduce((s, n) => s + (n.keys - n.persistent), 0);
    namespaces = [
      ...namespaces.slice(0, SNAPSHOT_NAMESPACE_LIMIT - 1),
      {
        name: '(other)',
        keys: rest.reduce((s, n) => s + n.keys, 0),
        bytes: rest.reduce((s, n) => s + n.bytes, 0),
        persistent: rest.reduce((s, n) => s + n.persistent, 0),
        avgTtlMs: ttlKeys
          ? Math.round(
              rest.reduce((s, n) => s + (n.avgTtlMs ?? 0) * (n.keys - n.persistent), 0) / ttlKeys,
            )
          : null,
        expiringSoon: rest.reduce((s, n) => s + n.expiringSoon, 0),
      },
    ];
  }

  return {
    at: input.at,
    driver: input.driver,
    totalKeys: input.total,
    scannedKeys: input.keys.length,
    truncated: input.truncated,
    totalBytes,
    bytesPartial,
    persistent,
    expiring: ttlN,
    avgTtlMs: ttlN ? Math.round(ttlSum / ttlN) : null,
    expiringNext60s: soon,
    ttlDistribution: distribution,
    namespaces,
    largestKeys: largest.sort((a, b) => b.bytes - a.bytes).slice(0, LARGEST_KEYS_LIMIT),
    durationMs: input.durationMs,
  };
}

/** Gộp snapshot của nhiều runtime (driver memory: mỗi process một cache). */
export function mergeKeyspaceSnapshots(
  list: readonly KeyspaceSnapshot[],
  at: number,
): KeyspaceSnapshot | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0]!;
  const ns = new Map<string, NamespaceStat & { ttlKeys: number }>();
  for (const s of list)
    for (const n of s.namespaces) {
      const acc = ns.get(n.name) ?? {
        ...n,
        keys: 0,
        bytes: 0,
        persistent: 0,
        expiringSoon: 0,
        avgTtlMs: null,
        ttlKeys: 0,
      };
      const ttlKeys = n.keys - n.persistent;
      const total = acc.ttlKeys + ttlKeys;
      acc.avgTtlMs =
        total > 0
          ? Math.round(((acc.avgTtlMs ?? 0) * acc.ttlKeys + (n.avgTtlMs ?? 0) * ttlKeys) / total)
          : null;
      acc.ttlKeys = total;
      acc.keys += n.keys;
      acc.bytes += n.bytes;
      acc.persistent += n.persistent;
      acc.expiringSoon += n.expiringSoon;
      ns.set(n.name, acc);
    }
  const sum = (f: (s: KeyspaceSnapshot) => number) => list.reduce((a, s) => a + f(s), 0);
  const expiring = sum((s) => s.expiring);
  return {
    at,
    driver: list[0]!.driver,
    totalKeys: sum((s) => s.totalKeys),
    scannedKeys: sum((s) => s.scannedKeys),
    truncated: list.some((s) => s.truncated),
    totalBytes: sum((s) => s.totalBytes),
    bytesPartial: list.some((s) => s.bytesPartial),
    persistent: sum((s) => s.persistent),
    expiring,
    avgTtlMs: expiring ? Math.round(sum((s) => (s.avgTtlMs ?? 0) * s.expiring) / expiring) : null,
    expiringNext60s: sum((s) => s.expiringNext60s),
    ttlDistribution: Object.fromEntries(
      TTL_BUCKETS.map((b) => [b, sum((s) => s.ttlDistribution[b])]),
    ) as Record<TtlBucketId, number>,
    namespaces: [...ns.values()].map(({ ttlKeys: _t, ...n }) => n).sort((a, b) => b.keys - a.keys),
    largestKeys: list
      .flatMap((s) => s.largestKeys)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, LARGEST_KEYS_LIMIT),
    durationMs: Math.max(...list.map((s) => s.durationMs)),
  };
}
