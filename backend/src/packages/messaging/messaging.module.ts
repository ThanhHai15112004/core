import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RedisService } from '@packages/redis/index.js';
import { QUEUES } from './constants/queues.constant.js';
import { BaseMessagePublisherProvider } from './providers/message-publisher.provider.js';
import { QueueRegistry } from './providers/queue-registry.service.js';
import { MessagingConnectionService } from './providers/messaging-connection.service.js';
import { MessagingManageableAdapter } from './providers/messaging-manageable.adapter.js';
import { MessagingMonitoringService } from './monitoring/messaging-monitoring.service.js';
import { MessagingOperationsService } from './operations/messaging-operations.service.js';

const PROVIDERS = [
  QueueRegistry,
  BaseMessagePublisherProvider,
  MessagingConnectionService,
  MessagingMonitoringService,
  MessagingOperationsService,
  MessagingManageableAdapter,
];

/** Kết nối BullMQ dùng chung (`@nestjs/bullmq`) — mọi runtime import module này để publish / consume / quản trị. */
const BULL = [
  BullModule.forRootAsync({
    inject: [RedisService],
    useFactory: (redis: RedisService) => ({
      connection: redis.bullConnection(),
      prefix: redis.bullPrefix(),
    }),
  }),
  BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
];

@Global()
@Module({ imports: BULL, providers: PROVIDERS, exports: [...PROVIDERS, BullModule] })
export class MessagingModule {}
