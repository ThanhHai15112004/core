import { Module } from '@nestjs/common';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { MessagingOpsController } from './controllers/messaging-ops.controller.js';
import { MessagingOpsService } from './services/messaging-ops.service.js';
import { MessagingMetricsService } from './services/messaging-metrics.service.js';
import { MessagingStoreService } from './services/messaging-store.service.js';
import { MessagingMonitorService } from './services/messaging-monitor.service.js';

/** API Messaging Monitor cho System Console (`/ops/messaging/*`) + monitor nền (lag & cảnh báo). */
@Module({
  imports: [PerformanceOpsModule],
  controllers: [MessagingOpsController],
  providers: [
    MessagingOpsService,
    MessagingMetricsService,
    MessagingStoreService,
    MessagingMonitorService,
  ],
  exports: [MessagingOpsService],
})
export class MessagingOpsModule {}
