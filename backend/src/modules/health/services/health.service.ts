import { Injectable, Optional } from '@nestjs/common';
import { HealthCheckService } from '@nestjs/terminus';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(@Optional() private readonly health?: HealthCheckService) {}

  public async check(): Promise<HealthCheckResult> {
    if (this.health) {
      const res = await this.health.check([]).catch(() => ({ status: 'error' }));
      return {
        status: res.status === 'ok' ? 'ok' : 'degraded',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    }
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
