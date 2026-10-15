import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { USERS_PUBLIC_SERVICE } from './contracts/index.js';
import { UserEntity } from './entities/user.entity.js';
import { UserRoleEntity } from './entities/user-role.entity.js';
import { UserOrganizationUnitEntity } from './entities/user-organization-unit.entity.js';
import { UserStatusHistoryEntity } from './entities/user-status-history.entity.js';
import { UserRepository } from './repositories/user.repository.js';
import { UserRoleRepository } from './repositories/user-role.repository.js';
import { UserOrganizationUnitRepository } from './repositories/user-organization-unit.repository.js';
import { UserStatusHistoryRepository } from './repositories/user-status-history.repository.js';
import { UsersMapper } from './mappers/users.mapper.js';
import { UsersService } from './services/users.service.js';
import { UserImportService } from './import/index.js';
import { UserExportService } from './export/index.js';
import { UsersController } from './controllers/users.controller.js';

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    RolesModule,
    OrganizationsModule,
    TypeOrmModule.forFeature([
      UserEntity,
      UserRoleEntity,
      UserOrganizationUnitEntity,
      UserStatusHistoryEntity,
    ]),
  ],
  controllers: [UsersController],
  providers: [
    UserRepository,
    UserRoleRepository,
    UserOrganizationUnitRepository,
    UserStatusHistoryRepository,
    UsersMapper,
    UsersService,
    UserImportService,
    UserExportService,
    {
      provide: USERS_PUBLIC_SERVICE,
      useExisting: UsersService,
    },
  ],
  exports: [UsersService, UserImportService, UserExportService, USERS_PUBLIC_SERVICE],
})
export class UsersModule {}
