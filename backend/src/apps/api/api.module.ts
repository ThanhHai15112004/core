import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import {
  GlobalExceptionFilter,
  HttpModule,
  TransformResponseInterceptor,
} from '@packages/http/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { LoggingInterceptor, LoggingModule } from '@packages/logging/index.js';
import { AuthGuard, SecurityModule } from '@packages/security/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { CacheModule } from '@packages/cache/index.js';
import { StorageModule } from '@packages/storage/index.js';
import { HttpClientModule } from '@packages/http-client/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { HealthModule } from '@modules/health/index.js';
import { SystemOpsModule } from '@modules/system-ops/index.js';
import { RuntimesModule } from '@modules/runtimes/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';
import { TrafficModule } from '@packages/traffic/index.js';
import { TrafficOpsModule } from '@modules/traffic/index.js';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { DatabaseOpsModule } from '@modules/database-ops/index.js';
import { CacheOpsModule } from '@modules/cache-ops/index.js';
import { StorageOpsModule } from '@modules/storage-ops/index.js';
import { MessagingOpsModule } from '@modules/messaging-ops/index.js';
import { ApiRuntimeContributor } from './runtime/api-runtime.contributor.js';

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'api', kind: 'long-running' }),
    HttpModule,
    TrafficModule,
    DatabaseModule,
    LoggingModule,
    SecurityModule,
    MessagingModule,
    CacheModule,
    StorageModule,
    HttpClientModule,
    I18nModule,
    HealthModule,
    SystemOpsModule,
    RuntimesModule,
    TrafficOpsModule,
    PerformanceOpsModule,
    DatabaseOpsModule,
    CacheOpsModule,
    StorageOpsModule,
    MessagingOpsModule,
  ],
  providers: [
    ApiRuntimeContributor,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformResponseInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class ApiModule {}
