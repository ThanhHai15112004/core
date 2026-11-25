import { Global, Module } from '@nestjs/common';
import { BaseCacheProvider } from './providers/cache.provider.js';
import { CacheConnectionService } from './providers/cache-connection.service.js';
import { CacheInvalidationService } from './providers/cache-invalidation.service.js';
import { CacheManageableAdapter } from './providers/cache-manageable.adapter.js';
import { CacheMonitoringService } from './monitoring/cache-monitoring.service.js';
import { CacheOperationsService } from './operations/cache-operations.service.js';
import { DistributedLockService } from './locks/distributed-lock.service.js';

@Global()
@Module({
  providers: [
    BaseCacheProvider,
    CacheConnectionService,
    CacheInvalidationService,
    CacheMonitoringService,
    CacheOperationsService,
    CacheManageableAdapter,
    DistributedLockService,
  ],
  exports: [
    BaseCacheProvider,
    CacheConnectionService,
    CacheInvalidationService,
    CacheMonitoringService,
    CacheOperationsService,
    CacheManageableAdapter,
    DistributedLockService,
  ],
})
export class CacheModule {}
