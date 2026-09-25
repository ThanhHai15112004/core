import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import type {
  MessageEnvelope,
  MessagePublisherContract,
} from '../contracts/message-publisher.contract.js';
import { QUEUES, type QueueName } from '../constants/queues.constant.js';
import { channelMetric, messagingKeys } from '../constants/messaging.keys.js';
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
  ) {}

  public async publish<T>(
    topic: string,
    payload: T,
    queue: QueueName = QUEUES.SYSTEM_EVENTS,
  ): Promise<MessageEnvelope<T>> {
    const producer = this.identity?.id ?? null;
    const correlationId = RequestContextService.currentCorrelationId() ?? null;
    const envelope = serializeMessage(topic, payload, { producer, correlationId });
    const channel = this.channels.track(topic);
    const started = performance.now();
    try {
      await this.queues.withTimeout(
        this.queues.get(queue).add(topic, envelope, this.queues.jobOptions(envelope.id)),
      );
    } catch (err) {
      this.fail(err, envelope, channel, queue, producer, correlationId);
      throw err;
    }
    const size = envelopeSize(envelope);
    this.recorder?.count('msg.published');
    this.recorder?.count(channelMetric(channel, 'pub'));
    this.recorder?.timing('msg.publish', performance.now() - started);
    this.recorder?.gauge('msg.size', size);
    this.recorder?.gauge(channelMetric(channel, 'size'), size);
    this.connection?.markPublished();
    this.register(channel, queue, producer);
    this.logger.log(`[EventPublished] ${queue}/${topic} ID:${envelope.id}`);
    return envelope;
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
