import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { ApiModule } from '@apps/api/api.module.js';
import { setupApiDocs } from '@apps/api/bootstrap/api-docs.bootstrap.js';
import { CoreConfigService } from '@packages/config/index.js';
import { normalizeApiPrefix } from '@packages/http/index.js';
import { REDIS_CLIENT_FACTORY, type RedisClientFactory } from '@packages/redis/index.js';

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
}

export interface TestAppContext {
  app: NestFastifyApplication;
  moduleFixture: TestingModule;
  close: () => Promise<void>;
}

/**
 * Test Concern: createTestApp
 * Khởi tạo môi trường Fastify Application cho các Feature Tests.
 * Tương đương với các test concerns / traits trong kiến trúc coaching.
 */
export async function createTestApp(options?: CreateTestAppOptions): Promise<TestAppContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [ApiModule],
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
    close: async () => {
      await app.close();
    },
  };
}
