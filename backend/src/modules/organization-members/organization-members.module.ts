import { Module, Optional } from '@nestjs/common';
import { CoreI18nService } from '@packages/i18n/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { UsersModule } from '@modules/users/index.js';
import { ORGANIZATION_MEMBERS_PUBLIC_SERVICE } from './contracts/index.js';
import { OrganizationMembersController } from './controllers/organization-members.controller.js';
import { OrganizationMembersService } from './services/organization-members.service.js';
import enOrgMembers from './locales/en/organization-members.json' with { type: 'json' };
import viOrgMembers from './locales/vi/organization-members.json' with { type: 'json' };

new CoreI18nService().registerNamespace('organization-members', {
  vi: viOrgMembers,
  en: enOrgMembers,
});

@Module({
  imports: [OrganizationsModule, RolesModule, UsersModule],
  controllers: [OrganizationMembersController],
  providers: [
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
      vi: viOrgMembers,
      en: enOrgMembers,
    });
  }
}
