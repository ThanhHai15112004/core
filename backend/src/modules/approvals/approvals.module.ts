import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { UsersModule } from '@modules/users/index.js';
import { APPROVALS_PUBLIC_SERVICE } from './contracts/index.js';
import { ApprovalsController } from './controllers/approvals.controller.js';
import { WorkflowApprovalDelegationEntity } from './entities/workflow-approval-delegation.entity.js';
import { WorkflowApprovalDelegationRepository } from './repositories/workflow-approval-delegation.repository.js';
import { ApprovalsService } from './services/approvals.service.js';
import enApprovals from './locales/en/approvals.json' with { type: 'json' };
import viApprovals from './locales/vi/approvals.json' with { type: 'json' };

new CoreI18nService().registerNamespace('approvals', {
  vi: viApprovals,
  en: enApprovals,
});

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkflowApprovalDelegationEntity]),
    UsersModule,
    RolesModule,
    OrganizationsModule,
    NotificationsModule,
  ],
  controllers: [ApprovalsController],
  providers: [
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
      vi: viApprovals,
      en: enApprovals,
    });
  }
}
