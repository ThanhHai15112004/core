import { Global, Module } from '@nestjs/common';
import { BaseStorageProvider } from './providers/storage.provider.js';

@Global()
@Module({
  providers: [BaseStorageProvider],
  exports: [BaseStorageProvider],
})
export class StorageModule {}
