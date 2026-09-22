import { Injectable, Logger } from '@nestjs/common';
import type {
  MessageEnvelope,
  MessagePublisherContract,
} from '../contracts/message-publisher.contract.js';
import { QUEUES, type QueueName } from '../constants/queues.constant.js';
import { serializeMessage } from '../serializers/message.serializer.js';
import { QueueRegistry } from './queue-registry.service.js';

@Injectable()
export class BaseMessagePublisherProvider implements MessagePublisherContract {
  private readonly logger = new Logger(BaseMessagePublisherProvider.name);

  constructor(private readonly queues: QueueRegistry) {}

  public async publish<T>(
    topic: string,
    payload: T,
    queue: QueueName = QUEUES.SYSTEM_EVENTS,
  ): Promise<MessageEnvelope<T>> {
    const envelope = serializeMessage(topic, payload);
    await this.queues.withTimeout(
      this.queues.get(queue).add(topic, envelope, {
        jobId: envelope.id,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      }),
    );
    this.logger.log(`[EventPublished] ${queue}/${topic} ID:${envelope.id}`);
    return envelope;
  }
}
