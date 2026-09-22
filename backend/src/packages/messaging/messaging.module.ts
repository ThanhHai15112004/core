import { Global, Module } from '@nestjs/common';
import { BaseMessagePublisherProvider } from './providers/message-publisher.provider.js';
import { QueueRegistry } from './providers/queue-registry.service.js';

@Global()
@Module({
  providers: [QueueRegistry, BaseMessagePublisherProvider],
  exports: [QueueRegistry, BaseMessagePublisherProvider],
})
export class MessagingModule {}
