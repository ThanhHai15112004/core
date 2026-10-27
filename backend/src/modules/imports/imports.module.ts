import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { CodesModule } from '@modules/codes/index.js';
import { IMPORTS_PUBLIC_SERVICE } from './contracts/index.js';
import { ImportHistoryEntity } from './entities/import-history.entity.js';
import { ImportHistoryRepository } from './repositories/import-history.repository.js';
import { ImportsService } from './services/imports.service.js';
import { ImportsController } from './controllers/imports.controller.js';
import enImports from './locales/en/imports.json' with { type: 'json' };
import viImports from './locales/vi/imports.json' with { type: 'json' };

new CoreI18nService().registerNamespace('imports', { vi: viImports, en: enImports });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    UsersModule,
    OrganizationsModule,
    CodesModule,
    TypeOrmModule.forFeature([ImportHistoryEntity]),
  ],
  controllers: [ImportsController],
  providers: [
    ImportHistoryRepository,
    ImportsService,
    {
      provide: IMPORTS_PUBLIC_SERVICE,
      useExisting: ImportsService,
    },
  ],
  exports: [ImportsService, IMPORTS_PUBLIC_SERVICE],
})
export class ImportsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('imports', { vi: viImports, en: enImports });
  }
}
