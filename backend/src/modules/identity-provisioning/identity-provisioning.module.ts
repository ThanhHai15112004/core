import { Module, type OnModuleInit, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  ReconciliationRegistryService,
  defaultReconciliationRegistry,
} from '@packages/kernel/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { SessionsModule } from '@modules/sessions/index.js';
import { SettingsModule } from '@modules/settings/index.js';
import { FeatureFlagsModule } from '@modules/feature-flags/index.js';
import { CodesModule } from '@modules/codes/index.js';
import { UsersModule } from '@modules/users/index.js';
import { ScimReconciliationSourceAdapter } from './adapters/scim-reconciliation.adapter.js';
import { IDENTITY_PROVISIONING_PUBLIC_SERVICE } from './contracts/index.js';
import { IdentityProvisioningAdminController } from './controllers/identity-provisioning-admin.controller.js';
import { ScimProtocolController } from './controllers/scim-protocol.controller.js';
import { ScimClientEntity } from './entities/scim-client.entity.js';
import { ScimGroupMemberEntity } from './entities/scim-group-member.entity.js';
import { ScimGroupEntity } from './entities/scim-group.entity.js';
import { ScimReconciliationRunEntity } from './entities/scim-reconciliation-run.entity.js';
import { ScimSyncLogEntity } from './entities/scim-sync-log.entity.js';
import { ScimUserLinkEntity } from './entities/scim-user-link.entity.js';
import { ScimClientAuthGuard } from './guards/scim-client-auth.guard.js';
import enIdentityProvisioning from './locales/en/identity-provisioning.json' with { type: 'json' };
import viIdentityProvisioning from './locales/vi/identity-provisioning.json' with { type: 'json' };
import { ScimClientRepository } from './repositories/scim-client.repository.js';
import { ScimGroupMemberRepository } from './repositories/scim-group-member.repository.js';
import { ScimGroupRepository } from './repositories/scim-group.repository.js';
import { ScimReconciliationRunRepository } from './repositories/scim-reconciliation-run.repository.js';
import { ScimSyncLogRepository } from './repositories/scim-sync-log.repository.js';
import { ScimUserLinkRepository } from './repositories/scim-user-link.repository.js';
import { IdentityProvisioningService } from './services/identity-provisioning.service.js';
import { ScimClientsService } from './services/scim-clients.service.js';
import { ScimGroupRoleSyncService } from './services/scim-group-role-sync.service.js';
import { ScimGroupsService } from './services/scim-groups.service.js';
import { ScimReconciliationService } from './services/scim-reconciliation.service.js';
import { ScimSyncLogService } from './services/scim-sync-log.service.js';
import { ScimUsersService } from './services/scim-users.service.js';

new CoreI18nService().registerNamespace('identity-provisioning', {
  vi: viIdentityProvisioning,
  en: enIdentityProvisioning,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    UsersModule,
    RolesModule,
    SessionsModule,
    SettingsModule,
    FeatureFlagsModule,
    CodesModule,
    TypeOrmModule.forFeature([
      ScimClientEntity,
      ScimUserLinkEntity,
      ScimGroupEntity,
      ScimGroupMemberEntity,
      ScimSyncLogEntity,
      ScimReconciliationRunEntity,
    ]),
  ],
  controllers: [ScimProtocolController, IdentityProvisioningAdminController],
  providers: [
    ScimClientRepository,
    ScimUserLinkRepository,
    ScimGroupRepository,
    ScimGroupMemberRepository,
    ScimSyncLogRepository,
    ScimReconciliationRunRepository,
    ScimSyncLogService,
    ScimClientsService,
    ScimGroupRoleSyncService,
    ScimUsersService,
    ScimGroupsService,
    ScimReconciliationService,
    ScimReconciliationSourceAdapter,
    IdentityProvisioningService,
    ScimClientAuthGuard,
    {
      provide: IDENTITY_PROVISIONING_PUBLIC_SERVICE,
      useExisting: IdentityProvisioningService,
    },
  ],
  exports: [
    IdentityProvisioningService,
    ScimClientsService,
    ScimUsersService,
    ScimGroupsService,
    ScimReconciliationService,
    ScimSyncLogService,
    IDENTITY_PROVISIONING_PUBLIC_SERVICE,
  ],
})
export class IdentityProvisioningModule implements OnModuleInit {
  private readonly registry: ReconciliationRegistryService;

  constructor(
    private readonly scimReconciliationAdapter: ScimReconciliationSourceAdapter,
    @Optional() i18n?: CoreI18nService,
    @Optional() registry?: ReconciliationRegistryService,
  ) {
    i18n?.registerNamespace('identity-provisioning', {
      vi: viIdentityProvisioning,
      en: enIdentityProvisioning,
    });
    this.registry = registry ?? defaultReconciliationRegistry;
  }

  public onModuleInit(): void {
    this.registry.registerAdapter(this.scimReconciliationAdapter);
  }
}
