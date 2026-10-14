import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { normalizeApiPrefix } from '@packages/http/index.js';
import { PinoNestLogger } from '@packages/logging/index.js';
import { RuntimeAgentService } from '@packages/runtime/index.js';
import { ApiRuntimeContributor } from '../runtime/api-runtime.contributor.js';
import { ApiModule } from '../api.module.js';
import { setupApiDocs } from './api-docs.bootstrap.js';

/** Khởi tạo và khởi chạy HTTP API server với NestJS và Fastify */
export async function bootstrapApi(): Promise<NestFastifyApplication> {
  const logger = new Logger('ApiBootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(PinoNestLogger));

  const agent = app.get(RuntimeAgentService);
  agent.installCrashHandlers();
  app.get(ApiRuntimeContributor).attachServer(app.getHttpServer());

  const configService = app.get(CoreConfigService);
  const port = configService.app.port;
  const host = configService.app.host;
  const prefix = normalizeApiPrefix(configService.app.apiPrefix);

  app.enableCors({
    origin: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.setGlobalPrefix(prefix);
  setupApiDocs(app);
  app.enableShutdownHooks();

  await app.listen(port, host);
  logger.log(`HTTP API server started on http://${host}:${port}/${prefix}`);
  logger.log(`Scalar API Reference available at http://${host}:${port}/docs`);

  return app;
}
