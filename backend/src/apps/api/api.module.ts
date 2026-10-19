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
import { LoggingModule } from '@packages/logging/index.js';
import { AuthGuard, SecurityModule } from '@packages/security/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { QueueModule } from '@packages/queue/index.js';
import { CacheModule } from '@packages/cache/index.js';
import { StorageModule } from '@packages/storage/index.js';
import { HttpClientModule } from '@packages/http-client/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { HealthModule } from '@modules/health/index.js';
import { SystemOpsModule } from '@modules/system-ops/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { UsersModule } from '@modules/users/index.js';
import { AuthModule } from '@modules/auth/index.js';
import { CodesModule } from '@modules/codes/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';
import { ApiRuntimeContributor } from './runtime/api-runtime.contributor.js';
import { MetricsModule } from '@packages/metrics/index.js';

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'api', kind: 'long-running' }),
    MetricsModule.forRuntime({ runtime: 'api' }),
    HttpModule,
    DatabaseModule,
    LoggingModule.forRoot({ runtime: 'api' }),
    SecurityModule,
    MessagingModule,
    QueueModule,
    CacheModule,
    StorageModule,
    HttpClientModule,
    I18nModule,
    HealthModule,
    SystemOpsModule,
    CodesModule,
    OrganizationsModule,
    RolesModule,
    UsersModule,
    AuthModule,
  ],
  providers: [
    ApiRuntimeContributor,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
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
