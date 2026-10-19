import { Module, Optional } from '@nestjs/common';
import { CoreI18nService } from '@packages/i18n/index.js';
import { ORGANIZATIONS_PUBLIC_SERVICE } from './contracts/index.js';
import { OrganizationsController } from './controllers/organizations.controller.js';
import { OrganizationsMapper } from './mappers/organizations.mapper.js';
import { OrganizationUnitRepository } from './repositories/organization-unit.repository.js';
import { OrganizationsService } from './services/organizations.service.js';
import enOrgs from './locales/en/organizations.json' with { type: 'json' };
import viOrgs from './locales/vi/organizations.json' with { type: 'json' };

@Module({
  controllers: [OrganizationsController],
  providers: [
    OrganizationUnitRepository,
    OrganizationsMapper,
    OrganizationsService,
    {
      provide: ORGANIZATIONS_PUBLIC_SERVICE,
      useExisting: OrganizationsService,
    },
  ],
  exports: [OrganizationsService, ORGANIZATIONS_PUBLIC_SERVICE],
})
export class OrganizationsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('organizations', { vi: viOrgs, en: enOrgs });
  }
}
