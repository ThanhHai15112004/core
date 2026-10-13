import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { METRICS_OPTIONS, type MetricsModuleOptions } from './contracts/metrics.types.js';
import { MetricsRegistryService } from './providers/metrics-registry.service.js';
import { PrometheusQueryClient } from './providers/prometheus-query.client.js';
import { HttpMetricsReader } from './providers/http-metrics.reader.js';
import { MetricsServer } from './providers/metrics-server.js';
import { MetricsController } from './providers/metrics.controller.js';
import { MetricsManageableAdapter } from './providers/metrics-manageable.adapter.js';
import { HttpMetricsHook } from './providers/http-metrics.hook.js';

/**
 * Metrics chuẩn Prometheus (prom-client). Import MỘT lần ở module của runtime:
 * - api: `forRuntime({ runtime: 'api' })` → `GET /api/v1/metrics` + hook Fastify ghi số đo HTTP.
 * - worker/scheduler: `forRuntime({ runtime, port })` → HTTP server nhỏ trên `port`.
 */
@Global()
@Module({})
export class MetricsModule {
  public static forRuntime(options: MetricsModuleOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: METRICS_OPTIONS, useValue: options },
      MetricsRegistryService,
      PrometheusQueryClient,
      HttpMetricsReader,
      MetricsManageableAdapter,
      ...(options.runtime === 'api' ? [HttpMetricsHook] : []),
      ...(options.port ? [MetricsServer] : []),
    ];
    return {
      module: MetricsModule,
      controllers: options.runtime === 'api' ? [MetricsController] : [],
      providers,
      exports: [
        MetricsRegistryService,
        PrometheusQueryClient,
        HttpMetricsReader,
        MetricsManageableAdapter,
      ],
    };
  }
}
