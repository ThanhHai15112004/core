import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { CodesModule } from '@modules/codes/index.js';
import { EXPORTS_PUBLIC_SERVICE } from './contracts/index.js';
import { ExportHistoryEntity } from './entities/export-history.entity.js';
import { ExportHistoryRepository } from './repositories/export-history.repository.js';
import { ExportsService } from './services/exports.service.js';
import { ExportsController } from './controllers/exports.controller.js';
import enExports from './locales/en/exports.json' with { type: 'json' };
import viExports from './locales/vi/exports.json' with { type: 'json' };

new CoreI18nService().registerNamespace('exports', { vi: viExports, en: enExports });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    UsersModule,
    OrganizationsModule,
    CodesModule,
    TypeOrmModule.forFeature([ExportHistoryEntity]),
  ],
  controllers: [ExportsController],
  providers: [
    ExportHistoryRepository,
    ExportsService,
    {
      provide: EXPORTS_PUBLIC_SERVICE,
      useExisting: ExportsService,
    },
  ],
  exports: [ExportsService, EXPORTS_PUBLIC_SERVICE],
})
export class ExportsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('exports', { vi: viExports, en: enExports });
  }
}
