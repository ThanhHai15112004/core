import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { ApiModule } from '../api.module.js';

export async function bootstrapApi(): Promise<NestFastifyApplication> {
  const logger = new Logger('ApiBootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    new FastifyAdapter({ logger: false }),
  );

  const configService = app.get(CoreConfigService);
  const port = configService.app.port;
  const host = configService.app.host;
  const prefix = configService.app.apiPrefix;

  app.setGlobalPrefix(prefix);
  app.enableShutdownHooks();

  await app.listen(port, host);
  logger.log(`HTTP API server started on http://${host}:${port}/${prefix}`);

  return app;
}
