import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { RequestContextService } from './context/request-context.service.js';
import { CoreLoggerService } from './providers/logger.service.js';
import { LoggingInterceptor } from './interceptors/logging.interceptor.js';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware.js';
import { LoggingManageableAdapter } from './providers/logging-manageable.adapter.js';
import { HttpMetricsService } from './metrics/http-metrics.service.js';

@Global()
@Module({
  providers: [
    RequestContextService,
    CoreLoggerService,
    LoggingInterceptor,
    CorrelationIdMiddleware,
    LoggingManageableAdapter,
    HttpMetricsService,
  ],
  exports: [
    RequestContextService,
    CoreLoggerService,
    LoggingInterceptor,
    CorrelationIdMiddleware,
    LoggingManageableAdapter,
    HttpMetricsService,
  ],
})
export class LoggingModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*path}');
  }
}
