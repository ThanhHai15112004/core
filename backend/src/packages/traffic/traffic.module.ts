import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { TrafficCollectorService } from './providers/traffic-collector.service.js';
import { TrafficHooksService } from './providers/traffic-hooks.service.js';
import { TrafficTimingInterceptor } from './interceptors/traffic-timing.interceptor.js';

/**
 * Thu thập HTTP traffic cho app có HTTP server — import MỘT lần ở app module (vd. ApiModule).
 * Yêu cầu RedisModule, ConfigModule, LoggingModule.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    TrafficCollectorService,
    TrafficHooksService,
    { provide: APP_INTERCEPTOR, useClass: TrafficTimingInterceptor },
  ],
  exports: [TrafficCollectorService],
})
export class TrafficModule {}
