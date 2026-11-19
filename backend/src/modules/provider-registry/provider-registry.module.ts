import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { PROVIDER_REGISTRY_PUBLIC_SERVICE } from './contracts/index.js';
import { ProviderRegistryController } from './controllers/provider-registry.controller.js';
import { ProviderConfigHistoryEntity } from './entities/provider-config-history.entity.js';
import { ProviderHealthCheckEntity } from './entities/provider-health-check.entity.js';
import { ProviderMetricBucketEntity } from './entities/provider-metric-bucket.entity.js';
import { ProviderRegistryEntryEntity } from './entities/provider-registry-entry.entity.js';
import { ProviderUnitAssignmentEntity } from './entities/provider-unit-assignment.entity.js';
import enProviderRegistry from './locales/en/provider-registry.json' with { type: 'json' };
import viProviderRegistry from './locales/vi/provider-registry.json' with { type: 'json' };
import { ProviderConfigHistoryRepository } from './repositories/provider-config-history.repository.js';
import { ProviderHealthCheckRepository } from './repositories/provider-health-check.repository.js';
import { ProviderMetricBucketRepository } from './repositories/provider-metric-bucket.repository.js';
import { ProviderRegistryEntryRepository } from './repositories/provider-registry-entry.repository.js';
import { ProviderUnitAssignmentRepository } from './repositories/provider-unit-assignment.repository.js';
import { ProviderEntriesService } from './services/provider-entries.service.js';
import { ProviderHealthTelemetryService } from './services/provider-health-telemetry.service.js';
import { ProviderHistoryService } from './services/provider-history.service.js';
import { ProviderRegistryService } from './services/provider-registry.service.js';
import { ProviderUnitAssignmentsService } from './services/provider-unit-assignments.service.js';

new CoreI18nService().registerNamespace('provider-registry', {
  vi: viProviderRegistry,
  en: enProviderRegistry,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    OrganizationsModule,
    TypeOrmModule.forFeature([
      ProviderRegistryEntryEntity,
      ProviderUnitAssignmentEntity,
      ProviderHealthCheckEntity,
      ProviderMetricBucketEntity,
      ProviderConfigHistoryEntity,
    ]),
  ],
  controllers: [ProviderRegistryController],
  providers: [
    ProviderRegistryEntryRepository,
    ProviderUnitAssignmentRepository,
    ProviderHealthCheckRepository,
    ProviderMetricBucketRepository,
    ProviderConfigHistoryRepository,
    ProviderHistoryService,
    ProviderEntriesService,
    ProviderUnitAssignmentsService,
    ProviderHealthTelemetryService,
    ProviderRegistryService,
    {
      provide: PROVIDER_REGISTRY_PUBLIC_SERVICE,
      useExisting: ProviderRegistryService,
    },
  ],
  exports: [ProviderRegistryService, PROVIDER_REGISTRY_PUBLIC_SERVICE],
})
export class ProviderRegistryModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('provider-registry', {
      vi: viProviderRegistry,
      en: enProviderRegistry,
    });
  }
}
