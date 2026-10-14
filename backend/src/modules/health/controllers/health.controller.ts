import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';
import { ApiDoc, ApiGroup, Public } from '@packages/http/index.js';
import { HealthService, type HealthCheckResult } from '../services/health.service.js';
import { HEALTH_ROUTES } from '../routes/health.routes.js';

const healthCheckResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptime: z.number(),
  details: z.record(z.string(), z.unknown()),
});

@ApiGroup('System Health', 'Kiểm tra trạng thái sẵn sàng của Database, Redis và bộ nhớ Heap')
@Controller(HEALTH_ROUTES.PREFIX)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Kiểm tra trạng thái sức khỏe tổng thể của hệ thống */
  @Public()
  @Get(HEALTH_ROUTES.CHECK)
  @ApiDoc({
    summary: 'Kiểm tra sức khỏe hệ thống (Healthcheck)',
    description:
      'Trả về trạng thái kết nối thực tế của Database, Redis và mức sử dụng bộ nhớ Heap của tiến trình.',
    response: healthCheckResponseSchema,
    responseExample: {
      status: 'ok',
      uptime: 3600,
      details: {
        database: { status: 'up' },
        redis: { status: 'up' },
        heap: { status: 'up' },
      },
    },
  })
  public async check(): Promise<HealthCheckResult> {
    return this.healthService.check();
  }
}
