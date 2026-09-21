import { Global, Module } from '@nestjs/common';
import { BaseCacheProvider } from './providers/cache.provider.js';

@Global()
@Module({
  providers: [BaseCacheProvider],
  exports: [BaseCacheProvider],
})
export class CacheModule {}
