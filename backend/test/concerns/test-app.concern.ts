import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { ApiModule } from '@apps/api/api.module.js';
import { REDIS_CLIENT_FACTORY, type RedisClientFactory } from '@packages/redis/index.js';

/** Redis giả lập trong bộ nhớ — test không bao giờ chạm vào Redis thật (dùng chung với project khác). */
export const mockRedisFactory: RedisClientFactory = () => {
  const client = new RedisMock();
  // ioredis-mock không có `status`; RedisService dùng nó để biết đã sẵn sàng.
  Object.defineProperty(client, 'status', { value: 'ready', configurable: true });
  return client as unknown as Redis;
};

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
export async function createTestApp(): Promise<TestAppContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [ApiModule],
  })
    .overrideProvider(REDIS_CLIENT_FACTORY)
    .useValue(mockRedisFactory)
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );

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
