import { Module } from '@nestjs/common';
import { RuntimesController } from './controllers/runtimes.controller.js';
import { RuntimeStoreService } from './services/runtime-store.service.js';
import { RuntimesService } from './services/runtimes.service.js';
import { RuntimeCommandService } from './services/runtime-command.service.js';

@Module({
  controllers: [RuntimesController],
  providers: [RuntimeStoreService, RuntimesService, RuntimeCommandService],
  exports: [RuntimesService],
})
export class RuntimesModule {}
