import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiModule } from '@apps/api/api.module.js';

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
  }).compile();

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
