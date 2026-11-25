import { Module, Optional, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  ReconciliationRegistryService,
  defaultReconciliationRegistry,
} from '@packages/kernel/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { PaymentsModule } from '@modules/payments/index.js';
import {
  GenericDatasetReconciliationAdapter,
  GenericDatasetRepairHandler,
} from './adapters/generic-dataset.adapter.js';
import {
  PaymentsBridgeReconciliationAdapter,
  PaymentsBridgeRepairHandler,
} from './adapters/payments-bridge.adapter.js';
import { RECONCILIATION_PUBLIC_SERVICE } from './contracts/index.js';
import { ReconciliationController } from './controllers/reconciliation.controller.js';
import { DataRepairExecutionEntity } from './entities/data-repair-execution.entity.js';
import { DataRepairRequestEntity } from './entities/data-repair-request.entity.js';
import { ReconciliationDiscrepancyEntity } from './entities/reconciliation-discrepancy.entity.js';
import { ReconciliationJobEntity } from './entities/reconciliation-job.entity.js';
import { ReconciliationRunEntity } from './entities/reconciliation-run.entity.js';
import enReconciliation from './locales/en/reconciliation.json' with { type: 'json' };
import viReconciliation from './locales/vi/reconciliation.json' with { type: 'json' };
import { DataRepairExecutionRepository } from './repositories/data-repair-execution.repository.js';
import { DataRepairRequestRepository } from './repositories/data-repair-request.repository.js';
import { ReconciliationDiscrepancyRepository } from './repositories/reconciliation-discrepancy.repository.js';
import { ReconciliationJobRepository } from './repositories/reconciliation-job.repository.js';
import { ReconciliationRunRepository } from './repositories/reconciliation-run.repository.js';
import { DataRepairService } from './services/data-repair.service.js';
import { ReconciliationDiscrepanciesService } from './services/reconciliation-discrepancies.service.js';
import { ReconciliationJobsService } from './services/reconciliation-jobs.service.js';
import { ReconciliationRunnerService } from './services/reconciliation-runner.service.js';
import { ReconciliationService } from './services/reconciliation.service.js';

new CoreI18nService().registerNamespace('reconciliation', {
  vi: viReconciliation,
  en: enReconciliation,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    NotificationsModule,
    PaymentsModule,
    TypeOrmModule.forFeature([
      ReconciliationJobEntity,
      ReconciliationRunEntity,
      ReconciliationDiscrepancyEntity,
      DataRepairRequestEntity,
      DataRepairExecutionEntity,
    ]),
  ],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationJobRepository,
    ReconciliationRunRepository,
    ReconciliationDiscrepancyRepository,
    DataRepairRequestRepository,
    DataRepairExecutionRepository,
    GenericDatasetReconciliationAdapter,
    GenericDatasetRepairHandler,
    PaymentsBridgeReconciliationAdapter,
    PaymentsBridgeRepairHandler,
    ReconciliationJobsService,
    ReconciliationRunnerService,
    ReconciliationDiscrepanciesService,
    DataRepairService,
    ReconciliationService,
    {
      provide: RECONCILIATION_PUBLIC_SERVICE,
      useExisting: ReconciliationService,
    },
  ],
  exports: [
    ReconciliationService,
    ReconciliationJobsService,
    ReconciliationRunnerService,
    ReconciliationDiscrepanciesService,
    DataRepairService,
    RECONCILIATION_PUBLIC_SERVICE,
  ],
})
export class ReconciliationModule implements OnModuleInit {
  private readonly registry: ReconciliationRegistryService;

  constructor(
    private readonly genericAdapter: GenericDatasetReconciliationAdapter,
    private readonly genericRepairHandler: GenericDatasetRepairHandler,
    private readonly paymentsBridgeAdapter: PaymentsBridgeReconciliationAdapter,
    private readonly paymentsBridgeRepairHandler: PaymentsBridgeRepairHandler,
    @Optional() registry?: ReconciliationRegistryService,
    @Optional() i18n?: CoreI18nService,
  ) {
    this.registry = registry ?? defaultReconciliationRegistry;
    i18n?.registerNamespace('reconciliation', {
      vi: viReconciliation,
      en: enReconciliation,
    });
    this.registerBuiltIns();
  }

  public onModuleInit(): void {
    this.registerBuiltIns();
  }

  private registerBuiltIns(): void {
    this.registry.registerAdapter(this.genericAdapter);
    this.registry.registerAdapter(this.paymentsBridgeAdapter);
    this.registry.registerRepairHandler(this.genericRepairHandler);
    this.registry.registerRepairHandler(this.paymentsBridgeRepairHandler);
  }
}
