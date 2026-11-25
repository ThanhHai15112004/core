import { Global, Module } from '@nestjs/common';
import { HttpServiceRegistry } from './config/http-service-registry.js';
import { HTTP_CLIENT_TOKEN } from './contracts/http-client.contract.js';
import { HttpClientMetricsService } from './monitoring/http-client-metrics.service.js';
import { HttpClientManageableAdapter } from './providers/http-client-manageable.adapter.js';
import { BaseHttpClientProvider } from './providers/http-client.provider.js';
import { CircuitBreakerRegistry } from './resilience/circuit-breaker.registry.js';
import { ConcurrencyLimiterRegistry } from './resilience/concurrency-limiter.registry.js';
import { RetryStormMonitor } from './resilience/retry-storm.monitor.js';

@Global()
@Module({
  providers: [
    HttpServiceRegistry,
    CircuitBreakerRegistry,
    ConcurrencyLimiterRegistry,
    RetryStormMonitor,
    HttpClientMetricsService,
    BaseHttpClientProvider,
    {
      provide: HTTP_CLIENT_TOKEN,
      useExisting: BaseHttpClientProvider,
    },
    HttpClientManageableAdapter,
  ],
  exports: [
    HttpServiceRegistry,
    CircuitBreakerRegistry,
    ConcurrencyLimiterRegistry,
    RetryStormMonitor,
    HttpClientMetricsService,
    BaseHttpClientProvider,
    HTTP_CLIENT_TOKEN,
    HttpClientManageableAdapter,
  ],
})
export class HttpClientModule {}
