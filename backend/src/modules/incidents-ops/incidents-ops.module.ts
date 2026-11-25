import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { INCIDENTS_OPS_PUBLIC_SERVICE } from './contracts/index.js';
import { IncidentsOpsController } from './controllers/incidents-ops.controller.js';
import { AlertOwnerMappingEntity } from './entities/alert-owner-mapping.entity.js';
import { IncidentPostmortemEntity } from './entities/incident-postmortem.entity.js';
import { IncidentRunbookEntity } from './entities/incident-runbook.entity.js';
import { IncidentSeverityPolicyEntity } from './entities/incident-severity-policy.entity.js';
import { IncidentEntity } from './entities/incident.entity.js';
import { SiemDispatchLogEntity } from './entities/siem-dispatch-log.entity.js';
import enIncidentsOps from './locales/en/incidents-ops.json' with { type: 'json' };
import viIncidentsOps from './locales/vi/incidents-ops.json' with { type: 'json' };
import { AlertOwnerMappingRepository } from './repositories/alert-owner-mapping.repository.js';
import { IncidentPostmortemRepository } from './repositories/incident-postmortem.repository.js';
import { IncidentRunbookRepository } from './repositories/incident-runbook.repository.js';
import { IncidentSeverityPolicyRepository } from './repositories/incident-severity-policy.repository.js';
import { IncidentRepository } from './repositories/incident.repository.js';
import { SiemDispatchLogRepository } from './repositories/siem-dispatch-log.repository.js';
import { IncidentGovernanceService } from './services/incident-governance.service.js';
import { IncidentLifecycleService } from './services/incident-lifecycle.service.js';
import { SiemDispatcherService } from './services/siem-dispatcher.service.js';

new CoreI18nService().registerNamespace('incidentsOps', {
  vi: viIncidentsOps,
  en: enIncidentsOps,
});

@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      IncidentSeverityPolicyEntity,
      IncidentRunbookEntity,
      AlertOwnerMappingEntity,
      IncidentEntity,
      IncidentPostmortemEntity,
      SiemDispatchLogEntity,
    ]),
  ],
  controllers: [IncidentsOpsController],
  providers: [
    IncidentSeverityPolicyRepository,
    IncidentRunbookRepository,
    AlertOwnerMappingRepository,
    IncidentRepository,
    IncidentPostmortemRepository,
    SiemDispatchLogRepository,
    IncidentGovernanceService,
    IncidentLifecycleService,
    SiemDispatcherService,
    {
      provide: INCIDENTS_OPS_PUBLIC_SERVICE,
      useExisting: IncidentLifecycleService,
    },
  ],
  exports: [
    IncidentGovernanceService,
    IncidentLifecycleService,
    SiemDispatcherService,
    INCIDENTS_OPS_PUBLIC_SERVICE,
  ],
})
export class IncidentsOpsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('incidentsOps', {
      vi: viIncidentsOps,
      en: enIncidentsOps,
    });
  }
}
