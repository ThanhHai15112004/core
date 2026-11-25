import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './controllers/health.controller.js';
import { HealthProbesService } from './services/health-probes.service.js';
import { HealthService } from './services/health.service.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [HealthProbesService, HealthService],
  exports: [HealthService, HealthProbesService],
})
export class HealthModule {}
