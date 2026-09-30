import { Global, Module } from '@nestjs/common';
import { QueueMonitoringService } from './monitoring/queue-monitoring.service.js';
import { QueueOperationsService } from './operations/queue-operations.service.js';
import { JobMonitoringService } from './monitoring/job-monitoring.service.js';
import { JobOperationsService } from './operations/job-operations.service.js';

const PROVIDERS = [
  QueueMonitoringService,
  QueueOperationsService,
  JobMonitoringService,
  JobOperationsService,
];

/**
 * Worker & Queue + Jobs: đọc số liệu công việc nền, thao tác queue, đọc / thao tác từng job (cần `MessagingModule` cho
 * QueueRegistry).
 */
@Global()
@Module({ providers: PROVIDERS, exports: PROVIDERS })
export class QueueModule {}
