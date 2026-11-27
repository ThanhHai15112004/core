import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaseDatabaseProvider } from './providers/database.provider.js';
import { TypeOrmConfigService } from './providers/typeorm-config.service.js';
import { DatabaseManageableAdapter } from './providers/database-manageable.adapter.js';
import { DatabaseConnectionService } from './providers/database-connection.service.js';
import { DatabaseMonitoringService } from './monitoring/database-monitoring.service.js';
import { DatabaseOperationsService } from './operations/database-operations.service.js';
import { MigrationLockService } from './migrations/migration-lock.service.js';
import { MigrationPreflightService } from './migrations/migration-preflight.service.js';
import { PostMigrationVerifierService } from './migrations/post-migration-verifier.service.js';
import { DataBackfillRunnerService } from './backfill/data-backfill-runner.service.js';
import { TransactionManager } from './transaction/transaction-manager.service.js';
import { UNIT_OF_WORK } from './transaction/unit-of-work.contract.js';
import { DatabaseSeederService } from './seeding/database-seeder.service.js';
import { DataRepairRunnerService } from './repair/data-repair-runner.service.js';
import { DatabaseRoutingService } from './routing/database-routing.service.js';

/**
 * Kết nối database thật qua TypeORM (khởi tạo nền, có retry — app vẫn chạy khi DB chưa sẵn sàng).
 * Module nghiệp vụ dùng `TypeOrmModule.forFeature([...])` / `@InjectRepository` như thường.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService })],
  providers: [
    TypeOrmConfigService,
    DatabaseConnectionService,
    DatabaseMonitoringService,
    MigrationLockService,
    MigrationPreflightService,
    DatabaseOperationsService,
    PostMigrationVerifierService,
    DataBackfillRunnerService,
    DatabaseRoutingService,
    TransactionManager,
    {
      provide: UNIT_OF_WORK,
      useExisting: TransactionManager,
    },
    DatabaseSeederService,
    DataRepairRunnerService,
    BaseDatabaseProvider,
    DatabaseManageableAdapter,
  ],
  exports: [
    TypeOrmConfigService,
    DatabaseConnectionService,
    DatabaseMonitoringService,
    MigrationLockService,
    MigrationPreflightService,
    DatabaseOperationsService,
    PostMigrationVerifierService,
    DataBackfillRunnerService,
    DatabaseRoutingService,
    TransactionManager,
    UNIT_OF_WORK,
    DatabaseSeederService,
    DataRepairRunnerService,
    BaseDatabaseProvider,
    DatabaseManageableAdapter,
  ],
})
export class DatabaseModule {}
