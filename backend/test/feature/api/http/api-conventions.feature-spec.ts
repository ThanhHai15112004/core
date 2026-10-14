import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { HTTP_ERROR_CODE, HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import {
  type ApiErrorResponse,
  type ApiSuccessResponse,
  buildVersionedPath,
} from '@packages/http/index.js';
import { JOBS_OPS_ROUTES } from '@modules/jobs-ops/index.js';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';

describe('Feature: Common API Conventions & Versioning (Task 2.1)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    context = await createTestApp({ useGlobalPrefix: true });
  });

  afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  it('GET /api/v1/health should serve under versioned API prefix with standard success envelope', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: buildVersionedPath('/health'),
    });

    expect(response.statusCode).toBe(HTTP_STATUS_CODE.OK);

    const body = JSON.parse(response.payload) as ApiSuccessResponse<{
      status: string;
      uptime: number;
    }>;

    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(HTTP_STATUS_CODE.OK);
    expect(typeof body.data.status).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /api/v1/non-existent-route should return 404 with localized ApiErrorResponse envelope', async () => {
    const resVi = await context.app.inject({
      method: 'GET',
      url: buildVersionedPath('/non-existent-route'),
      headers: { 'accept-language': 'vi' },
    });

    expect(resVi.statusCode).toBe(HTTP_STATUS_CODE.NOT_FOUND);
    const bodyVi = JSON.parse(resVi.payload) as ApiErrorResponse;
    expect(bodyVi.success).toBe(false);
    expect(bodyVi.statusCode).toBe(HTTP_STATUS_CODE.NOT_FOUND);
    expect(bodyVi.error.code).toBe(HTTP_ERROR_CODE.NOT_FOUND);
    expect(typeof bodyVi.error.message).toBe('string');
    expect(typeof bodyVi.timestamp).toBe('string');

    const resEn = await context.app.inject({
      method: 'GET',
      url: buildVersionedPath('/non-existent-route'),
      headers: { 'accept-language': 'en' },
    });

    expect(resEn.statusCode).toBe(HTTP_STATUS_CODE.NOT_FOUND);
    const bodyEn = JSON.parse(resEn.payload) as ApiErrorResponse;
    expect(bodyEn.success).toBe(false);
    expect(bodyEn.error.code).toBe(HTTP_ERROR_CODE.NOT_FOUND);
  });

  it('GET /api/v1/ops/jobs with invalid limit should return 400 standardized validation error envelope', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: `${buildVersionedPath(JOBS_OPS_ROUTES.PREFIX)}?limit=99999`,
      headers: { 'accept-language': 'vi' },
    });

    expect(response.statusCode).toBe(HTTP_STATUS_CODE.BAD_REQUEST);
    const body = JSON.parse(response.payload) as ApiErrorResponse;
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(HTTP_STATUS_CODE.BAD_REQUEST);
    expect(Array.isArray(body.error.details)).toBe(true);
    expect((body.error.details ?? []).length).toBeGreaterThan(0);
  });
});
