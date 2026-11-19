import { Global, Module } from '@nestjs/common';
import { HttpServiceRegistry } from './config/http-service-registry.js';
import { HTTP_CLIENT_TOKEN } from './contracts/http-client.contract.js';
import { HttpClientMetricsService } from './monitoring/http-client-metrics.service.js';
import { HttpClientManageableAdapter } from './providers/http-client-manageable.adapter.js';
import { BaseHttpClientProvider } from './providers/http-client.provider.js';
import { CircuitBreakerRegistry } from './resilience/circuit-breaker.registry.js';

@Global()
@Module({
  providers: [
    HttpServiceRegistry,
    CircuitBreakerRegistry,
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
    HttpClientMetricsService,
    BaseHttpClientProvider,
    HTTP_CLIENT_TOKEN,
    HttpClientManageableAdapter,
  ],
})
export class HttpClientModule {}
