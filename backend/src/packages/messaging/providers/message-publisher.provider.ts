import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Counter } from 'prom-client';
import { RequestContextService } from '@packages/logging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import type {
  MessageEnvelope,
  MessagePublisherContract,
} from '../contracts/message-publisher.contract.js';
import type { JobMeta, JobSource, PublishOptions } from '../contracts/job-meta.types.js';
import { QUEUES, type QueueName } from '../constants/queues.constant.js';
import { serializeMessage } from '../serializers/message.serializer.js';
import { sanitizeMessagingMessage } from '../utils/messaging-errors.js';
import { MessagingConnectionService } from './messaging-connection.service.js';
import { QueueRegistry } from './queue-registry.service.js';

const MAX_INDEX_FIELDS = 10;

/** Giá trị index an toàn (bỏ khoảng trắng thừa, cắt ngắn). */
const indexValue = (v: string | number) => String(v).trim().slice(0, 200);

/** Nguồn tạo job theo context hiện tại (HTTP request / lần chạy Scheduler / job cha / CLI), không có → hệ thống. */
export function jobSourceOf(producer: string | null): JobSource {
  const src = RequestContextService.current()?.source;
  if (src) {
    const kind = src.kind === 'cli' ? 'manual' : src.kind;
    return { kind, id: src.id, name: src.name, detail: src.detail ?? null };
  }
  return { kind: producer === 'cli' ? 'manual' : 'system', id: null, name: producer, detail: null };
}

/**
 * Publisher mỏng trên BullMQ: dựng envelope (producer, correlation, meta), `queue.add` có timeout, đếm
 * `messages_published_total{queue,channel,result}` bằng prom-client. Không tự lưu lịch sử message.
 */
@Injectable()
export class BaseMessagePublisherProvider implements MessagePublisherContract {
  private readonly logger = new Logger(BaseMessagePublisherProvider.name);
  private readonly published: Counter<'queue' | 'channel' | 'result'> | undefined;

  constructor(
    private readonly queues: QueueRegistry,
    @Optional() metrics?: MetricsRegistryService,
    @Optional() private readonly connection?: MessagingConnectionService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {
    this.published = metrics?.counter('messages_published_total', 'Messages published', [
      'queue',
      'channel',
      'result',
    ]);
  }

  public async publish<T>(
    topic: string,
    payload: T,
    queue: QueueName = QUEUES.SYSTEM_EVENTS,
    options: PublishOptions = {},
  ): Promise<MessageEnvelope<T>> {
    const producer = this.identity?.id ?? null;
    const correlationId = RequestContextService.currentCorrelationId() ?? null;
    const envelope = serializeMessage(topic, payload, {
      producer,
      correlationId,
      job: this.meta(producer, options),
    });
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
      this.published?.inc({ queue, channel: topic, result: 'failed' });
      this.logger.warn(`Publish ${queue}/${topic} failed: ${sanitizeMessagingMessage(err)}`);
      throw err;
    }
    this.published?.inc({ queue, channel: topic, result: 'success' });
    this.connection?.markPublished();
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
}
