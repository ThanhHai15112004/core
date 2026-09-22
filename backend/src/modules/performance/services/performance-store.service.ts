import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  TELEMETRY_TIERS,
  parseMetricHash,
  telemetryKeys,
  type MetricBucket,
  type SlowQueryRecord,
  type TelemetryTier,
} from '@packages/telemetry/index.js';
import type { PerfSeverity, RuleKey } from '../responses/performance.response.js';

/** Sự kiện hiệu năng do Performance Monitor ghi (message dịch lúc đọc). */
export interface StoredPerfEvent {
  id: string;
  /** epoch ms */
  at: number;
  type: 'started' | 'escalated' | 'recovered';
  bottleneckId: string;
  rule: RuleKey;
  runtime: string | null;
  severity: PerfSeverity;
  value: number;
  threshold: number;
  unit: string;
  /** Chỉ có ở `recovered`. */
  durationMs?: number;
}

/** Nghẽn đang diễn ra — để biết bắt đầu từ lúc nào. */
export interface ActiveRuleState {
  since: number;
  severity: PerfSeverity;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Đọc/ghi dữ liệu hiệu năng trong Redis. */
@Injectable()
export class PerformanceStoreService {
  private readonly keys: ReturnType<typeof telemetryKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = telemetryKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  public get telemetryKeys() {
    return this.keys;
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public async instances(sinceMs: number): Promise<string[]> {
    return this.redis.client.zrangebyscore(this.keys.instances(), sinceMs, '+inf');
  }

  /** Các bucket trong [fromMs, toMs] của `tier`; bucket không có dữ liệu vẫn được trả về (rỗng). */
  public async buckets(
    tier: TelemetryTier,
    fromMs: number,
    toMs: number,
    instances: readonly string[],
  ): Promise<MetricBucket[]> {
    const { seconds } = TELEMETRY_TIERS[tier];
    const firstSec = Math.floor(fromMs / 1000 / seconds) * seconds;
    const lastSec = Math.floor(toMs / 1000 / seconds) * seconds;
    const buckets: MetricBucket[] = [];
    for (let s = firstSec; s <= lastSec; s += seconds) {
      buckets.push({ start: s * 1000, metrics: new Map(), byInstance: new Map() });
    }
    if (instances.length === 0 || buckets.length === 0) return buckets;

    const pipe = this.redis.client.pipeline();
    for (const b of buckets)
      for (const instance of instances)
        pipe.hgetall(this.keys.bucket(tier, b.start / 1000, instance));
    const results = (await pipe.exec()) ?? [];
    results.forEach(([err, hash], i) => {
      if (err || !hash || Object.keys(hash).length === 0) return;
      const instance = instances[i % instances.length]!;
      parseMetricHash(
        hash as Record<string, string>,
        instance,
        buckets[Math.floor(i / instances.length)]!,
      );
    });
    return buckets;
  }

  public async slowQueries(limit: number): Promise<SlowQueryRecord[]> {
    const raws = await this.redis.client.lrange(this.keys.slowQueries(), 0, limit - 1);
    return raws
      .map((r) => parseJson<SlowQueryRecord>(r))
      .filter((r): r is SlowQueryRecord => r !== null);
  }

  public async events(): Promise<StoredPerfEvent[]> {
    const raws = await this.redis.client.lrange(this.keys.events(), 0, -1);
    return raws
      .map((r) => parseJson<StoredPerfEvent>(r))
      .filter((e): e is StoredPerfEvent => e !== null);
  }

  public async activeRules(): Promise<Map<string, ActiveRuleState>> {
    const hash = await this.redis.client.hgetall(this.keys.activeRules());
    const map = new Map<string, ActiveRuleState>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = parseJson<ActiveRuleState>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }
}
