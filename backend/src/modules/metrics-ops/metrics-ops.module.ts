import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { METRICS_OPS_PUBLIC_SERVICE } from './contracts/index.js';
import { MetricsOpsController } from './controllers/metrics-ops.controller.js';
import { AlertEventEntity } from './entities/alert-event.entity.js';
import { AlertRuleEntity } from './entities/alert-rule.entity.js';
import enMetricsOps from './locales/en/metrics-ops.json' with { type: 'json' };
import viMetricsOps from './locales/vi/metrics-ops.json' with { type: 'json' };
import { AlertEventRepository } from './repositories/alert-event.repository.js';
import { AlertRuleRepository } from './repositories/alert-rule.repository.js';
import { AlertDispatcherService } from './services/alert-dispatcher.service.js';
import { AlertEvaluatorService } from './services/alert-evaluator.service.js';
import { AlertEventsService } from './services/alert-events.service.js';
import { AlertRulesService } from './services/alert-rules.service.js';
import { MetricsCollectorQueryService } from './services/metrics-collector-query.service.js';
import { MetricsOpsService } from './services/metrics-ops.service.js';

new CoreI18nService().registerNamespace('metricsOps', {
  vi: viMetricsOps,
  en: enMetricsOps,
});

@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    TypeOrmModule.forFeature([AlertRuleEntity, AlertEventEntity]),
  ],
  controllers: [MetricsOpsController],
  providers: [
    AlertRuleRepository,
    AlertEventRepository,
    MetricsCollectorQueryService,
    AlertDispatcherService,
    AlertRulesService,
    AlertEventsService,
    AlertEvaluatorService,
    MetricsOpsService,
    {
      provide: METRICS_OPS_PUBLIC_SERVICE,
      useExisting: MetricsOpsService,
    },
  ],
  exports: [
    MetricsOpsService,
    AlertRulesService,
    AlertEventsService,
    AlertEvaluatorService,
    METRICS_OPS_PUBLIC_SERVICE,
  ],
})
export class MetricsOpsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('metricsOps', {
      vi: viMetricsOps,
      en: enMetricsOps,
    });
  }
}
