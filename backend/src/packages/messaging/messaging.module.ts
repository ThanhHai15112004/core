import { Global, Module } from '@nestjs/common';
import { BaseMessagePublisherProvider } from './providers/message-publisher.provider.js';

@Global()
@Module({
  providers: [BaseMessagePublisherProvider],
  exports: [BaseMessagePublisherProvider],
})
export class MessagingModule {}
