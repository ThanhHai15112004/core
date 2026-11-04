import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { AUDIT_PUBLIC_SERVICE } from './contracts/index.js';
import { AuditController } from './controllers/audit.controller.js';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { AuditService } from './services/audit.service.js';
import enAudit from './locales/en/audit.json' with { type: 'json' };
import viAudit from './locales/vi/audit.json' with { type: 'json' };

new CoreI18nService().registerNamespace('audit', {
  vi: viAudit,
  en: enAudit,
});

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([AuditLogEntity]), SecurityModule],
  controllers: [AuditController],
  providers: [
    AuditLogRepository,
    AuditService,
    {
      provide: AUDIT_PUBLIC_SERVICE,
      useExisting: AuditService,
    },
  ],
  exports: [AuditService, AUDIT_PUBLIC_SERVICE],
})
export class AuditModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('audit', { vi: viAudit, en: enAudit });
  }
}
