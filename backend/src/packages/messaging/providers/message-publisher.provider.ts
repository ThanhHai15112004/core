import { Injectable, Logger } from '@nestjs/common';
import type { MessagePublisherContract } from '../contracts/message-publisher.contract.js';
import { serializeMessage } from '../serializers/message.serializer.js';

@Injectable()
export class BaseMessagePublisherProvider implements MessagePublisherContract {
  private readonly logger = new Logger(BaseMessagePublisherProvider.name);

  public async publish<T>(topic: string, payload: T): Promise<void> {
    const envelope = serializeMessage(topic, payload);
    this.logger.log(`[EventPublished] ${envelope.topic} ID:${envelope.id}`);
  }
}
