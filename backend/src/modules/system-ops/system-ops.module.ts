import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PackageRegistryService } from './services/package-registry.service.js';
import { SystemOverviewService } from './services/system-overview.service.js';
import { OpsEventService } from './services/ops-event.service.js';
import { SystemOpsController } from './controllers/system-ops.controller.js';
import { HealthModule } from '@modules/health/index.js';
import { RuntimesModule } from '@modules/runtimes/index.js';
import { TrafficOpsModule } from '@modules/traffic/index.js';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { DatabaseOpsModule } from '@modules/database-ops/index.js';
import { CacheOpsModule } from '@modules/cache-ops/index.js';
import { StorageOpsModule } from '@modules/storage-ops/index.js';
import { MessagingOpsModule } from '@modules/messaging-ops/index.js';
import { WorkerOpsModule } from '@modules/worker-ops/index.js';
import { SchedulerOpsModule } from '@modules/scheduler-ops/index.js';
import { JobsOpsModule } from '@modules/jobs-ops/index.js';
import { LogsOpsModule } from '@modules/logs-ops/index.js';

@Module({
  imports: [
    DiscoveryModule,
    HealthModule,
    RuntimesModule,
    TrafficOpsModule,
    PerformanceOpsModule,
    DatabaseOpsModule,
    CacheOpsModule,
    StorageOpsModule,
    MessagingOpsModule,
    WorkerOpsModule,
    SchedulerOpsModule,
    JobsOpsModule,
    LogsOpsModule,
  ],
  controllers: [SystemOpsController],
  providers: [PackageRegistryService, SystemOverviewService, OpsEventService],
  exports: [
    PackageRegistryService,
    SystemOverviewService,
    OpsEventService,
    HealthModule,
    RuntimesModule,
    TrafficOpsModule,
    PerformanceOpsModule,
    DatabaseOpsModule,
    CacheOpsModule,
    StorageOpsModule,
    MessagingOpsModule,
    WorkerOpsModule,
    SchedulerOpsModule,
    JobsOpsModule,
    LogsOpsModule,
  ],
})
export class SystemOpsModule {}
