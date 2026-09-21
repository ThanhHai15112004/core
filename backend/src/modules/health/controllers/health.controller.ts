import { Controller, Get } from '@nestjs/common';
import { Public } from '@packages/http/index.js';
import { HealthService, type HealthCheckResult } from '../services/health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  public check(): HealthCheckResult {
    return this.healthService.check();
  }
}
