import { toInt, type ServerInfo } from './monitoring.types.js';

/** Parse output `INFO` (các dòng `field:value`, section bắt đầu bằng `#`). */
export function parseInfo(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
  }
  return map;
}

/** `keys=12,expires=3,...` → { keys: 12, expires: 3 } */
const parseKv = (s: string) =>
  Object.fromEntries(
    s.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k ?? '', Number(v)];
    }),
  ) as Record<string, number>;

export function serverInfoFrom(
  info: Map<string, string>,
  config: { maxMemory: number | null; policy: string | null; maxClients: number | null },
  currentDb: number,
): ServerInfo {
  const n = (k: string) => toInt(info.get(k));
  const keyspace: ServerInfo['keyspace'] = [];
  for (const [k, v] of info) {
    if (/^db\d+$/.test(k)) {
      const kv = parseKv(v);
      keyspace.push({ db: k, keys: kv['keys'] ?? 0, expires: kv['expires'] ?? 0 });
    }
  }
  const maxMemory = n('maxmemory') ?? config.maxMemory;
  return {
    version: info.get('redis_version') ?? null,
    mode: info.get('redis_mode') ?? null,
    uptimeSec: n('uptime_in_seconds'),
    usedMemory: n('used_memory'),
    peakMemory: n('used_memory_peak'),
    // maxmemory = 0 nghĩa là không giới hạn.
    maxMemory: maxMemory && maxMemory > 0 ? maxMemory : null,
    maxMemoryPolicy: info.get('maxmemory_policy') ?? config.policy,
    fragmentationRatio: n('mem_fragmentation_ratio'),
    rssMemory: n('used_memory_rss'),
    connectedClients: n('connected_clients'),
    maxClients: n('maxclients') ?? config.maxClients,
    blockedClients: n('blocked_clients'),
    rejectedConnections: n('rejected_connections'),
    evictedKeys: n('evicted_keys'),
    expiredKeys: n('expired_keys'),
    keyspaceHits: n('keyspace_hits'),
    keyspaceMisses: n('keyspace_misses'),
    opsPerSec: n('instantaneous_ops_per_sec'),
    keyspace,
    currentDb,
  };
}

/** Parse `CLIENT LIST` (mỗi dòng `k=v k=v …`). */
export function parseClientList(raw: string): Record<string, string>[] {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) =>
      Object.fromEntries(
        line.split(' ').map((kv) => {
          const i = kv.indexOf('=');
          return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
        }),
      ),
    );
}
