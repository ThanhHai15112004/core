import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { UsersModule } from '@modules/users/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { FilesModule } from '@modules/files/index.js';
import { ApprovalsModule } from '@modules/approvals/index.js';
import { CommentsModule } from '@modules/comments/index.js';
import { WORKFLOWS_PUBLIC_SERVICE } from './contracts/index.js';
import { WorkflowDefinitionEntity } from './entities/workflow-definition.entity.js';
import { WorkflowStateEntity } from './entities/workflow-state.entity.js';
import { WorkflowTransitionEntity } from './entities/workflow-transition.entity.js';
import { WorkflowInstanceEntity } from './entities/workflow-instance.entity.js';
import { WorkflowApprovalStepEntity } from './entities/workflow-approval-step.entity.js';
import { WorkflowHistoryEntity } from './entities/workflow-history.entity.js';
import { WorkflowDefinitionRepository } from './repositories/workflow-definition.repository.js';
import { WorkflowStateRepository } from './repositories/workflow-state.repository.js';
import { WorkflowTransitionRepository } from './repositories/workflow-transition.repository.js';
import { WorkflowInstanceRepository } from './repositories/workflow-instance.repository.js';
import { WorkflowApprovalStepRepository } from './repositories/workflow-approval-step.repository.js';
import { WorkflowHistoryRepository } from './repositories/workflow-history.repository.js';
import { WorkflowsService } from './services/workflows.service.js';
import { WorkflowsController } from './controllers/workflows.controller.js';
import enWorkflows from './locales/en/workflows.json' with { type: 'json' };
import viWorkflows from './locales/vi/workflows.json' with { type: 'json' };

new CoreI18nService().registerNamespace('workflows', { vi: viWorkflows, en: enWorkflows });

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowDefinitionEntity,
      WorkflowStateEntity,
      WorkflowTransitionEntity,
      WorkflowInstanceEntity,
      WorkflowApprovalStepEntity,
      WorkflowHistoryEntity,
    ]),
    SecurityModule,
    MessagingModule,
    UsersModule,
    NotificationsModule,
    FilesModule,
    ApprovalsModule,
    CommentsModule,
  ],
  controllers: [WorkflowsController],
  providers: [
    WorkflowDefinitionRepository,
    WorkflowStateRepository,
    WorkflowTransitionRepository,
    WorkflowInstanceRepository,
    WorkflowApprovalStepRepository,
    WorkflowHistoryRepository,
    WorkflowsService,
    {
      provide: WORKFLOWS_PUBLIC_SERVICE,
      useExisting: WorkflowsService,
    },
  ],
  exports: [WorkflowsService, WORKFLOWS_PUBLIC_SERVICE],
})
export class WorkflowsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('workflows', { vi: viWorkflows, en: enWorkflows });
  }
}
