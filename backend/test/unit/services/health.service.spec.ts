import { describe, it, expect } from '@jest/globals';
import {
  HealthCheckService,
  HealthIndicatorService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { HealthService } from '@modules/health/services/health.service.js';
import { DatabaseConnectionService } from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';

type DbState = 'connected' | 'unavailable' | 'disabled';

async function serviceWith(db: DbState, redisUp: boolean): Promise<HealthService> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    providers: [
      HealthService,
      {
        provide: DatabaseConnectionService,
        useValue: {
          getStatus: () => ({ state: db }),
          ping: () =>
            Promise.resolve(
              db === 'connected'
                ? { ok: true, latencyMs: 1.2, error: null }
                : {
                    ok: false,
                    latencyMs: null,
                    error: { code: 'ECONNREFUSED', message: 'refused' },
                  },
            ),
        },
      },
      {
        provide: RedisService,
        useValue: {
          client: {
            ping: () =>
              redisUp ? Promise.resolve('PONG') : Promise.reject(new Error('Connection is closed')),
          },
        },
      },
    ],
  }).compile();
  // Bảo đảm terminus thật được dùng (không mock indicator).
  expect(moduleRef.get(HealthCheckService)).toBeDefined();
  expect(moduleRef.get(HealthIndicatorService)).toBeDefined();
  expect(moduleRef.get(MemoryHealthIndicator)).toBeDefined();
  return moduleRef.get(HealthService);
}

describe('HealthService', () => {
  it('mọi phụ thuộc up → ok, có chi tiết từng indicator', async () => {
    const result = await (await serviceWith('connected', true)).check();
    expect(result.status).toBe('ok');
    expect(result.checks).toMatchObject({
      database: { status: 'up', state: 'connected', latencyMs: 1.2 },
      redis: { status: 'up' },
      heap: { status: 'up' },
    });
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('database không kết nối được → degraded (không báo ok giả)', async () => {
    const result = await (await serviceWith('unavailable', true)).check();
    expect(result.status).toBe('degraded');
    expect(result.checks['database']).toMatchObject({ status: 'down', error: 'refused' });
  });

  it('Redis không trả lời PING → degraded', async () => {
    const result = await (await serviceWith('connected', false)).check();
    expect(result.status).toBe('degraded');
    expect(result.checks['redis']).toMatchObject({ status: 'down', error: 'Connection is closed' });
  });

  it('DB_ENABLED=false → database không làm health hỏng', async () => {
    const result = await (await serviceWith('disabled', true)).check();
    expect(result.status).toBe('ok');
    expect(result.checks['database']).toMatchObject({ status: 'up', state: 'disabled' });
  });
});
