import { Module } from '@nestjs/common';
import { PackageRegistryService } from './services/package-registry.service.js';
import { SystemOpsController } from './controllers/system-ops.controller.js';

@Module({
  controllers: [SystemOpsController],
  providers: [PackageRegistryService],
  exports: [PackageRegistryService],
})
export class SystemOpsModule {}
