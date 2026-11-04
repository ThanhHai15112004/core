import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { PermissionsModule } from '@modules/permissions/index.js';
import { ROLES_PUBLIC_SERVICE } from './contracts/index.js';
import { RoleEntity } from './entities/role.entity.js';
import { RolePermissionEntity } from './entities/role-permission.entity.js';
import { UserRoleEntity } from './entities/user-role.entity.js';
import { RoleRepository } from './repositories/role.repository.js';
import { RolePermissionRepository } from './repositories/role-permission.repository.js';
import { UserRoleRepository } from './repositories/user-role.repository.js';
import { RolesMapper } from './mappers/roles.mapper.js';
import { RolesService } from './services/roles.service.js';
import { RolesController } from './controllers/roles.controller.js';
import enRoles from './locales/en/roles.json' with { type: 'json' };
import viRoles from './locales/vi/roles.json' with { type: 'json' };

new CoreI18nService().registerNamespace('roles', { vi: viRoles, en: enRoles });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    PermissionsModule,
    TypeOrmModule.forFeature([RoleEntity, RolePermissionEntity, UserRoleEntity]),
  ],
  controllers: [RolesController],
  providers: [
    RoleRepository,
    RolePermissionRepository,
    UserRoleRepository,
    RolesMapper,
    RolesService,
    {
      provide: ROLES_PUBLIC_SERVICE,
      useExisting: RolesService,
    },
  ],
  exports: [RolesService, ROLES_PUBLIC_SERVICE],
})
export class RolesModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('roles', { vi: viRoles, en: enRoles });
  }
}
