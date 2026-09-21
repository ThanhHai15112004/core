import { Global, Module } from '@nestjs/common';
import { BaseCacheProvider } from './providers/cache.provider.js';
import { CacheManageableAdapter } from './providers/cache-manageable.adapter.js';

@Global()
@Module({
  providers: [BaseCacheProvider, CacheManageableAdapter],
  exports: [BaseCacheProvider, CacheManageableAdapter],
})
export class CacheModule {}
