import { Module } from '@nestjs/common';
import { ROLES_PUBLIC_SERVICE } from './contracts/index.js';
import { RolesController } from './controllers/roles.controller.js';
import { RolesMapper } from './mappers/roles.mapper.js';
import { RolePermissionRepository } from './repositories/role-permission.repository.js';
import { RoleRepository } from './repositories/role.repository.js';
import { RolesService } from './services/roles.service.js';

@Module({
  controllers: [RolesController],
  providers: [
    RoleRepository,
    RolePermissionRepository,
    RolesMapper,
    RolesService,
    {
      provide: ROLES_PUBLIC_SERVICE,
      useExisting: RolesService,
    },
  ],
  exports: [RolesService, ROLES_PUBLIC_SERVICE],
})
export class RolesModule {}
