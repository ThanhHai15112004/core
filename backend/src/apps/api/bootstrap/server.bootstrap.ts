import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreLoggerService } from '@packages/logging/index.js';
import { RuntimeAgentService } from '@packages/runtime/index.js';
import { ApiRuntimeContributor } from '../runtime/api-runtime.contributor.js';
import { ApiModule } from '../api.module.js';

export async function bootstrapApi(): Promise<NestFastifyApplication> {
  const logger = new Logger('ApiBootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(CoreLoggerService));

  const agent = app.get(RuntimeAgentService);
  agent.attachApp(app);
  agent.installCrashHandlers();
  app.get(ApiRuntimeContributor).attachServer(app.getHttpServer());

  const configService = app.get(CoreConfigService);
  const port = configService.app.port;
  const host = configService.app.host;
  const prefix = configService.app.apiPrefix;

  app.enableCors({
    origin: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.setGlobalPrefix(prefix);
  app.enableShutdownHooks();

  await app.listen(port, host);
  logger.log(`HTTP API server started on http://${host}:${port}/${prefix}`);

  return app;
}
