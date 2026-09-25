import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { redactPayload } from '@packages/traffic/utils/capture.js';
import { HEALTHCHECK_QUEUE } from '../constants/messaging.keys.js';
import type {
  MessagingEventType,
  MessagingOperationAction,
  MessagingOperationRecord,
} from '../contracts/messaging-events.types.js';
import { MessagingConnectionService } from '../providers/messaging-connection.service.js';
import { MessagingMonitoringService } from '../monitoring/messaging-monitoring.service.js';
import type { MessageDetail, MessagingCapability } from '../monitoring/monitoring.types.js';
import { recordMessagingEvent, recordMessagingOperation } from '../utils/messaging-events.js';
import {
  MessageStateError,
  messagingErrorCode,
  sanitizeMessagingMessage,
} from '../utils/messaging-errors.js';

export type MessagingOperationErrorCode =
  | 'RETRY_DISABLED'
  | 'REPLAY_DISABLED'
  | 'DISCARD_DISABLED'
  | 'PAYLOAD_DISABLED'
  | 'UNSUPPORTED'
  | 'UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'FAILED';

export class MessagingOperationError extends Error {
  constructor(
    public readonly code: MessagingOperationErrorCode,
    message: string = code,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

export interface OperationContext {
  ip: string | null;
  actor: string | null;
}

export type BrokerTestStep = 'connect' | 'publish' | 'consume' | 'ack';

export interface MessagingTestResult {
  ok: boolean;
  steps: { step: BrokerTestStep; ok: boolean; ms: number | null; error: string | null }[];
  totalMs: number;
  roundTripMs: number | null;
  failedStep: BrokerTestStep | null;
}

export interface RedactedPayload {
  id: string;
  queue: string;
  channel: string;
  payload: unknown;
  redacted: boolean;
  size: number;
}

/** Chờ tối đa cho mỗi bước của Test Broker. */
export const TEST_STEP_TIMEOUT_MS = 5000;

const within = <T>(task: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    task,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

/**
 * Thao tác quản trị messaging: Test Broker (queue healthcheck riêng, không đụng message nghiệp vụ),
 * retry ngay message đang chờ retry, replay / discard message trong Dead Letter, xem payload đã che.
 * Mọi thao tác bật/tắt bằng env và ghi audit.
 */
@Injectable()
export class MessagingOperationsService {
  constructor(
    private readonly connection: MessagingConnectionService,
    private readonly monitoring: MessagingMonitoringService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  private get cfg() {
    return this.config.messaging;
  }

  private ensure(enabled: boolean, code: MessagingOperationErrorCode, cap: MessagingCapability) {
    if (!enabled) throw new MessagingOperationError(code);
    if (!this.monitoring.supports(cap)) throw new MessagingOperationError('UNSUPPORTED');
    if (!this.monitoring.usable()) throw new MessagingOperationError('UNAVAILABLE');
  }

  private async audit(
    action: MessagingOperationAction,
    target: string,
    ctx: OperationContext,
    started: number,
    detail: string | null,
    error: string | null,
    event?: { type: MessagingEventType; params: Record<string, string | number> },
  ): Promise<MessagingOperationRecord> {
    const record = await recordMessagingOperation(this.redis, {
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
    if (!error && event)
      await recordMessagingEvent(this.redis, {
        ...event,
        severity: 'warning',
        runtime: this.identity?.id ?? null,
      });
    return record;
  }

  // ─── Test Broker ──────────────────────────────────────────────────────────

  public async test(ctx: OperationContext): Promise<MessagingTestResult> {
    const started = performance.now();
    const steps: MessagingTestResult['steps'] = [];
    const step = async (name: BrokerTestStep, fn: () => Promise<void>) => {
      const t = performance.now();
      try {
        await fn();
        steps.push({
          step: name,
          ok: true,
          ms: Number((performance.now() - t).toFixed(1)),
          error: null,
        });
        return true;
      } catch (err) {
        const code = messagingErrorCode(err);
        steps.push({
          step: name,
          ok: false,
          ms: Number((performance.now() - t).toFixed(1)),
          error: `${code && code !== 'Error' ? `${code}: ` : ''}${sanitizeMessagingMessage(err)}`,
        });
        return false;
      }
    };

    const id = `hc-${randomUUID()}`;
    const opts = { connection: this.redis.bullConnection(), prefix: this.redis.bullPrefix() };
    let queue: Queue | null = null;
    let worker: Worker | null = null;
    let received!: () => void;
    let completed!: () => void;
    const receivedP = new Promise<void>((r) => (received = r));
    const completedP = new Promise<void>((r) => (completed = r));
    let publishedAt = 0;
    let roundTripMs: number | null = null;
    try {
      const ok =
        (await step('connect', async () => {
          await this.monitoring.provider.ping();
          queue = new Queue(HEALTHCHECK_QUEUE, opts);
          queue.on('error', () => undefined);
          worker = new Worker(
            HEALTHCHECK_QUEUE,
            async (job) => {
              if (job.id === id) received();
              return 'ok';
            },
            { ...opts, name: `${this.identity?.id ?? 'app'}-healthcheck`, autorun: true },
          );
          worker.on('error', () => undefined);
          worker.on('completed', (job) => job.id === id && completed());
          await within(worker.waitUntilReady(), TEST_STEP_TIMEOUT_MS, 'Connect');
        })) &&
        (await step('publish', async () => {
          publishedAt = performance.now();
          await within(
            queue!.add(
              'core.healthcheck',
              {
                id,
                topic: 'core.healthcheck',
                payload: { healthcheck: true },
                timestamp: new Date().toISOString(),
              },
              { jobId: id, removeOnComplete: true, removeOnFail: true, attempts: 1 },
            ),
            TEST_STEP_TIMEOUT_MS,
            'Publish',
          );
        })) &&
        (await step('consume', () => within(receivedP, TEST_STEP_TIMEOUT_MS, 'Consume'))) &&
        (await step('ack', async () => {
          await within(completedP, TEST_STEP_TIMEOUT_MS, 'Acknowledgement');
          roundTripMs = Number((performance.now() - publishedAt).toFixed(1));
        }));
      if (ok) this.connection.markSuccess(steps[0]?.ms ?? null);
      else await this.connection.check();
    } finally {
      const q = queue as Queue | null;
      const w = worker as Worker | null;
      await Promise.allSettled([w?.close(true), q?.remove(id).catch(() => undefined)]);
      await q?.close().catch(() => undefined);
    }
    const failed = steps.find((s) => !s.ok) ?? null;
    const result: MessagingTestResult = {
      ok: failed === null && steps.length === 4,
      steps,
      totalMs: Number((performance.now() - started).toFixed(1)),
      roundTripMs,
      failedStep: failed?.step ?? null,
    };
    await this.audit(
      'test',
      HEALTHCHECK_QUEUE,
      ctx,
      started,
      failed?.step ?? null,
      failed?.error ?? null,
    );
    return result;
  }

  // ─── Message actions ──────────────────────────────────────────────────────

  private async act(
    action: 'retry' | 'replay' | 'discard',
    queue: string,
    id: string,
    ctx: OperationContext,
    fn: () => Promise<void>,
    event: MessagingEventType,
  ): Promise<MessagingOperationRecord> {
    const started = performance.now();
    try {
      await fn();
    } catch (err) {
      if (err instanceof MessageStateError)
        throw err.code === 'NOT_FOUND'
          ? new MessagingOperationError('NOT_FOUND', id, { id })
          : new MessagingOperationError('INVALID_STATE', id, { id, state: err.state ?? '' });
      const message = sanitizeMessagingMessage(err);
      await this.audit(action, `${queue}/${id}`, ctx, started, null, message);
      throw new MessagingOperationError('FAILED', message);
    }
    this.monitoring.invalidate();
    return this.audit(action, `${queue}/${id}`, ctx, started, null, null, {
      type: event,
      params: { messageId: id, queue },
    });
  }

  /** Chạy ngay message đang chờ retry (bỏ qua thời gian backoff còn lại). */
  public async retryMessage(queue: string, id: string, ctx: OperationContext) {
    this.ensure(this.cfg.retry, 'RETRY_DISABLED', 'retry');
    return this.act(
      'retry',
      queue,
      id,
      ctx,
      () => this.monitoring.provider.retryNow(queue, id),
      'message_retried',
    );
  }

  /** Đưa message từ Dead Letter về hàng đợi — consumer sẽ chạy lại nghiệp vụ (cần idempotent). */
  public async replayDeadLetter(queue: string, id: string, ctx: OperationContext) {
    this.ensure(this.cfg.replay, 'REPLAY_DISABLED', 'replay');
    return this.act(
      'replay',
      queue,
      id,
      ctx,
      () => this.monitoring.provider.replay(queue, id),
      'message_replayed',
    );
  }

  /** Xoá vĩnh viễn một message trong Dead Letter. */
  public async discardDeadLetter(queue: string, id: string, ctx: OperationContext) {
    this.ensure(this.cfg.discard, 'DISCARD_DISABLED', 'discard');
    return this.act(
      'discard',
      queue,
      id,
      ctx,
      () => this.monitoring.provider.discard(queue, id),
      'message_discarded',
    );
  }

  /** Payload đã che field nhạy cảm (password, token, secret, thẻ…) + email; mỗi lần xem được ghi audit. */
  public async payload(
    id: string,
    queue: string | null,
    ctx: OperationContext,
  ): Promise<RedactedPayload> {
    this.ensure(this.cfg.payload, 'PAYLOAD_DISABLED', 'browse');
    const started = performance.now();
    let detail: MessageDetail | null;
    try {
      detail = await this.monitoring.provider.message(id, queue);
    } catch (err) {
      if (err instanceof MessageStateError)
        throw new MessagingOperationError('NOT_FOUND', id, { id });
      throw new MessagingOperationError('FAILED', sanitizeMessagingMessage(err));
    }
    if (!detail) throw new MessagingOperationError('NOT_FOUND', id, { id });
    const redactedPayload = redactPayload(detail.payload);
    await this.audit('payload', `${detail.queue}/${id}`, ctx, started, detail.channel, null);
    return {
      id,
      queue: detail.queue,
      channel: detail.channel,
      payload: redactedPayload,
      redacted: JSON.stringify(redactedPayload) !== JSON.stringify(detail.payload),
      size: detail.size,
    };
  }
}
