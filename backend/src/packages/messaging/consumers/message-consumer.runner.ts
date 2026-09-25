import { performance } from 'node:perf_hooks';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import type { MessageEnvelope } from '../contracts/message-publisher.contract.js';
import type { ConsumerRegistration } from '../contracts/messaging-events.types.js';
import { channelMetric, messagingKeys } from '../constants/messaging.keys.js';
import { parseEnvelope } from '../serializers/message.serializer.js';
import { ChannelTracker } from '../utils/channel-tracker.js';
import { logLifecycle } from '../utils/lifecycle.js';
import {
  MessageDeserializeError,
  classifyMessagingError,
  messagingErrorCode,
  sanitizeMessagingMessage,
} from '../utils/messaging-errors.js';
import {
  ErrorRateLimiter,
  recordMessagingError,
  recordMessagingEvent,
} from '../utils/messaging-events.js';

const PUBLISH_MS = 5000;
const REGISTRATION_TTL_SEC = 20;

export interface ConsumerDefinition {
  /** Tên consumer hiển thị (thường là tên processor). */
  consumer: string;
  queue: string;
  concurrency: number;
  /** Processor đảm bảo xử lý lặp lại an toàn (retry/replay không gây tác dụng phụ kép)? null = không rõ. */
  idempotent: boolean | null;
}

export type MessageHandler = (envelope: MessageEnvelope, job: Job) => Promise<unknown>;

/** Độ trễ trước lần thử kế tiếp theo option backoff của job (giống cách BullMQ tính). */
export function nextRetryDelay(job: Pick<Job, 'opts'>, attempt: number): number | null {
  const b = job.opts.backoff;
  if (b === undefined) return 0;
  if (typeof b === 'number') return b;
  const delay = b.delay ?? 0;
  if (b.type === 'fixed') return delay;
  if (b.type === 'exponential') return Math.round(2 ** (attempt - 1) * delay);
  return null;
}

/**
 * Chạy handler cho một message với instrumentation dùng chung: kiểm tra envelope, chạy trong correlation ID
 * của producer (log nối được), đo thời gian xử lý, đếm theo channel, ghi vòng đời vào job log, phân biệt
 * retry / Dead Letter, và báo consumer đang chạy lên Redis để trang Messaging biết ai đang tiêu thụ.
 */
@Injectable()
export class MessageConsumerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MessageConsumer');
  private readonly channels = new ChannelTracker();
  private readonly errors = new ErrorRateLimiter(5);
  private readonly deadLetterEvents = new ErrorRateLimiter(2);
  private readonly registrations = new Map<string, ConsumerRegistration>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly context: RequestContextService,
    @Optional() private readonly config?: CoreConfigService,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  private get runtime(): string | null {
    return this.identity?.id ?? null;
  }

  private get instance(): string {
    return this.recorder?.instance ?? this.runtime ?? 'app';
  }

  public onApplicationBootstrap(): void {
    if (this.config?.isTest) return;
    this.timer = setInterval(() => void this.publishRegistrations(), PUBLISH_MS);
    this.timer.unref();
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const def of [...this.registrations.values()]) await this.unregister(def.consumer);
  }

  /** Khai báo một consumer bắt đầu chạy trong runtime này. */
  public register(def: ConsumerDefinition): void {
    this.registrations.set(def.consumer, {
      consumer: def.consumer,
      queue: def.queue,
      runtime: this.runtime,
      instance: this.instance,
      concurrency: def.concurrency,
      paused: false,
      idempotent: def.idempotent,
      startedAt: Date.now(),
      inFlight: 0,
    });
    void this.publishRegistrations();
    void recordMessagingEvent(this.redis, {
      type: 'consumer_started',
      severity: 'info',
      params: { consumer: def.consumer, queue: def.queue, concurrency: def.concurrency },
      runtime: this.runtime,
    });
  }

  public setPaused(consumer: string, paused: boolean): void {
    const reg = this.registrations.get(consumer);
    if (reg) reg.paused = paused;
    void this.publishRegistrations();
  }

  public async unregister(consumer: string): Promise<void> {
    const reg = this.registrations.get(consumer);
    if (!reg) return;
    this.registrations.delete(consumer);
    await this.publishRegistrations();
    await recordMessagingEvent(this.redis, {
      type: 'consumer_stopped',
      severity: 'warning',
      params: { consumer, queue: reg.queue },
      runtime: this.runtime,
    });
  }

  public registrationsOf(): ConsumerRegistration[] {
    return [...this.registrations.values()];
  }

  public async process(consumer: string, job: Job, handler: MessageHandler): Promise<unknown> {
    const reg = this.registrations.get(consumer);
    const attempt = Math.max(1, job.attemptsStarted || job.attemptsMade + 1);
    const maxAttempts = Math.max(1, job.opts.attempts ?? 1);
    const envelope = parseEnvelope(job.data);
    const channel = this.channels.track(envelope?.topic ?? job.name);
    const base = { runtime: this.runtime, consumer, attempt };
    logLifecycle(job, 'received', base);
    if (reg) reg.inFlight++;
    const started = performance.now();
    try {
      if (!envelope)
        throw new MessageDeserializeError('Invalid message envelope (id/topic/payload)');
      const correlationId = envelope.correlationId ?? envelope.id;
      const result = await this.context.run({ correlationId, messageId: envelope.id }, () =>
        handler(envelope, job),
      );
      const ms = performance.now() - started;
      this.recorder?.count('msg.consumed');
      this.recorder?.count(channelMetric(channel, 'con'));
      this.recorder?.timing('msg.process', ms);
      this.recorder?.timing(channelMetric(channel, 'proc'), ms);
      if (attempt > 1) this.recorder?.count('msg.recovered');
      logLifecycle(job, 'completed', { ...base, ms: Number(ms.toFixed(1)) });
      return result;
    } catch (err) {
      const ms = performance.now() - started;
      const unrecoverable =
        err instanceof UnrecoverableError || err instanceof MessageDeserializeError;
      const final = unrecoverable || attempt >= maxAttempts;
      this.onFailure(job, envelope, channel, consumer, err, attempt, maxAttempts, final, ms);
      // Envelope hỏng: không retry (BullMQ đưa thẳng vào failed = Dead Letter).
      if (err instanceof MessageDeserializeError) throw new UnrecoverableError(err.message);
      throw err;
    } finally {
      if (reg) reg.inFlight = Math.max(0, reg.inFlight - 1);
    }
  }

  private onFailure(
    job: Job,
    envelope: MessageEnvelope | null,
    channel: string,
    consumer: string,
    err: unknown,
    attempt: number,
    maxAttempts: number,
    final: boolean,
    ms: number,
  ): void {
    const message = sanitizeMessagingMessage(err);
    const kind = classifyMessagingError(err, 'consume');
    const base = { runtime: this.runtime, consumer, attempt, error: message };
    this.recorder?.count('msg.consume.failed');
    this.recorder?.count(`msg.err.${kind}`);
    this.recorder?.count(channelMetric(channel, 'fail'));
    this.recorder?.timing('msg.process.failed', ms);
    logLifecycle(job, 'failed', { ...base, ms: Number(ms.toFixed(1)) });
    if (final) {
      this.recorder?.count('msg.dlq');
      this.recorder?.count(channelMetric(channel, 'dlq'));
      logLifecycle(job, 'dead_lettered', base);
      if (this.deadLetterEvents.allow())
        void recordMessagingEvent(this.redis, {
          type: 'dead_lettered',
          severity: 'warning',
          params: { messageId: String(job.id ?? ''), channel: job.name, error: message },
          runtime: this.runtime,
        });
    } else {
      this.recorder?.count('msg.retry');
      this.recorder?.count(channelMetric(channel, 'retry'));
      logLifecycle(job, 'retry_scheduled', { ...base, delayMs: nextRetryDelay(job, attempt) });
    }
    this.logger.warn(
      `Message ${job.id ?? '?'} (${job.name}) failed attempt ${attempt}/${maxAttempts}: ${message}`,
    );
    if (!this.errors.allow()) return;
    void recordMessagingError(this.redis, {
      at: Date.now(),
      stage: 'consume',
      kind,
      channel: job.name,
      queue: job.queueName,
      messageId: job.id ?? null,
      consumer,
      runtime: this.runtime,
      attempt,
      maxAttempts,
      final,
      code: messagingErrorCode(err),
      message,
      correlationId: envelope?.correlationId ?? envelope?.id ?? null,
    });
  }

  private async publishRegistrations(): Promise<void> {
    if (!this.redis?.isReady()) return;
    const key = messagingKeys(this.redis).consumers(this.instance);
    const list = this.registrationsOf();
    await (
      list.length
        ? this.redis.client.set(key, JSON.stringify(list), 'EX', REGISTRATION_TTL_SEC)
        : this.redis.client.del(key)
    ).catch(() => undefined);
  }
}
