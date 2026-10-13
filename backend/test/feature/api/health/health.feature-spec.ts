import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';

describe('Feature: Health API (GET /health)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  it('should return 200 with standard response envelope', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload) as {
      success: boolean;
      statusCode: number;
      data: {
        status: string;
        uptime: number;
        timestamp: string;
        checks: Record<string, { status: string }>;
      };
      timestamp: string;
    };

    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(200);
    // DB test (core_test) không chạy trong môi trường test → health báo degraded thay vì ok giả;
    // Redis (ioredis-mock) và heap vẫn up.
    expect(body.data.status).toBe('degraded');
    expect(body.data.checks['database']?.status).toBe('down');
    expect(body.data.checks['redis']?.status).toBe('up');
    expect(body.data.checks['heap']?.status).toBe('up');
    expect(typeof body.data.uptime).toBe('number');
    expect(typeof body.data.timestamp).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });
});
