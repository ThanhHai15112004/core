import { Module } from '@nestjs/common';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { TrafficOpsModule } from '@modules/traffic/index.js';
import { StorageOpsController } from './controllers/storage-ops.controller.js';
import { StorageOpsService } from './services/storage-ops.service.js';
import { StorageMetricsService } from './services/storage-metrics.service.js';
import { StorageStoreService } from './services/storage-store.service.js';
import { StorageMonitorService } from './services/storage-monitor.service.js';

/** API Storage Monitor cho System Console (`/ops/storage/*`) + monitor nền (usage & cảnh báo). */
@Module({
  imports: [PerformanceOpsModule, TrafficOpsModule],
  controllers: [StorageOpsController],
  providers: [StorageOpsService, StorageMetricsService, StorageStoreService, StorageMonitorService],
  exports: [StorageOpsService],
})
export class StorageOpsModule {}
