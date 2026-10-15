import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { ROLES_PUBLIC_SERVICE } from './contracts/index.js';
import { PermissionEntity } from './entities/permission.entity.js';
import { RoleEntity } from './entities/role.entity.js';
import { RolePermissionEntity } from './entities/role-permission.entity.js';
import { PermissionRepository } from './repositories/permission.repository.js';
import { RoleRepository } from './repositories/role.repository.js';
import { RolePermissionRepository } from './repositories/role-permission.repository.js';
import { RolesMapper } from './mappers/roles.mapper.js';
import { RolesService } from './services/roles.service.js';
import { RolesController } from './controllers/roles.controller.js';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([PermissionEntity, RoleEntity, RolePermissionEntity]),
  ],
  controllers: [RolesController],
  providers: [
    PermissionRepository,
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
