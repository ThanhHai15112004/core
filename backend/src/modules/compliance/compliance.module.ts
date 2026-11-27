import { Module, type OnModuleInit, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { AuditModule } from '@modules/audit/index.js';
import { CodesModule } from '@modules/codes/index.js';
import { ExportsModule } from '@modules/exports/index.js';
import { FeatureFlagsModule } from '@modules/feature-flags/index.js';
import { FilesModule } from '@modules/files/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { ReportsModule } from '@modules/reports/index.js';
import { SequencesModule } from '@modules/sequences/index.js';
import { SettingsModule } from '@modules/settings/index.js';
import { COMPLIANCE_PUBLIC_SERVICE } from './contracts/index.js';
import { ComplianceController } from './controllers/compliance.controller.js';
import { ComplianceCheckHistoryEntity } from './entities/compliance-check-history.entity.js';
import { ComplianceControlEntity } from './entities/compliance-control.entity.js';
import { ComplianceEvidenceEntity } from './entities/compliance-evidence.entity.js';
import { ComplianceVendorDataAssessmentEntity } from './entities/compliance-vendor-data-assessment.entity.js';
import { ComplianceVendorEntity } from './entities/compliance-vendor.entity.js';
import enCompliance from './locales/en/compliance.json' with { type: 'json' };
import viCompliance from './locales/vi/compliance.json' with { type: 'json' };
import { ComplianceCheckHistoryRepository } from './repositories/compliance-check-history.repository.js';
import { ComplianceControlRepository } from './repositories/compliance-control.repository.js';
import { ComplianceEvidenceRepository } from './repositories/compliance-evidence.repository.js';
import { ComplianceVendorDataAssessmentRepository } from './repositories/compliance-vendor-data-assessment.repository.js';
import { ComplianceVendorRepository } from './repositories/compliance-vendor.repository.js';
import { ComplianceControlService } from './services/compliance-control.service.js';
import { ComplianceEvidenceService } from './services/compliance-evidence.service.js';
import { ComplianceReportService } from './services/compliance-report.service.js';
import { ComplianceVendorService } from './services/compliance-vendor.service.js';
import { ComplianceService } from './services/compliance.service.js';

new CoreI18nService().registerNamespace('compliance', {
  vi: viCompliance,
  en: enCompliance,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    AuditModule,
    FilesModule,
    ReportsModule,
    ExportsModule,
    NotificationsModule,
    SettingsModule,
    FeatureFlagsModule,
    CodesModule,
    SequencesModule,
    TypeOrmModule.forFeature([
      ComplianceControlEntity,
      ComplianceCheckHistoryEntity,
      ComplianceEvidenceEntity,
      ComplianceVendorEntity,
      ComplianceVendorDataAssessmentEntity,
    ]),
  ],
  controllers: [ComplianceController],
  providers: [
    ComplianceControlRepository,
    ComplianceCheckHistoryRepository,
    ComplianceEvidenceRepository,
    ComplianceVendorRepository,
    ComplianceVendorDataAssessmentRepository,
    ComplianceControlService,
    ComplianceEvidenceService,
    ComplianceVendorService,
    ComplianceReportService,
    ComplianceService,
    {
      provide: COMPLIANCE_PUBLIC_SERVICE,
      useExisting: ComplianceService,
    },
  ],
  exports: [
    ComplianceService,
    ComplianceControlService,
    ComplianceEvidenceService,
    ComplianceVendorService,
    ComplianceReportService,
    COMPLIANCE_PUBLIC_SERVICE,
  ],
})
export class ComplianceModule implements OnModuleInit {
  constructor(
    private readonly reportService: ComplianceReportService,
    @Optional() i18n?: CoreI18nService,
  ) {
    i18n?.registerNamespace('compliance', {
      vi: viCompliance,
      en: enCompliance,
    });
  }

  public onModuleInit(): void {
    this.reportService.ensureModuleReportsRegistered();
  }
}
