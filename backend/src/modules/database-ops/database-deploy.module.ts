import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { BackupOpsModule } from '@modules/backup-ops/index.js';
import { DbBackfillJobEntity } from './entities/db-backfill-job.entity.js';
import { DbMigrationRolloutEntity } from './entities/db-migration-rollout.entity.js';
import { DbBackfillJobRepository } from './repositories/db-backfill-job.repository.js';
import { DbMigrationRolloutRepository } from './repositories/db-migration-rollout.repository.js';
import { BackfillOrchestratorService } from './services/backfill-orchestrator.service.js';
import { MigrationDeployService } from './services/migration-deploy.service.js';

/**
 * Module tách riêng cho Safe Migration Deploy & Queue Backfill (không phụ thuộc MetricsModule/Monitor interval)
 * để API (`DatabaseOpsModule`), CLI (`CliModule`), và Worker (`WorkerModule`) dùng chung an toàn.
 */
@Module({
  imports: [
    DatabaseModule,
    BackupOpsModule,
    TypeOrmModule.forFeature([DbMigrationRolloutEntity, DbBackfillJobEntity]),
  ],
  providers: [
    DbMigrationRolloutRepository,
    DbBackfillJobRepository,
    MigrationDeployService,
    BackfillOrchestratorService,
  ],
  exports: [MigrationDeployService, BackfillOrchestratorService],
})
export class DatabaseDeployModule {}
