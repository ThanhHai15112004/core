import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { StorageModule } from '@packages/storage/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { UsersModule } from '@modules/users/index.js';
import { FILES_PUBLIC_SERVICE } from './contracts/index.js';
import { FilesController } from './controllers/files.controller.js';
import { FileFolderEntity } from './entities/file-folder.entity.js';
import { FilePermissionEntity } from './entities/file-permission.entity.js';
import { FileRecordEntity } from './entities/file-record.entity.js';
import { FileUsageEntity } from './entities/file-usage.entity.js';
import { FilesMapper } from './mappers/files.mapper.js';
import { FileFoldersRepository } from './repositories/file-folders.repository.js';
import { FilePermissionsRepository } from './repositories/file-permissions.repository.js';
import { FileUsagesRepository } from './repositories/file-usages.repository.js';
import { FilesRepository } from './repositories/files.repository.js';
import { FileValidationService } from './services/file-validation.service.js';
import { FilesService } from './services/files.service.js';
import enFiles from './locales/en/files.json' with { type: 'json' };
import viFiles from './locales/vi/files.json' with { type: 'json' };

new CoreI18nService().registerNamespace('files', { vi: viFiles, en: enFiles });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    StorageModule,
    OrganizationsModule,
    UsersModule,
    TypeOrmModule.forFeature([
      FileFolderEntity,
      FileRecordEntity,
      FileUsageEntity,
      FilePermissionEntity,
    ]),
  ],
  controllers: [FilesController],
  providers: [
    FileFoldersRepository,
    FilesRepository,
    FileUsagesRepository,
    FilePermissionsRepository,
    FilesMapper,
    FileValidationService,
    FilesService,
    {
      provide: FILES_PUBLIC_SERVICE,
      useExisting: FilesService,
    },
  ],
  exports: [FilesService, FileValidationService, FILES_PUBLIC_SERVICE],
})
export class FilesModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('files', { vi: viFiles, en: enFiles });
  }
}
