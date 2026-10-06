import type { CacheConfig } from '@packages/config/index.js';
import type { CacheConnectionState } from '@packages/cache/index.js';
import type { CacheSeverity } from '../responses/cache-ops.response.js';

export type CacheRule =
  | 'CACHE_UNAVAILABLE'
  | 'HIT_RATE_LOW'
  | 'MISS_STORM'
  | 'MEMORY_PRESSURE'
  | 'EVICTIONS'
  | 'REJECTED_CONNECTIONS'
  | 'CONNECTIONS_HIGH'
  | 'EXPIRY_SPIKE'
  | 'LARGE_KEY'
  | 'PERSISTENT_KEYS';

/** Tab của trang Cache để xử lý từng loại cảnh báo. */
export const RULE_TAB: Record<CacheRule, string> = {
  CACHE_UNAVAILABLE: 'overview',
  HIT_RATE_LOW: 'namespaces',
  MISS_STORM: 'namespaces',
  MEMORY_PRESSURE: 'memory',
  EVICTIONS: 'memory',
  REJECTED_CONNECTIONS: 'connections',
  CONNECTIONS_HIGH: 'connections',
  EXPIRY_SPIKE: 'ttl',
  LARGE_KEY: 'memory',
  PERSISTENT_KEYS: 'ttl',
};

export interface CacheRuleInput {
  connection: CacheConnectionState;
  /** Hit rate toàn Redis server từ lần tick trước (delta INFO) và baseline 60 phút trước đó (Prometheus). */
  hitRate: { current: number | null; baseline: number | null; reads: number };
  missRate: { current: number | null; baseline: number | null };
  memory: { percent: number | null };
  evictionsPerMin: number | null;
  rejectedDelta: number | null;
  connections: { used: number | null; max: number | null };
  expiringNext60s: number | null;
  largestKey: { key: string; bytes: number } | null;
  persistent: { keys: number; topNamespace: string | null } | null;
}

export type CacheRuleConfig = CacheConfig['rules'];

export interface CacheViolation {
  /** Khoá duy nhất (rule hoặc `rule:namespace`). */
  id: string;
  rule: CacheRule;
  severity: CacheSeverity;
  value: number;
  threshold: number;
  unit: string;
  namespace: string | null;
  /** Tham số thêm cho message (vd. tên key lớn, mức tăng DB). */
  extra: Record<string, string | number>;
}

const EVICTION_CRIT_PER_MIN = 100;
const HIT_RATE_CRIT_GAP = 20;

/** Rule cảnh báo cache theo ngưỡng cấu hình. Không đủ lượt đọc → không kết luận. */
export function evaluateCacheRules(input: CacheRuleInput, cfg: CacheRuleConfig): CacheViolation[] {
  const out: CacheViolation[] = [];
  const add = (
    rule: CacheRule,
    severity: CacheSeverity,
    value: number,
    threshold: number,
    unit: string,
    namespace: string | null = null,
    extra: Record<string, string | number> = {},
  ) =>
    out.push({
      id: namespace ? `${rule}:${namespace}` : rule,
      rule,
      severity,
      value: Number(value.toFixed(2)),
      threshold,
      unit,
      namespace,
      extra,
    });

  if (input.connection !== 'connected') {
    add('CACHE_UNAVAILABLE', 'critical', 0, 0, '');
    return out;
  }

  const enough = input.hitRate.reads >= cfg.minReads;
  const hr = input.hitRate.current;
  if (enough && hr !== null && hr < cfg.hitRateWarnPercent)
    add(
      'HIT_RATE_LOW',
      hr < cfg.hitRateWarnPercent - HIT_RATE_CRIT_GAP ? 'critical' : 'warning',
      hr,
      cfg.hitRateWarnPercent,
      '%',
    );

  // Miss tăng đột biến so với baseline (khác HIT_RATE_LOW là mức tuyệt đối).
  const { current: missNow, baseline: missBase } = input.missRate;
  if (
    enough &&
    missNow !== null &&
    missBase !== null &&
    missNow - missBase >= cfg.hitRateDropPoints
  ) {
    add('MISS_STORM', 'warning', missNow, missBase, '%');
  }

  const mem = input.memory.percent;
  if (mem !== null && mem >= cfg.memoryWarnPercent)
    add(
      'MEMORY_PRESSURE',
      mem >= cfg.memoryCritPercent ? 'critical' : 'warning',
      mem,
      mem >= cfg.memoryCritPercent ? cfg.memoryCritPercent : cfg.memoryWarnPercent,
      '%',
    );

  const ev = input.evictionsPerMin;
  if (ev !== null && ev > 0)
    add('EVICTIONS', ev >= EVICTION_CRIT_PER_MIN ? 'critical' : 'warning', ev, 0, '/min');

  if ((input.rejectedDelta ?? 0) > 0)
    add('REJECTED_CONNECTIONS', 'warning', input.rejectedDelta!, 0, '');

  const { used, max } = input.connections;
  if (used !== null && max) {
    const pct = (used / max) * 100;
    if (pct >= cfg.connectionWarnPercent)
      add(
        'CONNECTIONS_HIGH',
        pct >= 95 ? 'critical' : 'warning',
        pct,
        cfg.connectionWarnPercent,
        '%',
      );
  }

  if ((input.expiringNext60s ?? 0) >= cfg.expirySpikeKeys)
    add('EXPIRY_SPIKE', 'warning', input.expiringNext60s!, cfg.expirySpikeKeys, '');

  if (input.largestKey && input.largestKey.bytes >= cfg.largeKeyBytes)
    add('LARGE_KEY', 'warning', input.largestKey.bytes, cfg.largeKeyBytes, 'B', null, {
      key: input.largestKey.key,
    });

  // Key không TTL có thể là chủ ý → chỉ thông tin.
  if (input.persistent && input.persistent.keys > 0)
    add('PERSISTENT_KEYS', 'info', input.persistent.keys, 0, '', null, {
      namespace: input.persistent.topNamespace ?? '',
    });

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface StoredCacheAlert {
  rule: CacheRule;
  namespace: string | null;
  since: number;
  severity: CacheSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

/** So với cảnh báo đang lưu → bắt đầu / hồi phục; cảnh báo đang có được ghi lại với giá trị mới nhất. */
export function diffCacheAlerts(
  violations: readonly CacheViolation[],
  active: ReadonlyMap<string, StoredCacheAlert>,
  now: number,
) {
  const started = violations.filter((v) => !active.has(v.id));
  const set = new Map<string, StoredCacheAlert>(
    violations.map((v) => [
      v.id,
      {
        rule: v.rule,
        namespace: v.namespace,
        since: active.get(v.id)?.since ?? now,
        severity: v.severity,
        value: v.value,
        threshold: v.threshold,
        unit: v.unit,
        extra: v.extra,
      },
    ]),
  );
  const recovered = [...active.entries()]
    .filter(([id]) => !violations.some((v) => v.id === id))
    .map(([id, s]) => ({ id, alert: s, durationMs: now - s.since }));
  return { started, set, recovered };
}
