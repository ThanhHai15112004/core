import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { telemetryKeys } from '../constants/telemetry.keys.js';
import {
  METRIC_FIELD_SEPARATOR,
  TELEMETRY_TIERS,
  type TelemetryTier,
} from '../contracts/telemetry.types.js';
import { histogramIndex } from '../utils/latency-histogram.js';
import { TELEMETRY_INSTANCE } from './telemetry.tokens.js';

/** Giới hạn dữ liệu chờ ghi khi Redis tạm mất — không để RAM phình vô hạn. */
const MAX_PENDING_BUCKETS = 3000;
const TIER_ENTRIES = Object.entries(TELEMETRY_TIERS) as [
  TelemetryTier,
  (typeof TELEMETRY_TIERS)[TelemetryTier],
][];

interface PendingBucket {
  ttlSec: number;
  fields: Map<string, number>;
}

interface MaxEntry {
  key: string;
  field: string;
  value: number;
  ttlSec: number;
  bucketEndMs: number;
}

const field = (metric: string, agg: string) => `${metric}${METRIC_FIELD_SEPARATOR}${agg}`;

/**
 * Ghi số đo hiệu năng của process hiện tại theo bucket 10s/1m/1h (giống HTTP traffic) và flush vào Redis theo lô.
 * Mọi hàm ghi đều rẻ (chỉ cộng trong RAM) và là no-op khi tắt — gọi được từ đường nóng (query, cache).
 */
@Injectable()
export class MetricRecorder implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(MetricRecorder.name);
  private readonly keys: ReturnType<typeof telemetryKeys>;
  private pending = new Map<string, PendingBucket>();
  private readonly maxima = new Map<string, MaxEntry>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private lastFlushError: string | null = null;

  constructor(
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    @Optional() @Inject(TELEMETRY_INSTANCE) private readonly instanceId: string | null = null,
  ) {
    this.keys = telemetryKeys(redis);
  }

  public get enabled(): boolean {
    return this.config.performance.enabled && Boolean(this.instanceId);
  }

  public get instance(): string | null {
    return this.instanceId;
  }

  public onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.flush(), this.config.performance.flushMs);
    this.timer.unref();
  }

  public async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Cộng dồn (số job xong, số query lỗi, tổng ms GC…). */
  public count(metric: string, by = 1, at = Date.now()): void {
    if (!this.enabled || !Number.isFinite(by)) return;
    this.add(at, [[field(metric, 'c'), by]]);
  }

  /** Mẫu tức thời (CPU%, RSS, queue waiting…) — đọc ra trung bình và lớn nhất của bucket. */
  public gauge(metric: string, value: number, at = Date.now()): void {
    if (!this.enabled || !Number.isFinite(value)) return;
    this.add(
      at,
      [
        [field(metric, 'n'), 1],
        [field(metric, 's'), value],
      ],
      [metric, value],
    );
  }

  /** Thời gian thực hiện (ms) — thêm histogram để tính P50/P95/P99 gộp được giữa instance. */
  public timing(metric: string, ms: number, at = Date.now()): void {
    if (!this.enabled || !Number.isFinite(ms) || ms < 0) return;
    this.add(
      at,
      [
        [field(metric, 'n'), 1],
        [field(metric, 's'), ms],
        [field(metric, `h${histogramIndex(ms)}`), 1],
      ],
      [metric, ms],
    );
  }

  public getLastFlushError(): string | null {
    return this.lastFlushError;
  }

  /** Ghi toàn bộ dữ liệu đang chờ vào Redis bằng một pipeline. */
  public async flush(now = Date.now()): Promise<void> {
    if (!this.enabled || this.flushing) return;
    if (!this.redis.isReady()) {
      this.capPending();
      return;
    }
    this.flushing = true;
    const pending = this.pending;
    this.pending = new Map();

    const pipe = this.redis.client.pipeline();
    for (const [key, bucket] of pending) {
      for (const [f, value] of bucket.fields) {
        // Tổng giá trị là số thực; bộ đếm mẫu/ô histogram là số nguyên.
        if (f.endsWith(`${METRIC_FIELD_SEPARATOR}s`) || f.endsWith(`${METRIC_FIELD_SEPARATOR}c`))
          pipe.hincrbyfloat(key, f, Number(value.toFixed(3)));
        else pipe.hincrby(key, f, value);
      }
      pipe.expire(key, bucket.ttlSec);
    }
    for (const [id, m] of this.maxima) {
      pipe.hset(m.key, m.field, m.value);
      pipe.expire(m.key, m.ttlSec);
      if (m.bucketEndMs < now) this.maxima.delete(id);
    }
    pipe.zadd(this.keys.instances(), now, this.instanceId!);

    try {
      const results = (await pipe.exec()) ?? [];
      const failed = results.find(([err]) => err);
      if (failed?.[0]) throw failed[0];
      if (this.lastFlushError) this.logger.log('Performance telemetry flush recovered');
      this.lastFlushError = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== this.lastFlushError)
        this.logger.warn(`Performance telemetry flush failed: ${message}`);
      this.lastFlushError = message;
    } finally {
      this.flushing = false;
    }
  }

  private add(at: number, fields: [string, number][], max?: [string, number]): void {
    const atSec = Math.floor(at / 1000);
    for (const [tier, { seconds, ttlSec }] of TIER_ENTRIES) {
      const start = atSec - (atSec % seconds);
      const key = this.keys.bucket(tier, start, this.instanceId!);
      let bucket = this.pending.get(key);
      if (!bucket) {
        bucket = { ttlSec, fields: new Map() };
        this.pending.set(key, bucket);
      }
      for (const [f, v] of fields) bucket.fields.set(f, (bucket.fields.get(f) ?? 0) + v);

      if (max) {
        const maxField = field(max[0], 'x');
        const id = `${key}#${maxField}`;
        const current = this.maxima.get(id);
        if (!current || current.value < max[1]) {
          this.maxima.set(id, {
            key,
            field: maxField,
            value: max[1],
            ttlSec,
            bucketEndMs: (start + seconds) * 1000,
          });
        }
      }
    }
  }

  private capPending(): void {
    if (this.pending.size <= MAX_PENDING_BUCKETS) return;
    const overflow = this.pending.size - MAX_PENDING_BUCKETS;
    for (const key of [...this.pending.keys()].slice(0, overflow)) this.pending.delete(key);
  }
}
