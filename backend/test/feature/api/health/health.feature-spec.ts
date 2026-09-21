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
      };
      timestamp: string;
    };

    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(200);
    expect(body.data.status).toBe('ok');
    expect(typeof body.data.uptime).toBe('number');
    expect(typeof body.data.timestamp).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });
});
