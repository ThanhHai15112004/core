import { Module } from '@nestjs/common';
import { LogsOpsController } from './controllers/logs-ops.controller.js';
import { LogsOpsService } from './services/logs-ops.service.js';
import { LogsStoreService } from './services/logs-store.service.js';
import { LogAuditService } from './services/log-audit.service.js';

/** API Logs cho System Console (`/ops/logs/*`) — đọc Redis Stream `logs:<env>`. */
@Module({
  controllers: [LogsOpsController],
  providers: [LogsOpsService, LogsStoreService, LogAuditService],
  exports: [LogsOpsService],
})
export class LogsOpsModule {}
