import { Global, Module } from '@nestjs/common';
import { BaseDatabaseProvider } from './providers/database.provider.js';
import { TypeOrmConfigService } from './providers/typeorm-config.service.js';
import { DatabaseManageableAdapter } from './providers/database-manageable.adapter.js';
import { QueryInstrumentService } from './instrumentation/query-instrument.service.js';

@Global()
@Module({
  providers: [
    BaseDatabaseProvider,
    TypeOrmConfigService,
    DatabaseManageableAdapter,
    QueryInstrumentService,
  ],
  exports: [
    BaseDatabaseProvider,
    TypeOrmConfigService,
    DatabaseManageableAdapter,
    QueryInstrumentService,
  ],
})
export class DatabaseModule {}
