import { Module } from '@nestjs/common';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { DatabaseOpsController } from './controllers/database-ops.controller.js';
import { DatabaseOpsService } from './services/database-ops.service.js';
import { DatabaseMetricsService } from './services/database-metrics.service.js';
import { DatabaseStoreService } from './services/database-store.service.js';
import { DatabaseMonitorService } from './services/database-monitor.service.js';

/** API Database Monitor cho System Console (`/ops/database/*`) + monitor nền (snapshot & cảnh báo). */
@Module({
  imports: [PerformanceOpsModule],
  controllers: [DatabaseOpsController],
  providers: [
    DatabaseOpsService,
    DatabaseMetricsService,
    DatabaseStoreService,
    DatabaseMonitorService,
  ],
  exports: [DatabaseOpsService],
})
export class DatabaseOpsModule {}
