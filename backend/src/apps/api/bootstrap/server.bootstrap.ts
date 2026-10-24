import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { normalizeApiPrefix } from '@packages/http/index.js';
import { PinoNestLogger } from '@packages/logging/index.js';
import { RuntimeAgentService } from '@packages/runtime/index.js';
import { PlatformSecurityService } from '@packages/security/index.js';
import { ApiRuntimeContributor } from '../runtime/api-runtime.contributor.js';
import { ApiModule } from '../api.module.js';
import { setupApiDocs } from './api-docs.bootstrap.js';

/** Khởi tạo và khởi chạy HTTP API server với NestJS và Fastify */
export async function bootstrapApi(): Promise<NestFastifyApplication> {
  const logger = new Logger('ApiBootstrap');
  // Parser JSON chấp nhận body rỗng được thay trong HttpModule.onModuleInit (sau khi Nest
  // đăng ký parser mặc định). KHÔNG gọi trước NestFactory.create → FST_ERR_CTP_ALREADY_PRESENT.
  // Nâng bodyLimit lên 32 MB để hỗ trợ tải lên theo mảnh tốc độ cao (Chunked Upload 4MB–10MB Base64).
  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 32 * 1024 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(ApiModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoNestLogger));

  const agent = app.get(RuntimeAgentService);
  agent.installCrashHandlers();
  app.get(ApiRuntimeContributor).attachServer(app.getHttpServer());

  const configService = app.get(CoreConfigService);
  const platformSecurity = app.get(PlatformSecurityService);
  const port = configService.app.port;
  const host = configService.app.host;
  const prefix = normalizeApiPrefix(configService.app.apiPrefix);

  app.enableCors({
    origin: platformSecurity.getAllowedOrigins(),
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
