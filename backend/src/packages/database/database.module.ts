import { Global, Module } from '@nestjs/common';
import { BaseDatabaseProvider } from './providers/database.provider.js';
import { TypeOrmConfigService } from './providers/typeorm-config.service.js';
import { DatabaseManageableAdapter } from './providers/database-manageable.adapter.js';

@Global()
@Module({
  providers: [BaseDatabaseProvider, TypeOrmConfigService, DatabaseManageableAdapter],
  exports: [BaseDatabaseProvider, TypeOrmConfigService, DatabaseManageableAdapter],
})
export class DatabaseModule {}
