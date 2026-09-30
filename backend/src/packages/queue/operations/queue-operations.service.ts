import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { sanitizeMessagingMessage } from '@packages/messaging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import type {
  QueueEventType,
  QueueOperationAction,
  QueueOperationRecord,
} from '../contracts/queue-events.types.js';
import type { QueueCapability } from '../contracts/queue-monitoring.types.js';
import { QueueMonitoringService } from '../monitoring/queue-monitoring.service.js';
import { QueueOperationError, type QueueOperationErrorCode } from '../utils/queue-errors.js';
import { recordQueueEvent, recordQueueOperation } from '../utils/queue-events.js';

export interface QueueOperationContext {
  ip: string | null;
  actor: string | null;
}

export interface QueueRetryResult {
  record: QueueOperationRecord;
  requested: number;
  retried: number;
}

/**
 * Thao tác vận hành queue: pause / resume (toàn cục trên broker — worker làm xong job đang chạy rồi ngừng lấy
 * job mới), retry hàng loạt job lỗi (có giới hạn mỗi lần), drain (xoá job đang chờ — nguy hiểm, mặc định tắt).
 * Mọi thao tác bật/tắt bằng env và ghi audit + sự kiện.
 */
@Injectable()
export class QueueOperationsService {
  constructor(
    private readonly monitoring: QueueMonitoringService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  private get cfg() {
    return this.config.queue;
  }

  private ensure(
    enabled: boolean,
    code: QueueOperationErrorCode,
    cap: QueueCapability,
    queue: string,
  ) {
    if (!enabled) throw new QueueOperationError(code);
    if (!this.monitoring.supports(cap)) throw new QueueOperationError('UNSUPPORTED');
    if (!this.monitoring.usable()) throw new QueueOperationError('UNAVAILABLE');
    if (!this.monitoring.provider.isKnown(queue))
      throw new QueueOperationError('NOT_FOUND', queue, { queue });
  }

  private async current(queue: string) {
    const all = await this.monitoring.provider.queues();
    const q = all.find((x) => x.name === queue);
    if (!q) throw new QueueOperationError('NOT_FOUND', queue, { queue });
    return q;
  }

  private async run(
    action: QueueOperationAction,
    queue: string,
    ctx: QueueOperationContext,
    detail: string | null,
    fn: () => Promise<void>,
    event: {
      type: QueueEventType;
      severity: 'info' | 'warning';
      params: Record<string, string | number>;
    },
  ): Promise<QueueOperationRecord> {
    const started = performance.now();
    try {
      await fn();
    } catch (err) {
      if (err instanceof QueueOperationError) throw err;
      const message = sanitizeMessagingMessage(err);
      await this.audit(action, queue, ctx, started, detail, message);
      throw new QueueOperationError('FAILED', message);
    }
    this.monitoring.invalidate();
    const record = await this.audit(action, queue, ctx, started, detail, null);
    await recordQueueEvent(this.redis, {
      type: event.type,
      severity: event.severity,
      params: { queue, ...event.params, ...(ctx.actor ? { actor: ctx.actor } : {}) },
      runtime: this.identity?.id ?? null,
    });
    return record;
  }

  private audit(
    action: QueueOperationAction,
    target: string,
    ctx: QueueOperationContext,
    started: number,
    detail: string | null,
    error: string | null,
  ): Promise<QueueOperationRecord> {
    return recordQueueOperation(this.redis, {
      at: Date.now(),
      action,
      target,
      result: error ? 'failed' : 'success',
      detail,
      durationMs: Number((performance.now() - started).toFixed(1)),
      actor: ctx.actor,
      ip: ctx.ip,
      error,
    });
  }

  /** Worker làm xong job đang chạy rồi ngừng lấy job mới; job mới vẫn được nhận vào queue. */
  public async pause(queue: string, ctx: QueueOperationContext): Promise<QueueOperationRecord> {
    this.ensure(this.cfg.pause, 'PAUSE_DISABLED', 'pause', queue);
    const q = await this.current(queue);
    if (q.paused) throw new QueueOperationError('INVALID_STATE', queue, { queue, state: 'paused' });
    return this.run(
      'pause',
      queue,
      ctx,
      `active=${q.counts.active}, waiting=${q.counts.waiting + q.counts.prioritized}`,
      () => this.monitoring.provider.pause(queue),
      {
        type: 'queue_paused',
        severity: 'warning',
        params: { waiting: q.counts.waiting + q.counts.prioritized, active: q.counts.active },
      },
    );
  }

  public async resume(queue: string, ctx: QueueOperationContext): Promise<QueueOperationRecord> {
    this.ensure(this.cfg.pause, 'PAUSE_DISABLED', 'pause', queue);
    const q = await this.current(queue);
    if (!q.paused)
      throw new QueueOperationError('INVALID_STATE', queue, { queue, state: 'running' });
    return this.run(
      'resume',
      queue,
      ctx,
      `waiting=${q.counts.waiting + q.counts.prioritized}`,
      () => this.monitoring.provider.resume(queue),
      {
        type: 'queue_resumed',
        severity: 'info',
        params: { waiting: q.counts.waiting + q.counts.prioritized },
      },
    );
  }

  /**
   * Đưa tối đa `count` job lỗi (cũ nhất trước) về hàng đợi. Worker sẽ chạy lại nghiệp vụ — processor cần
   * idempotent. Vượt `OPS_QUEUE_RETRY_FAILED_MAX` → từ chối (phải chia lô).
   */
  public async retryFailed(
    queue: string,
    count: number,
    ctx: QueueOperationContext,
  ): Promise<QueueRetryResult> {
    this.ensure(this.cfg.retryFailed, 'RETRY_DISABLED', 'retryFailed', queue);
    if (count > this.cfg.retryFailedMax)
      throw new QueueOperationError('TOO_MANY', queue, { max: this.cfg.retryFailedMax, count });
    const q = await this.current(queue);
    if (q.counts.failed === 0)
      throw new QueueOperationError('INVALID_STATE', queue, { queue, state: 'no_failed' });
    const requested = Math.min(count, q.counts.failed);
    let retried = 0;
    const record = await this.run(
      'retry_failed',
      queue,
      ctx,
      `requested=${requested}`,
      async () => {
        retried = await this.monitoring.provider.retryFailed(queue, requested);
      },
      { type: 'failed_retried', severity: 'warning', params: { count: requested } },
    );
    return { record, requested, retried };
  }

  /** Xoá job đang chờ (và delayed nếu chọn). Job đang chạy không bị ảnh hưởng. Không hoàn tác được. */
  public async drain(
    queue: string,
    includeDelayed: boolean,
    ctx: QueueOperationContext,
  ): Promise<QueueOperationRecord> {
    this.ensure(this.cfg.drain, 'DRAIN_DISABLED', 'drain', queue);
    const q = await this.current(queue);
    const waiting = q.counts.waiting + q.counts.prioritized;
    return this.run(
      'drain',
      queue,
      ctx,
      `waiting=${waiting}${includeDelayed ? `, delayed=${q.counts.delayed}` : ''}`,
      () => this.monitoring.provider.drain(queue, includeDelayed),
      {
        type: 'queue_drained',
        severity: 'warning',
        params: { waiting, delayed: includeDelayed ? q.counts.delayed : 0 },
      },
    );
  }
}
