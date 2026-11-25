import { Injectable, Optional } from '@nestjs/common';
import {
  BaseMessagePublisherProvider,
  QUEUES,
  type QueueName,
} from '@packages/messaging/index.js';
import type { IOutboxTransport } from '../contracts/index.js';
import type {
  OutboxTransportDispatchInput,
  OutboxTransportDispatchResult,
} from '../types/outbox.types.js';

const VALID_QUEUES = new Set<string>(Object.values(QUEUES));

/**
 * Transport mặc định của Outbox: đẩy Domain Event Envelope chuẩn hóa ra BullMQ Queue
 * thông qua `BaseMessagePublisherProvider` (`@packages/messaging`).
 * Có thể thay thế bằng adapter Kafka / RabbitMQ / NATS thông qua token `OUTBOX_TRANSPORT_PORT`.
 */
@Injectable()
export class BullMqOutboxTransport implements IOutboxTransport {
  public readonly driverName = 'bullmq';

  constructor(
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
  ) {}

  public async dispatch(
    input: OutboxTransportDispatchInput,
  ): Promise<OutboxTransportDispatchResult> {
    if (!this.messagePublisher) {
      const err = new Error('Message publisher is not available for outbox dispatch') as Error & {
        code?: string;
      };
      err.code = 'BROKER_UNAVAILABLE';
      throw err;
    }

    if (!VALID_QUEUES.has(input.destinationQueue)) {
      const err = new Error(
        `Unknown outbox destination queue "${input.destinationQueue}"`,
      ) as Error & { code?: string; permanent?: boolean };
      err.code = 'UNKNOWN_DESTINATION_QUEUE';
      err.permanent = true;
      throw err;
    }

    const queue = input.destinationQueue as QueueName;
    const index: Record<string, string | number> = {
      outboxId: input.outboxId,
      eventId: input.event.id,
      eventType: input.event.type,
      sourceModule: input.event.metadata.sourceModule,
    };
    if (input.event.aggregateId) {
      index['aggregateId'] = input.event.aggregateId;
    }
    if (input.partitionKey) {
      index['partitionKey'] = input.partitionKey;
    }

    const envelope = await this.messagePublisher.publish(
      input.destinationTopic,
      {
        outboxId: input.outboxId,
        event: input.event,
        headers: input.headers,
        partitionKey: input.partitionKey,
      },
      queue,
      {
        idempotencyKey: `outbox:${input.event.id}`,
        index,
      },
    );

    return {
      brokerMessageId: envelope.id,
      queue,
      topic: input.destinationTopic,
    };
  }
}
