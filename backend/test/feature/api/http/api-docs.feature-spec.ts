import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import {
  OPENAPI_VERSION,
  type OpenApiDocument,
  type PostmanCollection,
} from '@packages/http/index.js';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';

describe('Feature: Scalar API Reference & OpenAPI 3.1 Endpoints (Task 2.3)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    context = await createTestApp({
      useGlobalPrefix: true,
      enableApiDocs: true,
    });
  });

  afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  it('GET /docs should serve Scalar API Reference interactive HTML page', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/docs',
    });

    expect(response.statusCode).toBe(HTTP_STATUS_CODE.OK);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('@scalar/api-reference');
    expect(response.payload).toContain('/docs/openapi.json');
  });

  it('GET /docs/openapi.json should return valid OpenAPI 3.1.0 specification with documented routes', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/docs/openapi.json',
    });

    expect(response.statusCode).toBe(HTTP_STATUS_CODE.OK);
    expect(response.headers['content-type']).toContain('application/json');

    const doc = JSON.parse(response.payload) as OpenApiDocument;
    expect(doc.openapi).toBe(OPENAPI_VERSION);
    expect(doc.paths['/api/v1/health']?.get).toBeDefined();
    expect(doc.paths['/api/v1/health']?.get?.summary).toContain('Healthcheck');
    expect(doc.components.securitySchemes['bearerAuth']).toBeDefined();
  });

  it('GET /docs/postman.json should return valid Postman Collection v2.1.0', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/docs/postman.json',
    });

    expect(response.statusCode).toBe(HTTP_STATUS_CODE.OK);
    const collection = JSON.parse(response.payload) as PostmanCollection;
    expect(collection.info.schema).toContain('v2.1.0');
    expect(Array.isArray(collection.item)).toBe(true);
    expect(collection.item.length).toBeGreaterThan(0);
  });
});
