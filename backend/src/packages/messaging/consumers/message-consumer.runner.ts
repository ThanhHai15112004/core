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
import type { Redis } from 'ioredis';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import type { MessageEnvelope } from '../contracts/message-publisher.contract.js';
import type { ConsumerRegistration } from '../contracts/messaging-events.types.js';
import { channelMetric, jobMetric, messagingKeys } from '../constants/messaging.keys.js';
import { JOB_COMMAND_TTL_SEC, jobKeys } from '../constants/job.keys.js';
import type { JobCommand, JobCommandResult } from '../contracts/job-events.types.js';
import { recordJobEvent } from '../utils/job-events.js';
import { JOB_CANCELLED, classifyJobError, toUnrecoverable } from '../utils/job-error.js';
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
  /** Processor dừng khi nhận AbortSignal (huỷ hợp tác)? false → Console không cho huỷ job đang chạy. */
  cancellable?: boolean;
  /** Huỷ job đang chạy trong instance này (BullMQ `worker.cancelJob`) — true nếu job đang ở đây. */
  cancel?: (jobId: string, reason: string) => boolean;
}

export type MessageHandler = (
  envelope: MessageEnvelope,
  job: Job,
  signal?: AbortSignal,
) => Promise<unknown>;

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
  private readonly jobEvents = new ErrorRateLimiter(10);
  private readonly registrations = new Map<string, ConsumerRegistration>();
  private readonly cancellers = new Map<string, NonNullable<ConsumerDefinition['cancel']>>();
  private subscriber: Redis | null = null;
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
    await this.subscriber?.quit().catch(() => undefined);
    this.subscriber = null;
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
      cancellable: def.cancellable ?? false,
      startedAt: Date.now(),
      inFlight: 0,
    });
    if (def.cancel) {
      this.cancellers.set(def.consumer, def.cancel);
      void this.subscribe();
    }
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
    this.cancellers.delete(consumer);
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

  public async process(
    consumer: string,
    job: Job,
    handler: MessageHandler,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const reg = this.registrations.get(consumer);
    const attempt = Math.max(1, job.attemptsStarted || job.attemptsMade + 1);
    const maxAttempts = Math.max(1, job.opts.attempts ?? 1);
    const envelope = parseEnvelope(job.data);
    const channel = this.channels.track(envelope?.topic ?? job.name);
    const base = { runtime: this.runtime, consumer, attempt, instance: this.instance };
    logLifecycle(job, 'received', base);
    if (reg) reg.inFlight++;
    const queue = job.queueName;
    // Thời gian chờ trong queue (tạo job → worker nhận) — trang Worker & Queue. Chỉ lần thử đầu: các lần sau
    // `processedOn − timestamp` gộp cả thời gian xử lý trước đó và backoff.
    if (job.processedOn && attempt === 1) {
      const wait = Math.max(0, job.processedOn - job.timestamp);
      this.recorder?.timing('wq.wait', wait);
      this.recorder?.timing(jobMetric(queue, 'wait'), wait);
    }
    const started = performance.now();
    try {
      if (!envelope)
        throw new MessageDeserializeError('Invalid message envelope (id/topic/payload)');
      const correlationId = envelope.correlationId ?? envelope.id;
      const jobId = String(job.id ?? envelope.id);
      const result = await this.context.run(
        {
          correlationId,
          messageId: envelope.id,
          jobId,
          source: { kind: 'job', id: jobId, name: envelope.topic, detail: queue },
        },
        () => handler(envelope, job, signal),
      );
      const ms = performance.now() - started;
      this.recorder?.count('msg.consumed');
      this.recorder?.count(channelMetric(channel, 'con'));
      this.recorder?.timing('msg.process', ms);
      this.recorder?.timing(channelMetric(channel, 'proc'), ms);
      this.recorder?.count('wq.done');
      this.recorder?.count(jobMetric(queue, 'done'));
      this.recorder?.timing('wq.proc', ms);
      this.recorder?.timing(jobMetric(queue, 'proc'), ms);
      if (attempt > 1) {
        this.recorder?.count('msg.recovered');
        this.recorder?.count('wq.recovered');
        this.jobEvent(job, channel, 'job_recovered', 'success', { attempt });
      }
      logLifecycle(job, 'completed', { ...base, ms: Number(ms.toFixed(1)) });
      return result;
    } catch (err) {
      const ms = performance.now() - started;
      // Huỷ hợp tác từ Console: không retry, lưu lý do dạng `JobCancelled: …` (Jobs hiện trạng thái Cancelled).
      if (signal?.aborted) throw this.onCancelled(job, channel, base, signal, ms);
      const info = classifyJobError(err);
      const unrecoverable =
        err instanceof UnrecoverableError ||
        err instanceof MessageDeserializeError ||
        info.retryable === false;
      const final = unrecoverable || attempt >= maxAttempts;
      this.onFailure(job, envelope, channel, consumer, err, attempt, maxAttempts, final, ms, info);
      // Envelope hỏng / lỗi không retry được: BullMQ đưa thẳng vào failed (Dead Letter), không retry vô ích.
      if (unrecoverable && !(err instanceof UnrecoverableError)) throw toUnrecoverable(err, info);
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
    info: ReturnType<typeof classifyJobError>,
  ): void {
    const message = sanitizeMessagingMessage(err);
    const kind = classifyMessagingError(err, 'consume');
    const base = {
      runtime: this.runtime,
      consumer,
      attempt,
      error: message,
      instance: this.instance,
      errorType: info.type,
      retryable: info.retryable,
      dependency: info.dependency,
    };
    this.recorder?.count('msg.consume.failed');
    this.recorder?.count(`msg.err.${kind}`);
    this.recorder?.count(channelMetric(channel, 'fail'));
    this.recorder?.timing('msg.process.failed', ms);
    this.recorder?.count('wq.fail');
    this.recorder?.count(jobMetric(job.queueName, 'fail'));
    this.recorder?.count(final ? 'wq.exhausted' : 'wq.retry');
    this.recorder?.count(jobMetric(job.queueName, final ? 'exhausted' : 'retry'));
    logLifecycle(job, 'failed', { ...base, ms: Number(ms.toFixed(1)) });
    if (final) {
      this.recorder?.count('msg.dlq');
      this.recorder?.count(channelMetric(channel, 'dlq'));
      logLifecycle(job, 'dead_lettered', base);
      this.jobEvent(job, channel, 'job_failed', 'critical', {
        attempt,
        maxAttempts,
        error: info.type,
        ...(info.retryable === false ? { nonRetryable: 1 } : {}),
      });
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
      const delayMs = nextRetryDelay(job, attempt);
      logLifecycle(job, 'retry_scheduled', { ...base, delayMs });
      this.jobEvent(job, channel, 'job_retry_scheduled', 'warning', {
        attempt,
        maxAttempts,
        error: info.type,
        ...(delayMs !== null ? { delayMs } : {}),
      });
    }
    // Log có cấu trúc (trang Logs lọc theo job / message / correlation, gom nhóm lỗi theo loại lỗi + vị trí stack).
    const entry = {
      message: `Job ${job.name} ${final ? 'failed' : 'attempt failed, retry scheduled'}: ${message}`,
      jobId: String(job.id ?? ''),
      messageId: envelope?.id ?? String(job.id ?? ''),
      correlationId: envelope?.correlationId ?? envelope?.id,
      jobType: job.name,
      queue: job.queueName,
      attempt,
      maxAttempts,
      errorType: info.type,
      retryable: info.retryable,
      dependency: info.dependency,
      durationMs: Number(ms.toFixed(1)),
    };
    const stack = err instanceof Error ? err.stack : undefined;
    if (final) this.logger.error(entry, stack);
    else this.logger.warn(entry, stack);
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

  private onCancelled(
    job: Job,
    channel: string,
    base: { runtime: string | null; consumer: string; attempt: number; instance: string },
    signal: AbortSignal,
    ms: number,
  ): UnrecoverableError {
    const raw: unknown = signal.reason;
    const reason = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : 'cancelled';
    this.recorder?.count('wq.cancelled');
    this.recorder?.count(jobMetric(job.queueName, 'cancelled'));
    logLifecycle(job, 'cancelled', { ...base, ms: Number(ms.toFixed(1)), error: reason });
    this.jobEvent(job, channel, 'job_cancelled', 'warning', { running: 1 });
    this.logger.warn({
      message: `Job ${job.name} cancelled while running: ${reason}`,
      jobId: String(job.id ?? ''),
      jobType: job.name,
      queue: job.queueName,
      durationMs: Number(ms.toFixed(1)),
    });
    return new UnrecoverableError(`${JOB_CANCELLED}: ${reason}`);
  }

  /** Worker phát hiện job mất khoá (stalled) — BullMQ đưa lại về hàng đợi. */
  public onStalled(queue: string, jobId: string): void {
    this.recorder?.count('wq.stalled');
    this.recorder?.count(jobMetric(queue, 'stalled'));
    if (!this.jobEvents.allow()) return;
    void recordJobEvent(this.redis, {
      type: 'job_stalled',
      severity: 'warning',
      jobId,
      queue,
      jobType: null,
      params: { detector: 'worker' },
      runtime: this.runtime,
    });
  }

  private jobEvent(
    job: Job,
    channel: string,
    type: 'job_failed' | 'job_retry_scheduled' | 'job_recovered' | 'job_cancelled',
    severity: 'info' | 'warning' | 'critical' | 'success',
    params: Record<string, string | number>,
  ): void {
    if (!this.jobEvents.allow()) return;
    void recordJobEvent(this.redis, {
      type,
      severity,
      jobId: String(job.id ?? ''),
      queue: job.queueName,
      jobType: channel,
      params,
      runtime: this.runtime,
    });
  }

  /** Lệnh huỷ job đang chạy từ Console (pub/sub): instance nào đang giữ job thì abort và trả lời. */
  private async subscribe(): Promise<void> {
    if (this.subscriber || !this.redis || this.config?.isTest) return;
    const redis = this.redis;
    const channel = jobKeys(redis).commandChannel();
    const subscriber = redis.createSubscriber();
    this.subscriber = subscriber;
    subscriber.on('message', (ch: string, raw: string) => {
      if (ch !== channel) return;
      try {
        void this.handleCommand(JSON.parse(raw) as JobCommand);
      } catch {
        this.logger.warn(`Ignored malformed job command: ${raw}`);
      }
    });
    await subscriber.subscribe(channel).catch(() => undefined);
  }

  public async handleCommand(cmd: JobCommand): Promise<boolean> {
    if (cmd.action !== 'cancel') return false;
    let ok = false;
    for (const [consumer, cancel] of this.cancellers) {
      if (this.registrations.get(consumer)?.queue !== cmd.queue) continue;
      if (cancel(cmd.jobId, cmd.reason)) ok = true;
    }
    if (!ok || !this.redis?.isReady()) return ok;
    const result: JobCommandResult = {
      id: cmd.id,
      status: 'accepted',
      instance: this.instance,
      at: Date.now(),
    };
    await this.redis.client
      .set(
        jobKeys(this.redis).commandResult(cmd.id),
        JSON.stringify(result),
        'EX',
        JOB_COMMAND_TTL_SEC,
      )
      .catch(() => undefined);
    return true;
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
