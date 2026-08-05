import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { ApiModule } from './apps/api/api.module.js';

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a valid positive integer');
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    new FastifyAdapter(),
  );

  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  console.log(`NestJS Fastify application is running on port ${port}`);
}

void bootstrap();
