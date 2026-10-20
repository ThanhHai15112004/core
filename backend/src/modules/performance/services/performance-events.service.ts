import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { safeJsonParse as parse } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import type { PerfSeverity, RuleKey } from '../responses/performance.response.js';
import type { ActiveBottleneck } from './performance-rules.js';

/** Một lần chuyển trạng thái điểm nghẽn do Performance Monitor ghi. */
export interface StoredPerfEvent {
  id: string;
  at: number;
  type: 'started' | 'escalated' | 'recovered';
  bottleneckId: string;
  rule: RuleKey;
  runtime: string | null;
  severity: PerfSeverity;
  value: number;
  threshold: number;
  unit: string;
  durationMs?: number;
}

/** Lấy danh sách các khóa đo lường hiệu năng của hệ thống */
export const performanceKeys = (redis: RedisService) => ({
  /** LIST sự kiện nghẽn, mới nhất trước (giới hạn `PERF_EVENT_LOG_SIZE`). */
  events: () => redis.key('perf', 'events'),
  /** HASH id điểm nghẽn → trạng thái đang diễn ra. */
  active: () => redis.key('perf', 'active'),
  evaluateLock: () => redis.key('perf', 'lock', 'evaluate'),
});

/** Sự kiện và trạng thái điểm nghẽn trong Redis (key qua `REDIS_PREFIX`). */
@Injectable()
export class PerformanceEventsService {
  public readonly keys: ReturnType<typeof performanceKeys>;

  constructor(
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
  ) {
    this.keys = performanceKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  /** Kiểm tra dịch vụ hoặc kết nối có đang sẵn sàng hoạt động hay không */
  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public async events(): Promise<StoredPerfEvent[]> {
    if (!this.isAvailable()) return [];
    const raws = await this.redis.client.lrange(this.keys.events(), 0, -1).catch(() => []);
    return raws.map((r) => parse<StoredPerfEvent>(r)).filter((e): e is StoredPerfEvent => !!e);
  }

  /** Kiểm tra hoặc lọc các thành phần đang hoạt động */
  public async active(): Promise<Map<string, ActiveBottleneck>> {
    const map = new Map<string, ActiveBottleneck>();
    if (!this.isAvailable()) return map;
    const hash = await this.redis.client.hgetall(this.keys.active()).catch(() => ({}));
    for (const [id, raw] of Object.entries(hash)) {
      const state = parse<ActiveBottleneck>(raw as string);
      if (state) map.set(id, state);
    }
    return map;
  }

  /** Ghi trạng thái mới (thay toàn bộ) và các sự kiện chuyển trạng thái. */
  public async save(
    next: ReadonlyMap<string, ActiveBottleneck>,
    events: Omit<StoredPerfEvent, 'id'>[],
  ): Promise<void> {
    const pipe = this.redis.client.multi().del(this.keys.active());
    if (next.size)
      pipe.hset(
        this.keys.active(),
        Object.fromEntries([...next].map(([id, s]) => [id, JSON.stringify(s)])),
      );
    for (const e of events)
      pipe.lpush(
        this.keys.events(),
        JSON.stringify({ id: `pe_${randomBytes(6).toString('hex')}`, ...e }),
      );
    if (events.length) pipe.ltrim(this.keys.events(), 0, this.config.performance.eventLogSize - 1);
    await pipe.exec();
  }
}
