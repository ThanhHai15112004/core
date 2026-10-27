import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { ExportsModule } from '@modules/exports/index.js';
import { REPORTS_PUBLIC_SERVICE } from './contracts/index.js';
import { ReportScheduleEntity } from './entities/report-schedule.entity.js';
import { ReportHistoryEntity } from './entities/report-history.entity.js';
import { ReportScheduleRepository } from './repositories/report-schedule.repository.js';
import { ReportHistoryRepository } from './repositories/report-history.repository.js';
import { ReportsService } from './services/reports.service.js';
import { ReportsController } from './controllers/reports.controller.js';
import enReports from './locales/en/reports.json' with { type: 'json' };
import viReports from './locales/vi/reports.json' with { type: 'json' };

new CoreI18nService().registerNamespace('reports', { vi: viReports, en: enReports });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    UsersModule,
    ExportsModule,
    TypeOrmModule.forFeature([ReportScheduleEntity, ReportHistoryEntity]),
  ],
  controllers: [ReportsController],
  providers: [
    ReportScheduleRepository,
    ReportHistoryRepository,
    ReportsService,
    {
      provide: REPORTS_PUBLIC_SERVICE,
      useExisting: ReportsService,
    },
  ],
  exports: [ReportsService, REPORTS_PUBLIC_SERVICE],
})
export class ReportsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('reports', { vi: viReports, en: enReports });
  }
}
