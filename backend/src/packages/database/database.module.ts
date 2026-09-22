import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaseDatabaseProvider } from './providers/database.provider.js';
import { TypeOrmConfigService } from './providers/typeorm-config.service.js';
import { DatabaseManageableAdapter } from './providers/database-manageable.adapter.js';
import { DatabaseConnectionService } from './providers/database-connection.service.js';
import { QueryInstrumentService } from './instrumentation/query-instrument.service.js';
import { DatabaseMonitoringService } from './monitoring/database-monitoring.service.js';
import { DatabaseOperationsService } from './operations/database-operations.service.js';

/**
 * Kết nối database thật qua TypeORM (khởi tạo nền, có retry — app vẫn chạy khi DB chưa sẵn sàng)
 * + đo query. Module nghiệp vụ dùng `TypeOrmModule.forFeature([...])` / `@InjectRepository` như thường.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService })],
  providers: [
    TypeOrmConfigService,
    QueryInstrumentService,
    DatabaseConnectionService,
    DatabaseMonitoringService,
    DatabaseOperationsService,
    BaseDatabaseProvider,
    DatabaseManageableAdapter,
  ],
  exports: [
    TypeOrmConfigService,
    QueryInstrumentService,
    DatabaseConnectionService,
    DatabaseMonitoringService,
    DatabaseOperationsService,
    BaseDatabaseProvider,
    DatabaseManageableAdapter,
  ],
})
export class DatabaseModule {}
