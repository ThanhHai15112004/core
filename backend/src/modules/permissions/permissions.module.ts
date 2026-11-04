import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { PERMISSIONS_PUBLIC_SERVICE } from './contracts/index.js';
import { PermissionsController } from './controllers/permissions.controller.js';
import { PermissionEntity } from './entities/permission.entity.js';
import { PermissionRepository } from './repositories/permission.repository.js';
import { PermissionsService } from './services/permissions.service.js';
import enPermissions from './locales/en/permissions.json' with { type: 'json' };
import viPermissions from './locales/vi/permissions.json' with { type: 'json' };

new CoreI18nService().registerNamespace('permissions', {
  vi: viPermissions,
  en: enPermissions,
});

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([PermissionEntity]), SecurityModule],
  controllers: [PermissionsController],
  providers: [
    PermissionRepository,
    PermissionsService,
    {
      provide: PERMISSIONS_PUBLIC_SERVICE,
      useExisting: PermissionsService,
    },
  ],
  exports: [PermissionsService, PERMISSIONS_PUBLIC_SERVICE],
})
export class PermissionsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('permissions', { vi: viPermissions, en: enPermissions });
  }
}
