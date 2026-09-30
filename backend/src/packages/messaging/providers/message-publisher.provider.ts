import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import type {
  MessageEnvelope,
  MessagePublisherContract,
} from '../contracts/message-publisher.contract.js';
import type { JobMeta, JobSource, PublishOptions } from '../contracts/job-meta.types.js';
import { QUEUES, type QueueName } from '../constants/queues.constant.js';
import { JOB_INDEX_MAX, indexValue, jobKeys, jobRef } from '../constants/job.keys.js';
import { channelMetric, jobMetric, messagingKeys } from '../constants/messaging.keys.js';
import { ChannelTracker } from '../utils/channel-tracker.js';
import { envelopeSize, serializeMessage } from '../serializers/message.serializer.js';
import {
  classifyMessagingError,
  messagingErrorCode,
  sanitizeMessagingMessage,
} from '../utils/messaging-errors.js';
import { ErrorRateLimiter, recordMessagingError } from '../utils/messaging-events.js';
import { MessagingConnectionService } from './messaging-connection.service.js';
import { QueueRegistry } from './queue-registry.service.js';

/** Ghi registry channel/producer vào Redis tối đa mỗi chừng này cho mỗi cặp (không ghi mỗi lần publish). */
const REGISTRY_EVERY_MS = 10_000;
const MAX_INDEX_FIELDS = 10;
const DAY_SEC = 86_400;

/** Nguồn tạo job theo context hiện tại (HTTP request / lần chạy Scheduler / job cha / CLI), không có → hệ thống. */
export function jobSourceOf(producer: string | null): JobSource {
  const src = RequestContextService.current()?.source;
  if (src) {
    const kind = src.kind === 'cli' ? 'manual' : src.kind;
    return { kind, id: src.id, name: src.name, detail: src.detail ?? null };
  }
  return { kind: producer === 'cli' ? 'manual' : 'system', id: null, name: producer, detail: null };
}

@Injectable()
export class BaseMessagePublisherProvider implements MessagePublisherContract {
  private readonly logger = new Logger(BaseMessagePublisherProvider.name);
  private readonly channels = new ChannelTracker();
  private readonly registered = new Map<string, number>();
  private readonly errors = new ErrorRateLimiter(5);

  constructor(
    private readonly queues: QueueRegistry,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly connection?: MessagingConnectionService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
    @Optional() private readonly config?: CoreConfigService,
  ) {}

  public async publish<T>(
    topic: string,
    payload: T,
    queue: QueueName = QUEUES.SYSTEM_EVENTS,
    options: PublishOptions = {},
  ): Promise<MessageEnvelope<T>> {
    const producer = this.identity?.id ?? null;
    const correlationId = RequestContextService.currentCorrelationId() ?? null;
    const job = this.meta(producer, options);
    const envelope = serializeMessage(topic, payload, { producer, correlationId, job });
    const channel = this.channels.track(topic);
    const started = performance.now();
    const opts = {
      ...this.queues.jobOptions(envelope.id),
      ...(options.delayMs && options.delayMs > 0 ? { delay: Math.round(options.delayMs) } : {}),
      ...(options.priority && options.priority > 0
        ? { priority: Math.round(options.priority) }
        : {}),
    };
    try {
      await this.queues.withTimeout(this.queues.get(queue).add(topic, envelope, opts));
    } catch (err) {
      this.fail(err, envelope, channel, queue, producer, correlationId);
      throw err;
    }
    const size = envelopeSize(envelope);
    this.recorder?.count('msg.published');
    this.recorder?.count('wq.in');
    this.recorder?.count(jobMetric(queue, 'in'));
    this.recorder?.count(channelMetric(channel, 'pub'));
    this.recorder?.timing('msg.publish', performance.now() - started);
    this.recorder?.gauge('msg.size', size);
    this.recorder?.gauge(channelMetric(channel, 'size'), size);
    this.connection?.markPublished();
    this.register(channel, queue, producer);
    this.index(queue, envelope.id, correlationId, job);
    this.logger.log(`[EventPublished] ${queue}/${topic} ID:${envelope.id}`);
    return envelope;
  }

  private meta(producer: string | null, options: PublishOptions): JobMeta {
    const source = jobSourceOf(producer);
    const index: Record<string, string> = {};
    for (const [k, v] of Object.entries(options.index ?? {}).slice(0, MAX_INDEX_FIELDS)) {
      const key = k.trim().slice(0, 50);
      if (key && (typeof v === 'string' || typeof v === 'number')) index[key] = indexValue(v);
    }
    return {
      source,
      requestId: source.kind === 'http' ? source.id : null,
      idempotencyKey: options.idempotencyKey ? indexValue(options.idempotencyKey) : null,
      index,
      schema: options.schema ?? null,
    };
  }

  /**
   * Chỉ mục tra cứu job theo correlation / request / idempotency / scheduler execution / field nghiệp vụ, và danh sách
   * job con của job cha — để tìm job mà không quét payload. Có TTL; lỗi ghi không làm hỏng publish.
   */
  private index(queue: string, id: string, correlationId: string | null, meta: JobMeta): void {
    if (!this.redis?.isReady()) return;
    const keys = jobKeys(this.redis);
    const ttl = (this.config?.jobs.indexRetentionDays ?? 7) * DAY_SEC;
    const now = Date.now();
    const member = jobRef(queue, id);
    const targets: string[] = [];
    if (correlationId) targets.push(keys.index('corr', indexValue(correlationId)));
    if (meta.requestId) targets.push(keys.index('req', meta.requestId));
    if (meta.idempotencyKey) targets.push(keys.index('idem', meta.idempotencyKey));
    if (meta.source.kind === 'scheduler' && meta.source.id)
      targets.push(keys.index('exec', meta.source.id));
    for (const [k, v] of Object.entries(meta.index)) targets.push(keys.index(`e:${k}`, v));
    if (meta.source.kind === 'job' && meta.source.id) targets.push(keys.children(meta.source.id));
    if (!targets.length) return;
    const pipe = this.redis.client.pipeline();
    for (const key of targets) {
      pipe.zadd(key, now, member);
      pipe.zremrangebyrank(key, 0, -JOB_INDEX_MAX - 1);
      pipe.expire(key, ttl);
    }
    void pipe.exec().catch(() => undefined);
  }

  private fail(
    err: unknown,
    envelope: MessageEnvelope,
    channel: string,
    queue: string,
    producer: string | null,
    correlationId: string | null,
  ): void {
    this.recorder?.count('msg.publish.failed');
    this.recorder?.count(channelMetric(channel, 'pubfail'));
    const message = sanitizeMessagingMessage(err);
    this.logger.warn(`Publish ${queue}/${envelope.topic} failed: ${message}`);
    if (!this.errors.allow()) return;
    void recordMessagingError(this.redis, {
      at: Date.now(),
      stage: 'publish',
      kind: classifyMessagingError(err, 'publish'),
      channel: envelope.topic,
      queue,
      messageId: envelope.id,
      consumer: null,
      runtime: producer,
      attempt: null,
      maxAttempts: null,
      final: true,
      code: messagingErrorCode(err),
      message,
      correlationId,
    });
  }

  /** Channel → queue và producer nào đã publish (trang Messaging dùng để liệt kê channel/producer). */
  private register(channel: string, queue: string, producer: string | null): void {
    if (!this.redis?.isReady()) return;
    const field = `${producer ?? 'unknown'}:${channel}`;
    const now = Date.now();
    if (now - (this.registered.get(field) ?? 0) < REGISTRY_EVERY_MS) return;
    this.registered.set(field, now);
    void this.redis.client
      .hset(
        messagingKeys(this.redis).channels(),
        field,
        JSON.stringify({ queue, lastPublishedAt: now }),
      )
      .catch(() => undefined);
  }
}
