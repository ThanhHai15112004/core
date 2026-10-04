import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PackageRegistryService } from './services/package-registry.service.js';
import { SystemOverviewService } from './services/system-overview.service.js';
import { OpsEventService } from './services/ops-event.service.js';
import { SystemOpsController } from './controllers/system-ops.controller.js';
import { RuntimesModule } from '@modules/runtimes/index.js';
import { TrafficOpsModule } from '@modules/traffic/index.js';
import { PerformanceOpsModule } from '@modules/performance/index.js';

@Module({
  imports: [DiscoveryModule, RuntimesModule, TrafficOpsModule, PerformanceOpsModule],
  controllers: [SystemOpsController],
  providers: [PackageRegistryService, SystemOverviewService, OpsEventService],
  exports: [PackageRegistryService, SystemOverviewService, OpsEventService],
})
export class SystemOpsModule {}
