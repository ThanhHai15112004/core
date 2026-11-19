import { Module } from '@nestjs/common';
import { HttpClientOpsController } from './controllers/http-client-ops.controller.js';
import { HttpClientOpsService } from './services/http-client-ops.service.js';

/** API vận hành & giám sát HTTP Client dùng chung trên System Console (`/ops/http-client/*`) */
@Module({
  controllers: [HttpClientOpsController],
  providers: [HttpClientOpsService],
  exports: [HttpClientOpsService],
})
export class HttpClientOpsModule {}
