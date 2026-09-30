import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  MessagingConnectionService,
  QueueRegistry,
  jobKeys,
  jobRef,
  parseJobRef,
  sanitizeMessagingMessage,
  type JobEventRecord,
  type JobOperationRecord,
} from '@packages/messaging/index.js';
import { BullMqJobProvider } from '../providers/bullmq-job.provider.js';
import type {
  CancelledJobRecord,
  JobCapability,
  JobDetailRaw,
  JobProvider,
  JobRecord,
} from '../contracts/job.types.js';
import type { QueueSection } from '../contracts/queue-monitoring.types.js';

const DAY_MS = 86_400_000;

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const parseList = <T>(raws: string[]) =>
  raws.map((r) => parseJson<T>(r)).filter((x): x is T => x !== null);

/**
 * Đọc job qua job provider (hiện tại: BullMQ) + dữ liệu Console giữ thêm trong Redis: bản ghi job đã huỷ khi còn chờ
 * (BullMQ xoá job), chỉ mục tìm kiếm, danh sách job con, sự kiện và audit. Chỉ đọc (trừ bản ghi huỷ).
 */
@Injectable()
export class JobMonitoringService {
  public readonly provider: JobProvider;
  public readonly keys: ReturnType<typeof jobKeys>;

  constructor(
    registry: QueueRegistry,
    private readonly connection: MessagingConnectionService,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
  ) {
    this.provider = new BullMqJobProvider(registry, redis);
    this.keys = jobKeys(redis);
  }

  public supports(cap: JobCapability): boolean {
    return this.provider.capabilities.has(cap);
  }

  public status() {
    return this.connection.getStatus();
  }

  public usable(): boolean {
    return this.status().state === 'connected';
  }

  public async section<T>(
    cap: JobCapability | null,
    fn: () => Promise<T>,
  ): Promise<QueueSection<T>> {
    if (cap && !this.supports(cap))
      return { available: false, reason: 'unsupported', message: 'BullMQ' };
    if (!this.usable())
      return { available: false, reason: 'disconnected', message: this.status().state };
    try {
      return { available: true, data: await fn() };
    } catch (err) {
      return { available: false, reason: 'error', message: sanitizeMessagingMessage(err) };
    }
  }

  // ─── Job đã huỷ khi còn chờ ───────────────────────────────────────────────

  public async tombstone(queue: string, id: string): Promise<CancelledJobRecord | null> {
    if (!this.redis.isReady()) return null;
    return parseJson<CancelledJobRecord>(
      await this.redis.client.get(this.keys.cancelled(queue, id)),
    );
  }

  private async findTombstone(id: string, queue?: string | null) {
    for (const q of queue ? [queue] : this.provider.queues()) {
      const t = await this.tombstone(q, id);
      if (t) return t;
    }
    return null;
  }

  public async saveTombstone(rec: CancelledJobRecord): Promise<void> {
    const ttl = this.config.jobs.cancelledRetentionDays * 86_400;
    const { queue, id } = rec.record;
    await this.redis.client
      .multi()
      .set(this.keys.cancelled(queue, id), JSON.stringify(rec), 'EX', ttl)
      .zadd(this.keys.cancelledIndex(), rec.cancelledAt, jobRef(queue, id))
      .exec();
  }

  public async removeTombstone(queue: string, id: string): Promise<void> {
    await this.redis.client
      .multi()
      .del(this.keys.cancelled(queue, id))
      .zrem(this.keys.cancelledIndex(), jobRef(queue, id))
      .exec();
  }

  /** Bản ghi huỷ, mới nhất trước (bỏ qua bản ghi đã hết hạn). */
  public async cancelled(offset: number, count: number, from = 0): Promise<CancelledJobRecord[]> {
    if (!this.redis.isReady() || count <= 0) return [];
    const refs = await this.redis.client.zrevrangebyscore(
      this.keys.cancelledIndex(),
      '+inf',
      from,
      'LIMIT',
      offset,
      count,
    );
    if (!refs.length) return [];
    const keys = refs
      .map(parseJobRef)
      .filter((r): r is { queue: string; id: string } => r !== null)
      .map((r) => this.keys.cancelled(r.queue, r.id));
    return parseList<CancelledJobRecord>(
      ((await this.redis.client.mget(keys)) ?? []).filter((x): x is string => x !== null),
    );
  }

  public async cancelledCount(from: number): Promise<number> {
    if (!this.redis.isReady()) return 0;
    return this.redis.client.zcount(this.keys.cancelledIndex(), from, '+inf');
  }

  public async pruneCancelled(now = Date.now()): Promise<void> {
    if (!this.redis.isReady()) return;
    const cutoff = now - this.config.jobs.cancelledRetentionDays * DAY_MS;
    await this.redis.client.zremrangebyscore(this.keys.cancelledIndex(), '-inf', cutoff);
  }

  // ─── Job theo ID / chỉ mục ────────────────────────────────────────────────

  public async get(id: string, queue?: string | null): Promise<JobRecord | null> {
    const found = await this.provider.get(id, queue);
    if (found) return found;
    const t = await this.findTombstone(id, queue);
    return t ? this.fromTombstone(t) : null;
  }

  public async detail(id: string, queue?: string | null): Promise<JobDetailRaw | null> {
    const found = await this.provider.detail(id, queue);
    if (found) {
      // Job huỷ khi đang chạy: người thao tác / lý do nằm ở bản ghi huỷ (nếu Console ghi).
      if (found.record.status === 'cancelled') {
        const t = await this.tombstone(found.record.queue, id);
        if (t) found.record.cancelledBy = t.actor;
      }
      return found;
    }
    const t = await this.findTombstone(id, queue);
    if (!t) return null;
    return {
      record: this.fromTombstone(t),
      lifecycle: [],
      logs: [],
      stacktrace: [],
      payload: undefined,
      returnValue: null,
      backoff: null,
      removeOnComplete: null,
      removeOnFail: null,
      malformed: false,
    };
  }

  private fromTombstone(t: CancelledJobRecord): JobRecord {
    return {
      ...t.record,
      status: 'cancelled',
      state: 'removed',
      heartbeat: null,
      progress: null,
      cancelledAt: t.cancelledAt,
      cancelledBy: t.actor,
      cancelReason: t.reason,
    };
  }

  /** `queue|id` trong một chỉ mục (mới nhất trước). */
  public async lookup(
    field: string,
    value: string,
    limit: number,
  ): Promise<{ queue: string; id: string }[]> {
    if (!this.redis.isReady()) return [];
    const refs = await this.redis.client.zrevrange(this.keys.index(field, value), 0, limit - 1);
    return refs.map(parseJobRef).filter((r): r is { queue: string; id: string } => r !== null);
  }

  public async children(id: string, limit: number): Promise<{ queue: string; id: string }[]> {
    if (!this.redis.isReady()) return [];
    const refs = await this.redis.client.zrange(this.keys.children(id), 0, limit - 1);
    return refs.map(parseJobRef).filter((r): r is { queue: string; id: string } => r !== null);
  }

  /** Đọc nhiều job theo tham chiếu (job đã bị dọn khỏi broker thì bỏ qua). */
  public async records(refs: { queue: string; id: string }[]): Promise<JobRecord[]> {
    const out = await Promise.all(
      refs
        .filter((r) => this.provider.isKnown(r.queue))
        .map((r) => this.get(r.id, r.queue).catch(() => null)),
    );
    return out.filter((r): r is JobRecord => r !== null);
  }

  // ─── Sự kiện / audit ──────────────────────────────────────────────────────

  public async events(): Promise<JobEventRecord[]> {
    if (!this.redis.isReady()) return [];
    return parseList<JobEventRecord>(await this.redis.client.lrange(this.keys.events(), 0, -1));
  }

  public async operations(): Promise<JobOperationRecord[]> {
    if (!this.redis.isReady()) return [];
    return parseList<JobOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }
}
