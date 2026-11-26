import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PackageRegistryService } from './services/package-registry.service.js';
import { SystemInfoService } from './services/system-info.service.js';
import { SystemOverviewService } from './services/system-overview.service.js';
import { OpsEventService } from './services/ops-event.service.js';
import { SystemOpsController } from './controllers/system-ops.controller.js';
import { HealthModule } from '@modules/health/index.js';
import { RuntimesModule } from '@modules/runtimes/index.js';
import { TrafficModule } from '@modules/traffic/index.js';
import { PerformanceModule } from '@modules/performance/index.js';
import { DatabaseOpsModule } from '@modules/database-ops/index.js';
import { CacheOpsModule } from '@modules/cache-ops/index.js';
import { StorageOpsModule } from '@modules/storage-ops/index.js';
import { MessagingOpsModule } from '@modules/messaging-ops/index.js';
import { HttpClientOpsModule } from '@modules/http-client-ops/index.js';
import { WorkerOpsModule } from '@modules/worker-ops/index.js';
import { SchedulerOpsModule } from '@modules/scheduler-ops/index.js';
import { JobsOpsModule } from '@modules/jobs-ops/index.js';
import { LogsOpsModule } from '@modules/logs-ops/index.js';
import { MetricsOpsModule } from '@modules/metrics-ops/index.js';
import { IncidentsOpsModule } from '@modules/incidents-ops/index.js';
import { BackupOpsModule } from '@modules/backup-ops/index.js';
import { DrOpsModule } from '@modules/dr-ops/index.js';

@Module({
  imports: [
    DiscoveryModule,
    HealthModule,
    RuntimesModule,
    TrafficModule,
    PerformanceModule,
    DatabaseOpsModule,
    CacheOpsModule,
    StorageOpsModule,
    MessagingOpsModule,
    HttpClientOpsModule,
    WorkerOpsModule,
    SchedulerOpsModule,
    JobsOpsModule,
    LogsOpsModule,
    MetricsOpsModule,
    IncidentsOpsModule,
    BackupOpsModule,
    DrOpsModule,
  ],
  controllers: [SystemOpsController],
  providers: [PackageRegistryService, SystemInfoService, SystemOverviewService, OpsEventService],
  exports: [
    PackageRegistryService,
    SystemInfoService,
    SystemOverviewService,
    OpsEventService,
    HealthModule,
    RuntimesModule,
    TrafficModule,
    PerformanceModule,
    DatabaseOpsModule,
    CacheOpsModule,
    StorageOpsModule,
    MessagingOpsModule,
    HttpClientOpsModule,
    WorkerOpsModule,
    SchedulerOpsModule,
    JobsOpsModule,
    LogsOpsModule,
    MetricsOpsModule,
    IncidentsOpsModule,
    BackupOpsModule,
    DrOpsModule,
  ],
})
export class SystemOpsModule {}
