import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { APPROVALS_PUBLIC_SERVICE } from './contracts/index.js';
import { ApprovalsController } from './controllers/approvals.controller.js';
import { WorkflowApprovalDelegationEntity } from './entities/workflow-approval-delegation.entity.js';
import { WorkflowApprovalStepEntity } from './entities/workflow-approval-step.entity.js';
import { WorkflowApprovalDelegationRepository } from './repositories/workflow-approval-delegation.repository.js';
import { WorkflowApprovalStepRepository } from './repositories/workflow-approval-step.repository.js';
import { ApprovalsService } from './services/approvals.service.js';
import enApprovals from './locales/en/approvals.json' with { type: 'json' };
import viApprovals from './locales/vi/approvals.json' with { type: 'json' };

new CoreI18nService().registerNamespace('approvals', {
  en: enApprovals,
  vi: viApprovals,
});

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkflowApprovalStepEntity, WorkflowApprovalDelegationEntity]),
    NotificationsModule,
  ],
  controllers: [ApprovalsController],
  providers: [
    WorkflowApprovalStepRepository,
    WorkflowApprovalDelegationRepository,
    ApprovalsService,
    {
      provide: APPROVALS_PUBLIC_SERVICE,
      useExisting: ApprovalsService,
    },
  ],
  exports: [ApprovalsService, APPROVALS_PUBLIC_SERVICE],
})
export class ApprovalsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('approvals', {
      en: enApprovals,
      vi: viApprovals,
    });
  }
}
