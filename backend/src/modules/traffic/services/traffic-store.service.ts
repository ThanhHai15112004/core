import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  TRAFFIC_TIERS,
  trafficKeys,
  type ActiveSnapshot,
  type RequestDetail,
  type RequestSummary,
  type TrafficRoute,
  type TrafficTier,
} from '@packages/traffic/index.js';
import type { BucketAgg } from './traffic-aggregate.js';
import { parseBucketHash } from './traffic-aggregate.js';

/** Instance coi là còn sống nếu ghi trong khoảng này. */
const ACTIVE_INSTANCE_WINDOW_MS = 60_000;

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Đọc dữ liệu HTTP traffic từ Redis (chỉ đọc). */
@Injectable()
export class TrafficStoreService {
  private readonly keys: ReturnType<typeof trafficKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = trafficKeys(redis);
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** Instance đã ghi dữ liệu kể từ `sinceMs`. */
  public async instances(sinceMs: number): Promise<string[]> {
    return this.redis.client.zrangebyscore(this.keys.instances(), sinceMs, '+inf');
  }

  public async routes(): Promise<Map<string, TrafficRoute>> {
    const hash = await this.redis.client.hgetall(this.keys.routes());
    const map = new Map<string, TrafficRoute>();
    for (const [id, raw] of Object.entries(hash)) {
      const route = parseJson<TrafficRoute>(raw);
      if (route) map.set(id, route);
    }
    return map;
  }

  /**
   * Đọc các bucket trong [fromMs, toMs] của tầng `tier`, gộp các instance.
   * Bucket không có dữ liệu vẫn được trả về (rỗng) để biểu đồ có điểm 0 liên tục.
   */
  public async buckets(
    tier: TrafficTier,
    fromMs: number,
    toMs: number,
    instances: readonly string[],
  ): Promise<BucketAgg[]> {
    const { seconds } = TRAFFIC_TIERS[tier];
    const firstSec = Math.floor(fromMs / 1000 / seconds) * seconds;
    const lastSec = Math.floor(toMs / 1000 / seconds) * seconds;
    const buckets: BucketAgg[] = [];
    for (let s = firstSec; s <= lastSec; s += seconds) {
      buckets.push({ start: s * 1000, endpoints: new Map(), peak: 0 });
    }
    if (instances.length === 0 || buckets.length === 0) return buckets;

    const pipe = this.redis.client.pipeline();
    for (const b of buckets) {
      for (const instance of instances)
        pipe.hgetall(this.keys.bucket(tier, b.start / 1000, instance));
    }
    const results = (await pipe.exec()) ?? [];
    results.forEach(([err, hash], i) => {
      if (err || !hash) return;
      parseBucketHash(hash as Record<string, string>, buckets[Math.floor(i / instances.length)]!);
    });
    return buckets;
  }

  /** Log request, mới nhất trước theo thời điểm nhận (log được ghi theo thứ tự hoàn tất). */
  public async requestLog(): Promise<RequestSummary[]> {
    const raws = await this.redis.client.lrange(this.keys.requestLog(), 0, -1);
    return raws
      .map((r) => parseJson<RequestSummary>(r))
      .filter((r): r is RequestSummary => r !== null)
      .sort((a, b) => b.at - a.at);
  }

  public async latestRequest(): Promise<RequestSummary | null> {
    return parseJson<RequestSummary>(await this.redis.client.lindex(this.keys.requestLog(), 0));
  }

  public async requestDetail(id: string): Promise<RequestDetail | null> {
    return parseJson<RequestDetail>(await this.redis.client.get(this.keys.requestDetail(id)));
  }

  /** Request đang chạy của các instance còn sống. */
  public async active(now: number): Promise<ActiveSnapshot[]> {
    const instances = await this.instances(now - ACTIVE_INSTANCE_WINDOW_MS);
    if (instances.length === 0) return [];
    const raws = await this.redis.client.mget(...instances.map((i) => this.keys.active(i)));
    return raws
      .map((r) => parseJson<ActiveSnapshot>(r))
      .filter((s): s is ActiveSnapshot => s !== null);
  }
}
