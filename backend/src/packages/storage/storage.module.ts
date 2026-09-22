import { Global, Module } from '@nestjs/common';
import { BaseStorageProvider } from './providers/storage.provider.js';
import { StorageConnectionService } from './providers/storage-connection.service.js';
import { StorageManageableAdapter } from './providers/storage-manageable.adapter.js';
import { StorageMonitoringService } from './monitoring/storage-monitoring.service.js';
import { StorageOperationsService } from './operations/storage-operations.service.js';

const PROVIDERS = [
  BaseStorageProvider,
  StorageConnectionService,
  StorageMonitoringService,
  StorageOperationsService,
  StorageManageableAdapter,
];

@Global()
@Module({ providers: PROVIDERS, exports: PROVIDERS })
export class StorageModule {}
