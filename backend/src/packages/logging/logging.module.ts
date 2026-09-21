import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './context/request-context.service.js';
import { CoreLoggerService } from './providers/logger.service.js';
import { LoggingInterceptor } from './interceptors/logging.interceptor.js';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware.js';
import { LoggingManageableAdapter } from './providers/logging-manageable.adapter.js';

@Global()
@Module({
  providers: [
    RequestContextService,
    CoreLoggerService,
    LoggingInterceptor,
    CorrelationIdMiddleware,
    LoggingManageableAdapter,
  ],
  exports: [
    RequestContextService,
    CoreLoggerService,
    LoggingInterceptor,
    CorrelationIdMiddleware,
    LoggingManageableAdapter,
  ],
})
export class LoggingModule {}
