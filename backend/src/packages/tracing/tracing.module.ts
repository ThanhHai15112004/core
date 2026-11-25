import {
  Global,
  Inject,
  Module,
  Optional,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
  type Provider,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { TRACING_OPTIONS } from './constants/tracing.constant.js';
import type { TracingModuleOptions } from './contracts/tracing.types.js';
import { createHttpTracingMiddleware } from './middleware/http-tracing.middleware.js';
import { HttpTracingHook } from './providers/http-tracing.hook.js';
import { TracingManageableAdapter } from './providers/tracing-manageable.adapter.js';
import { TracingSdkService } from './providers/tracing-sdk.service.js';
import { TracingService } from './providers/tracing.service.js';

/**
 * Distributed Tracing (OpenTelemetry) cho toàn hệ thống (`api`, `worker`, `scheduler`).
 * Cần import trước `LoggingModule` để HTTP server span được mở trước khi tạo RequestContext log.
 */
@Global()
@Module({})
export class TracingModule implements NestModule {
  constructor(
    private readonly config: CoreConfigService,
    @Optional() @Inject(TRACING_OPTIONS) private readonly options?: TracingModuleOptions,
  ) {}

  public static forRuntime(options: TracingModuleOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: TRACING_OPTIONS, useValue: options },
      TracingSdkService,
      TracingService,
      TracingManageableAdapter,
    ];
    if (options.runtime === 'api') {
      providers.push(HttpTracingHook);
    }

    return {
      module: TracingModule,
      providers,
      exports: [TracingSdkService, TracingService, TracingManageableAdapter],
    };
  }

  public configure(consumer: MiddlewareConsumer): void {
    if (this.options?.runtime !== 'api') return;
    const middleware = createHttpTracingMiddleware(() => ({
      enabled: this.config.tracing.enabled,
    }));
    consumer.apply(middleware).forRoutes('{*path}');
  }
}
