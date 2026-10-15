import { Module } from '@nestjs/common';
import { ORGANIZATIONS_PUBLIC_SERVICE } from './contracts/index.js';
import { OrganizationsController } from './controllers/organizations.controller.js';
import { OrganizationsMapper } from './mappers/organizations.mapper.js';
import { OrganizationUnitRepository } from './repositories/organization-unit.repository.js';
import { OrganizationsService } from './services/organizations.service.js';

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
export class OrganizationsModule {}
