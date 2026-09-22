import { Controller, Get } from '@nestjs/common';
import { Public } from '@packages/http/index.js';
import { HealthService, type HealthCheckResult } from '../services/health.service.js';
import { HEALTH_ROUTES } from '../constants/health.constant.js';

@Controller(HEALTH_ROUTES.PREFIX)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get(HEALTH_ROUTES.CHECK)
  public check(): HealthCheckResult {
    return this.healthService.check();
  }
}
