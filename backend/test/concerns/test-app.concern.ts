import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { ApiModule } from '@apps/api/api.module.js';
import { setupApiDocs } from '@apps/api/bootstrap/api-docs.bootstrap.js';
import { CoreConfigService } from '@packages/config/index.js';
import { normalizeApiPrefix } from '@packages/http/index.js';
import { REDIS_CLIENT_FACTORY, type RedisClientFactory } from '@packages/redis/index.js';

import type { ModuleMetadata } from '@nestjs/common';
import type { ApiErrorResponse, ApiSuccessResponse } from '@packages/http/index.js';

/** Redis giả lập trong bộ nhớ — test không bao giờ chạm vào Redis thật (dùng chung với project khác). */
export const mockRedisFactory: RedisClientFactory = () => {
  const client = new RedisMock();
  // ioredis-mock không có `status`; RedisService dùng nó để biết đã sẵn sàng.
  Object.defineProperty(client, 'status', { value: 'ready', configurable: true });
  return client as unknown as Redis;
};

export interface CreateTestAppOptions {
  /** Bật `app.setGlobalPrefix(apiPrefix)` giống môi trường runtime thực tế (mặc định `false`). */
  readonly useGlobalPrefix?: boolean;
  /** Đăng ký các route tài liệu API (`/docs`, `/docs/openapi.json`, `/docs/postman.json`). */
  readonly enableApiDocs?: boolean;
  /** Cho phép đăng ký thêm Controller phục vụ E2E test chuyên biệt (vd: RBAC test controller). */
  readonly extraControllers?: NonNullable<ModuleMetadata['controllers']>;
  /** Cho phép đăng ký thêm Provider phục vụ Integration/E2E test. */
  readonly extraProviders?: NonNullable<ModuleMetadata['providers']>;
}

export interface InjectJsonOptions {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly payload?: unknown;
  readonly headers?: Record<string, string>;
  readonly remoteAddress?: string;
}

export interface InjectJsonBody<T = unknown> {
  readonly success: boolean;
  readonly statusCode: number;
  readonly data: T;
  readonly meta?: Record<string, unknown> | undefined;
  readonly error: ApiErrorResponse['error'];
  readonly timestamp: string;
}

export interface InjectJsonResult<T = unknown> {
  readonly status: number;
  readonly raw: string;
  readonly headers: Record<string, unknown>;
  readonly body: InjectJsonBody<T>;
}

export interface TestAppContext {
  app: NestFastifyApplication;
  moduleFixture: TestingModule;
  injectJson: <T = unknown>(options: InjectJsonOptions) => Promise<InjectJsonResult<T>>;
  close: () => Promise<void>;
}

/**
 * Gửi HTTP request qua Fastify `.inject()` và parse sẵn JSON envelope chuẩn.
 */
export async function injectJson<T = unknown>(
  app: NestFastifyApplication,
  options: InjectJsonOptions,
): Promise<InjectJsonResult<T>> {
  const res = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.payload !== undefined ? { payload: options.payload as object | string } : {}),
    ...(options.remoteAddress ? { remoteAddress: options.remoteAddress } : {}),
  });

  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(res.payload);
  } catch {
    parsedBody = res.payload;
  }

  return {
    status: res.statusCode,
    raw: res.payload,
    headers: res.headers as Record<string, unknown>,
    body: parsedBody as InjectJsonBody<T>,
  };
}

/**
 * Test Concern: createTestApp
 * Khởi tạo môi trường Fastify Application cho các Feature / API E2E Tests.
 * Tương đương với các test concerns / traits trong kiến trúc coaching.
 */
export async function createTestApp(options?: CreateTestAppOptions): Promise<TestAppContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [ApiModule],
    ...(options?.extraControllers ? { controllers: options.extraControllers } : {}),
    ...(options?.extraProviders ? { providers: options.extraProviders } : {}),
  })
    .overrideProvider(REDIS_CLIENT_FACTORY)
    .useValue(mockRedisFactory)
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );

  if (options?.useGlobalPrefix) {
    const configService = app.get(CoreConfigService);
    app.setGlobalPrefix(normalizeApiPrefix(configService.app.apiPrefix));
  }

  if (options?.enableApiDocs) {
    setupApiDocs(app);
  }

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    moduleFixture,
    injectJson: <T = unknown>(reqOptions: InjectJsonOptions) => injectJson<T>(app, reqOptions),
    close: async () => {
      await app.close();
    },
  };
}
