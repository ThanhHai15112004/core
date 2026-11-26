import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { BACKUP_OPS_PUBLIC_SERVICE } from './contracts/index.js';
import { BackupOpsController } from './controllers/backup-ops.controller.js';
import { BackupPolicyEntity } from './entities/backup-policy.entity.js';
import { BackupRecordEntity } from './entities/backup-record.entity.js';
import { BackupRestoreHistoryEntity } from './entities/backup-restore-history.entity.js';
import enBackupOps from './locales/en/backup-ops.json' with { type: 'json' };
import viBackupOps from './locales/vi/backup-ops.json' with { type: 'json' };
import { BackupPolicyRepository } from './repositories/backup-policy.repository.js';
import { BackupRecordRepository } from './repositories/backup-record.repository.js';
import { BackupRestoreHistoryRepository } from './repositories/backup-restore-history.repository.js';
import { BackupAlertService } from './services/backup-alert.service.js';
import { BackupOrchestratorService } from './services/backup-orchestrator.service.js';
import { BackupRestoreDrillService } from './services/backup-restore-drill.service.js';
import { DatabaseBackupEngineService } from './services/database-backup-engine.service.js';
import { StorageBackupService } from './services/storage-backup.service.js';

new CoreI18nService().registerNamespace('backupOps', {
  vi: viBackupOps,
  en: enBackupOps,
});

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      BackupPolicyEntity,
      BackupRecordEntity,
      BackupRestoreHistoryEntity,
    ]),
  ],
  controllers: [BackupOpsController],
  providers: [
    BackupPolicyRepository,
    BackupRecordRepository,
    BackupRestoreHistoryRepository,
    BackupAlertService,
    DatabaseBackupEngineService,
    StorageBackupService,
    BackupRestoreDrillService,
    BackupOrchestratorService,
    {
      provide: BACKUP_OPS_PUBLIC_SERVICE,
      useExisting: BackupOrchestratorService,
    },
  ],
  exports: [
    BackupOrchestratorService,
    BackupRestoreDrillService,
    DatabaseBackupEngineService,
    StorageBackupService,
    BACKUP_OPS_PUBLIC_SERVICE,
  ],
})
export class BackupOpsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('backupOps', {
      vi: viBackupOps,
      en: enBackupOps,
    });
  }
}
