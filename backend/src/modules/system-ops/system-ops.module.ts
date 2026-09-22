import { Module } from '@nestjs/common';
import { PackageRegistryService } from './services/package-registry.service.js';
import { SystemOverviewService } from './services/system-overview.service.js';
import { SystemOpsController } from './controllers/system-ops.controller.js';

@Module({
  controllers: [SystemOpsController],
  providers: [PackageRegistryService, SystemOverviewService],
  exports: [PackageRegistryService, SystemOverviewService],
})
export class SystemOpsModule {}
