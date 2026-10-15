import { Module } from '@nestjs/common';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { USERS_PUBLIC_SERVICE } from './contracts/index.js';
import { UsersController } from './controllers/users.controller.js';
import { UsersMapper } from './mappers/users.mapper.js';
import { UserOrganizationUnitRepository } from './repositories/user-organization-unit.repository.js';
import { UserRoleRepository } from './repositories/user-role.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { UserImportExportService } from './services/user-import-export.service.js';
import { UsersService } from './services/users.service.js';

@Module({
  imports: [OrganizationsModule, RolesModule],
  controllers: [UsersController],
  providers: [
    UserRepository,
    UserRoleRepository,
    UserOrganizationUnitRepository,
    UsersMapper,
    UsersService,
    UserImportExportService,
    {
      provide: USERS_PUBLIC_SERVICE,
      useExisting: UsersService,
    },
  ],
  exports: [UsersService, UserImportExportService, USERS_PUBLIC_SERVICE],
})
export class UsersModule {}
