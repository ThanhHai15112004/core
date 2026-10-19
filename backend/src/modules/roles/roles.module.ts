import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { ROLES_PUBLIC_SERVICE } from './contracts/index.js';
import { PermissionEntity } from './entities/permission.entity.js';
import { RoleEntity } from './entities/role.entity.js';
import { RolePermissionEntity } from './entities/role-permission.entity.js';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { PermissionRepository } from './repositories/permission.repository.js';
import { RoleRepository } from './repositories/role.repository.js';
import { RolePermissionRepository } from './repositories/role-permission.repository.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { RolesMapper } from './mappers/roles.mapper.js';
import { RolesService } from './services/roles.service.js';
import { RolesController } from './controllers/roles.controller.js';
import enRoles from './locales/en/roles.json' with { type: 'json' };
import viRoles from './locales/vi/roles.json' with { type: 'json' };

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([PermissionEntity, RoleEntity, RolePermissionEntity, AuditLogEntity]),
  ],
  controllers: [RolesController],
  providers: [
    PermissionRepository,
    RoleRepository,
    RolePermissionRepository,
    AuditLogRepository,
    RolesMapper,
    RolesService,
    {
      provide: ROLES_PUBLIC_SERVICE,
      useExisting: RolesService,
    },
  ],
  exports: [RolesService, ROLES_PUBLIC_SERVICE, AuditLogRepository],
})
export class RolesModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('roles', { vi: viRoles, en: enRoles });
  }
}
