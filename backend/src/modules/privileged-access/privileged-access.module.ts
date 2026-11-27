import { Module, type OnModuleInit, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  PrivilegedAccessHookRegistry,
  SecurityModule,
  defaultPrivilegedAccessHookRegistry,
} from '@packages/security/index.js';
import { CodesModule } from '@modules/codes/index.js';
import { FeatureFlagsModule } from '@modules/feature-flags/index.js';
import { IncidentsOpsModule } from '@modules/incidents-ops/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { PermissionsModule } from '@modules/permissions/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { SessionsModule } from '@modules/sessions/index.js';
import { SettingsModule } from '@modules/settings/index.js';
import { UsersModule } from '@modules/users/index.js';
import { PRIVILEGED_ACCESS_PUBLIC_SERVICE } from './contracts/index.js';
import { PrivilegedAccessController } from './controllers/privileged-access.controller.js';
import { PrivilegedAccessGrantEntity } from './entities/privileged-access-grant.entity.js';
import { PrivilegedAccessReviewItemEntity } from './entities/privileged-access-review-item.entity.js';
import { PrivilegedAccessReviewEntity } from './entities/privileged-access-review.entity.js';
import { PrivilegedAccessTargetEntity } from './entities/privileged-access-target.entity.js';
import { PrivilegedBreakGlassAccountEntity } from './entities/privileged-break-glass-account.entity.js';
import { PrivilegedUsageAlertEntity } from './entities/privileged-usage-alert.entity.js';
import enPrivilegedAccess from './locales/en/privileged-access.json' with { type: 'json' };
import viPrivilegedAccess from './locales/vi/privileged-access.json' with { type: 'json' };
import { PrivilegedAccessGrantRepository } from './repositories/privileged-access-grant.repository.js';
import { PrivilegedAccessReviewItemRepository } from './repositories/privileged-access-review-item.repository.js';
import { PrivilegedAccessReviewRepository } from './repositories/privileged-access-review.repository.js';
import { PrivilegedAccessTargetRepository } from './repositories/privileged-access-target.repository.js';
import { PrivilegedBreakGlassAccountRepository } from './repositories/privileged-break-glass-account.repository.js';
import { PrivilegedUsageAlertRepository } from './repositories/privileged-usage-alert.repository.js';
import { PrivilegedAccessService } from './services/privileged-access.service.js';
import { PrivilegedAlertsService } from './services/privileged-alerts.service.js';
import { PrivilegedBreakGlassService } from './services/privileged-break-glass.service.js';
import { PrivilegedGrantsService } from './services/privileged-grants.service.js';
import { PrivilegedPolicyEvaluatorService } from './services/privileged-policy-evaluator.service.js';
import { PrivilegedReviewsService } from './services/privileged-reviews.service.js';
import { PrivilegedTargetsService } from './services/privileged-targets.service.js';

new CoreI18nService().registerNamespace('privileged-access', {
  vi: viPrivilegedAccess,
  en: enPrivilegedAccess,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    SessionsModule,
    NotificationsModule,
    IncidentsOpsModule,
    SettingsModule,
    FeatureFlagsModule,
    CodesModule,
    TypeOrmModule.forFeature([
      PrivilegedAccessTargetEntity,
      PrivilegedAccessGrantEntity,
      PrivilegedBreakGlassAccountEntity,
      PrivilegedUsageAlertEntity,
      PrivilegedAccessReviewEntity,
      PrivilegedAccessReviewItemEntity,
    ]),
  ],
  controllers: [PrivilegedAccessController],
  providers: [
    PrivilegedAccessTargetRepository,
    PrivilegedAccessGrantRepository,
    PrivilegedBreakGlassAccountRepository,
    PrivilegedUsageAlertRepository,
    PrivilegedAccessReviewRepository,
    PrivilegedAccessReviewItemRepository,
    PrivilegedAlertsService,
    PrivilegedTargetsService,
    PrivilegedGrantsService,
    PrivilegedBreakGlassService,
    PrivilegedReviewsService,
    PrivilegedPolicyEvaluatorService,
    PrivilegedAccessService,
    {
      provide: PRIVILEGED_ACCESS_PUBLIC_SERVICE,
      useExisting: PrivilegedAccessService,
    },
  ],
  exports: [
    PrivilegedAccessService,
    PrivilegedTargetsService,
    PrivilegedGrantsService,
    PrivilegedBreakGlassService,
    PrivilegedAlertsService,
    PrivilegedReviewsService,
    PrivilegedPolicyEvaluatorService,
    PRIVILEGED_ACCESS_PUBLIC_SERVICE,
  ],
})
export class PrivilegedAccessModule implements OnModuleInit {
  private readonly hooks: PrivilegedAccessHookRegistry;

  constructor(
    private readonly policyEvaluator: PrivilegedPolicyEvaluatorService,
    private readonly grantsService: PrivilegedGrantsService,
    private readonly breakGlassService: PrivilegedBreakGlassService,
    @Optional() hookRegistry?: PrivilegedAccessHookRegistry,
    @Optional() i18n?: CoreI18nService,
  ) {
    this.hooks = hookRegistry ?? defaultPrivilegedAccessHookRegistry;
    i18n?.registerNamespace('privileged-access', {
      vi: viPrivilegedAccess,
      en: enPrivilegedAccess,
    });
  }

  public onModuleInit(): void {
    this.hooks.registerGuardEvaluator(this.policyEvaluator);
    this.hooks.registerLoginPolicy(this.breakGlassService);
    this.hooks.registerGrantResolver({
      resolveActiveTemporaryAccess: async (userId: number) => {
        const [grants, isBreakGlassActive] = await Promise.all([
          this.grantsService.resolveActiveGrantsForUser(userId),
          this.breakGlassService.isActiveBreakGlassUser(userId),
        ]);
        return {
          roleIds: grants.roleIds,
          roleCodes: grants.roleCodes,
          permissions: grants.permissions,
          activeGrantIds: grants.grantIds,
          isBreakGlassActive,
        };
      },
    });
  }
}
