import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { ORGANIZATION_MEMBERS_PUBLIC_SERVICE } from './contracts/index.js';
import { OrganizationMembersController } from './controllers/organization-members.controller.js';
import { UserOrganizationHistoryEntity } from './entities/user-organization-history.entity.js';
import { UserOrganizationUnitEntity } from './entities/user-organization-unit.entity.js';
import { UserOrganizationHistoryRepository } from './repositories/user-organization-history.repository.js';
import { UserOrganizationUnitRepository } from './repositories/user-organization-unit.repository.js';
import { OrganizationMembersService } from './services/organization-members.service.js';
import enOrgMembers from './locales/en/organization-members.json' with { type: 'json' };
import viOrgMembers from './locales/vi/organization-members.json' with { type: 'json' };

new CoreI18nService().registerNamespace('organization-members', {
  en: enOrgMembers,
  vi: viOrgMembers,
});

@Module({
  imports: [
    TypeOrmModule.forFeature([UserOrganizationUnitEntity, UserOrganizationHistoryEntity]),
    OrganizationsModule,
    RolesModule,
  ],
  controllers: [OrganizationMembersController],
  providers: [
    UserOrganizationUnitRepository,
    UserOrganizationHistoryRepository,
    OrganizationMembersService,
    {
      provide: ORGANIZATION_MEMBERS_PUBLIC_SERVICE,
      useExisting: OrganizationMembersService,
    },
  ],
  exports: [OrganizationMembersService, ORGANIZATION_MEMBERS_PUBLIC_SERVICE],
})
export class OrganizationMembersModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('organization-members', {
      en: enOrgMembers,
      vi: viOrgMembers,
    });
  }
}
