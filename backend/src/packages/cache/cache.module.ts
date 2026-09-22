import { Global, Module } from '@nestjs/common';
import { BaseCacheProvider } from './providers/cache.provider.js';
import { CacheConnectionService } from './providers/cache-connection.service.js';
import { CacheManageableAdapter } from './providers/cache-manageable.adapter.js';
import { CacheMonitoringService } from './monitoring/cache-monitoring.service.js';
import { CacheOperationsService } from './operations/cache-operations.service.js';

@Global()
@Module({
  providers: [
    BaseCacheProvider,
    CacheConnectionService,
    CacheMonitoringService,
    CacheOperationsService,
    CacheManageableAdapter,
  ],
  exports: [
    BaseCacheProvider,
    CacheConnectionService,
    CacheMonitoringService,
    CacheOperationsService,
    CacheManageableAdapter,
  ],
})
export class CacheModule {}
