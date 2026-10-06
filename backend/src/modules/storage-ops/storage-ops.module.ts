import { Module } from '@nestjs/common';
import { StorageOpsController } from './controllers/storage-ops.controller.js';
import { StorageOpsService } from './services/storage-ops.service.js';
import { StorageStoreService } from './services/storage-store.service.js';
import { StorageMonitorService } from './services/storage-monitor.service.js';

/** API Storage Monitor cho System Console (`/ops/storage/*`) + monitor nền (usage & cảnh báo). */
@Module({
  controllers: [StorageOpsController],
  providers: [StorageOpsService, StorageStoreService, StorageMonitorService],
  exports: [StorageOpsService],
})
export class StorageOpsModule {}
