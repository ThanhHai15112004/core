import { Global, Module } from '@nestjs/common';
import { QueueMonitoringService } from './monitoring/queue-monitoring.service.js';
import { QueueOperationsService } from './operations/queue-operations.service.js';

const PROVIDERS = [QueueMonitoringService, QueueOperationsService];

/** Worker & Queue: đọc số liệu công việc nền và thao tác queue (cần `MessagingModule` cho QueueRegistry). */
@Global()
@Module({ providers: PROVIDERS, exports: PROVIDERS })
export class QueueModule {}
