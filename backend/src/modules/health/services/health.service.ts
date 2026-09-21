import { Injectable } from '@nestjs/common';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  public check(): HealthCheckResult {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
