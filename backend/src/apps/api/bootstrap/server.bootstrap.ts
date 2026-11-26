import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { CoreConfigService, gatewayConfig } from '@packages/config/index.js';
import {
  buildFastifyTrustProxyOption,
  configureDefaultTrustedProxyPolicy,
  evaluateGatewayConsistency,
  normalizeApiPrefix,
} from '@packages/http/index.js';
import { PinoNestLogger } from '@packages/logging/index.js';
import { RuntimeAgentService, installGracefulShutdown } from '@packages/runtime/index.js';
import { PlatformSecurityService } from '@packages/security/index.js';
import { ApiRuntimeContributor } from '../runtime/api-runtime.contributor.js';
import { ApiModule } from '../api.module.js';
import { setupApiDocs } from './api-docs.bootstrap.js';

/** Khởi tạo và khởi chạy HTTP API server với NestJS và Fastify */
export async function bootstrapApi(): Promise<NestFastifyApplication> {
  const logger = new Logger('ApiBootstrap');
  const bootGatewayCfg = gatewayConfig();
  configureDefaultTrustedProxyPolicy(bootGatewayCfg.proxy);

  // Parser JSON chấp nhận body rỗng được thay trong HttpModule.onModuleInit (sau khi Nest
  // đăng ký parser mặc định). KHÔNG gọi trước NestFactory.create → FST_ERR_CTP_ALREADY_PRESENT.
  // Đồng bộ bodyLimit, trustProxy và timeout với cấu hình Load Balancer / API Gateway.
  const adapter = new FastifyAdapter({
    logger: false,
    trustProxy: buildFastifyTrustProxyOption(bootGatewayCfg.proxy),
    bodyLimit: bootGatewayCfg.bodyLimits.apiMaxBodySizeBytes,
    maxParamLength: bootGatewayCfg.bodyLimits.maxParamLength,
    connectionTimeout: bootGatewayCfg.timeouts.apiConnectionTimeoutMs,
    keepAliveTimeout: bootGatewayCfg.timeouts.apiKeepAliveTimeoutMs,
  });

  const app = await NestFactory.create<NestFastifyApplication>(ApiModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoNestLogger));

  const agent = app.get(RuntimeAgentService);
  agent.installCrashHandlers();
  const apiContributor = app.get(ApiRuntimeContributor);
  const httpServer = app.getHttpServer();
  httpServer.keepAliveTimeout = bootGatewayCfg.timeouts.apiKeepAliveTimeoutMs;
  httpServer.headersTimeout =
    bootGatewayCfg.timeouts.apiHeadersTimeoutMs > 0
      ? Math.max(
          bootGatewayCfg.timeouts.apiHeadersTimeoutMs,
          bootGatewayCfg.timeouts.apiKeepAliveTimeoutMs + 1_000,
        )
      : 0;
  apiContributor.attachServer(httpServer);
  apiContributor.attachFastifyDrainingHooks(app.getHttpAdapter().getInstance());

  const configService = app.get(CoreConfigService);
  const platformSecurity = app.get(PlatformSecurityService);
  const port = configService.app.port;
  const host = configService.app.host;
  const prefix = normalizeApiPrefix(configService.app.apiPrefix);

  const consistency = evaluateGatewayConsistency(
    configService.gateway,
    configService.app.env,
    prefix,
  );
  for (const check of consistency.checks) {
    if (check.status === 'fail') {
      logger.error(`[GatewayConsistency] ${check.id}: ${check.message}`);
    } else if (check.status === 'warn') {
      logger.warn(`[GatewayConsistency] ${check.id}: ${check.message}`);
    }
  }
  if (configService.gateway.gateway.strictConsistencyCheck && consistency.status === 'fail') {
    throw new Error(
      '[GatewayConsistency] Strict consistency check failed. Fix LB/Gateway timeout or proxy configuration.',
    );
  }

  app.enableCors({
    origin: platformSecurity.getAllowedOrigins(),
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    exposedHeaders: [
      'X-Request-Id',
      'X-Correlation-Id',
      'X-Trace-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-RateLimit-Policy',
      'X-RateLimit-Scope',
      'Retry-After',
      'X-Api-Version',
    ],
    credentials: true,
  });

  app.setGlobalPrefix(prefix);
  setupApiDocs(app);
  if (!configService.isTest) {
    installGracefulShutdown({
      app,
      agent,
      logger,
      drainDelayMs: configService.runtime.drainDelayMs,
      gracefulTimeoutMs: configService.runtime.gracefulTimeoutMs,
    });
  } else {
    app.enableShutdownHooks();
  }

  await app.listen(port, host);
  logger.log(`HTTP API server started on http://${host}:${port}/${prefix}`);
  logger.log(`Scalar API Reference available at http://${host}:${port}/docs`);

  return app;
}
