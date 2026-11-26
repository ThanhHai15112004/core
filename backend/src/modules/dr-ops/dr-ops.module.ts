import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { DR_OPS_PUBLIC_SERVICE } from './contracts/index.js';
import { DrOpsController } from './controllers/dr-ops.controller.js';
import { DrDrillEntity } from './entities/dr-drill.entity.js';
import { DrProfileEntity } from './entities/dr-profile.entity.js';
import { DrReconciliationReportEntity } from './entities/dr-reconciliation-report.entity.js';
import { DrSwitchExecutionEntity } from './entities/dr-switch-execution.entity.js';
import { DrSyncRunEntity } from './entities/dr-sync-run.entity.js';
import enDrOps from './locales/en/dr-ops.json' with { type: 'json' };
import viDrOps from './locales/vi/dr-ops.json' with { type: 'json' };
import { DrDrillRepository } from './repositories/dr-drill.repository.js';
import { DrProfileRepository } from './repositories/dr-profile.repository.js';
import { DrReconciliationReportRepository } from './repositories/dr-reconciliation-report.repository.js';
import { DrSwitchExecutionRepository } from './repositories/dr-switch-execution.repository.js';
import { DrSyncRunRepository } from './repositories/dr-sync-run.repository.js';
import { DrAlertService } from './services/dr-alert.service.js';
import { DrDrillService } from './services/dr-drill.service.js';
import { DrOrchestratorService } from './services/dr-orchestrator.service.js';
import { DrProfileService } from './services/dr-profile.service.js';
import { DrReconciliationService } from './services/dr-reconciliation.service.js';
import { DrSwitchoverService } from './services/dr-switchover.service.js';
import { DrSyncService } from './services/dr-sync.service.js';

new CoreI18nService().registerNamespace('drOps', {
  vi: viDrOps,
  en: enDrOps,
});

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      DrProfileEntity,
      DrSyncRunEntity,
      DrSwitchExecutionEntity,
      DrReconciliationReportEntity,
      DrDrillEntity,
    ]),
  ],
  controllers: [DrOpsController],
  providers: [
    DrProfileRepository,
    DrSyncRunRepository,
    DrSwitchExecutionRepository,
    DrReconciliationReportRepository,
    DrDrillRepository,
    DrAlertService,
    DrProfileService,
    DrSyncService,
    DrSwitchoverService,
    DrReconciliationService,
    DrDrillService,
    DrOrchestratorService,
    {
      provide: DR_OPS_PUBLIC_SERVICE,
      useExisting: DrOrchestratorService,
    },
  ],
  exports: [
    DrProfileService,
    DrSyncService,
    DrSwitchoverService,
    DrReconciliationService,
    DrDrillService,
    DrOrchestratorService,
    DR_OPS_PUBLIC_SERVICE,
  ],
})
export class DrOpsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('drOps', {
      vi: viDrOps,
      en: enDrOps,
    });
  }
}
