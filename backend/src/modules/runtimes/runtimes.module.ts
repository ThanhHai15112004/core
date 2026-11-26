import { Module } from '@nestjs/common';
import { RuntimesController } from './controllers/runtimes.controller.js';
import { RuntimeStoreService } from './services/runtime-store.service.js';
import { RuntimesService } from './services/runtimes.service.js';
import { RuntimeCommandService } from './services/runtime-command.service.js';
import { RuntimeAutoscalingService } from './services/runtime-autoscaling.service.js';

@Module({
  controllers: [RuntimesController],
  providers: [
    RuntimeStoreService,
    RuntimesService,
    RuntimeCommandService,
    RuntimeAutoscalingService,
  ],
  exports: [RuntimesService, RuntimeStoreService, RuntimeAutoscalingService],
})
export class RuntimesModule {}
