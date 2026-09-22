import { Module } from '@nestjs/common';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { TrafficOpsModule } from '@modules/traffic/index.js';
import { CacheOpsController } from './controllers/cache-ops.controller.js';
import { CacheOpsService } from './services/cache-ops.service.js';
import { CacheMetricsService } from './services/cache-metrics.service.js';
import { CacheStoreService } from './services/cache-store.service.js';
import { CacheMonitorService } from './services/cache-monitor.service.js';

/** API Cache Monitor cho System Console (`/ops/cache/*`) + monitor nền (quét keyspace & cảnh báo). */
@Module({
  imports: [PerformanceOpsModule, TrafficOpsModule],
  controllers: [CacheOpsController],
  providers: [CacheOpsService, CacheMetricsService, CacheStoreService, CacheMonitorService],
  exports: [CacheOpsService],
})
export class CacheOpsModule {}
