import { Global, Module } from '@nestjs/common';
import { BaseMessagePublisherProvider } from './providers/message-publisher.provider.js';
import { QueueRegistry } from './providers/queue-registry.service.js';
import { MessagingConnectionService } from './providers/messaging-connection.service.js';
import { MessagingManageableAdapter } from './providers/messaging-manageable.adapter.js';
import { MessageConsumerRunner } from './consumers/message-consumer.runner.js';
import { MessagingMonitoringService } from './monitoring/messaging-monitoring.service.js';
import { MessagingOperationsService } from './operations/messaging-operations.service.js';

const PROVIDERS = [
  QueueRegistry,
  BaseMessagePublisherProvider,
  MessagingConnectionService,
  MessageConsumerRunner,
  MessagingMonitoringService,
  MessagingOperationsService,
  MessagingManageableAdapter,
];

@Global()
@Module({ providers: PROVIDERS, exports: PROVIDERS })
export class MessagingModule {}
