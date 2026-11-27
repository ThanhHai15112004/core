import { Global, Module } from '@nestjs/common';
import { PROVIDER_REGISTRY_PORT } from './contracts/provider-registry.contract.js';
import { CodeRegistryService, defaultCodeRegistry } from './registries/code-registry.service.js';
import {
  FeatureFlagRegistryService,
  defaultFeatureFlagRegistry,
} from './registries/feature-flag-registry.service.js';
import { MenuRegistryService, defaultMenuRegistry } from './registries/menu-registry.service.js';
import {
  SequenceRegistryService,
  defaultSequenceRegistry,
} from './registries/sequence-registry.service.js';
import {
  SettingRegistryService,
  defaultSettingRegistry,
} from './registries/setting-registry.service.js';
import {
  ImportRegistryService,
  defaultImportRegistry,
} from './registries/import-registry.service.js';
import {
  ExportRegistryService,
  defaultExportRegistry,
} from './registries/export-registry.service.js';
import {
  ReportRegistryService,
  defaultReportRegistry,
} from './registries/report-registry.service.js';
import {
  SearchRegistryService,
  defaultSearchRegistry,
} from './registries/search-registry.service.js';
import {
  CustomFieldRegistryService,
  defaultCustomFieldRegistry,
} from './registries/custom-field-registry.service.js';
import {
  ProviderRegistryService,
  defaultProviderRegistry,
} from './registries/provider-registry.service.js';
import { DOMAIN_EVENT_BUS_PORT } from './contracts/domain-event.contract.js';
import {
  DomainEventBusService,
  defaultDomainEventBus,
} from './registries/domain-event-bus.service.js';
import { OUTBOX_PUBLISHER_PORT } from './contracts/outbox.contract.js';
import {
  OutboxPublisherService,
  defaultOutboxPublisher,
} from './registries/outbox-publisher.service.js';
import { IDEMPOTENCY_PORT } from './contracts/idempotency.contract.js';
import {
  IdempotencyRegistryService,
  defaultIdempotencyRegistry,
} from './registries/idempotency-registry.service.js';
import { RECONCILIATION_PORT } from './contracts/reconciliation.contract.js';
import {
  ReconciliationRegistryService,
  defaultReconciliationRegistry,
} from './registries/reconciliation-registry.service.js';
import {
  DataGovernanceHookRegistry,
  defaultDataGovernanceHookRegistry,
} from './registries/data-governance-hook.registry.js';

@Global()
@Module({
  providers: [
    {
      provide: CodeRegistryService,
      useValue: defaultCodeRegistry,
    },
    {
      provide: SettingRegistryService,
      useValue: defaultSettingRegistry,
    },
    {
      provide: FeatureFlagRegistryService,
      useValue: defaultFeatureFlagRegistry,
    },
    {
      provide: SequenceRegistryService,
      useValue: defaultSequenceRegistry,
    },
    {
      provide: MenuRegistryService,
      useValue: defaultMenuRegistry,
    },
    {
      provide: ImportRegistryService,
      useValue: defaultImportRegistry,
    },
    {
      provide: ExportRegistryService,
      useValue: defaultExportRegistry,
    },
    {
      provide: ReportRegistryService,
      useValue: defaultReportRegistry,
    },
    {
      provide: SearchRegistryService,
      useValue: defaultSearchRegistry,
    },
    {
      provide: CustomFieldRegistryService,
      useValue: defaultCustomFieldRegistry,
    },
    {
      provide: ProviderRegistryService,
      useValue: defaultProviderRegistry,
    },
    {
      provide: PROVIDER_REGISTRY_PORT,
      useValue: defaultProviderRegistry,
    },
    {
      provide: DomainEventBusService,
      useValue: defaultDomainEventBus,
    },
    {
      provide: DOMAIN_EVENT_BUS_PORT,
      useValue: defaultDomainEventBus,
    },
    {
      provide: OutboxPublisherService,
      useValue: defaultOutboxPublisher,
    },
    {
      provide: OUTBOX_PUBLISHER_PORT,
      useValue: defaultOutboxPublisher,
    },
    {
      provide: IdempotencyRegistryService,
      useValue: defaultIdempotencyRegistry,
    },
    {
      provide: IDEMPOTENCY_PORT,
      useValue: defaultIdempotencyRegistry,
    },
    {
      provide: ReconciliationRegistryService,
      useValue: defaultReconciliationRegistry,
    },
    {
      provide: RECONCILIATION_PORT,
      useValue: defaultReconciliationRegistry,
    },
    {
      provide: DataGovernanceHookRegistry,
      useValue: defaultDataGovernanceHookRegistry,
    },
  ],
  exports: [
    CodeRegistryService,
    SettingRegistryService,
    FeatureFlagRegistryService,
    SequenceRegistryService,
    MenuRegistryService,
    ImportRegistryService,
    ExportRegistryService,
    ReportRegistryService,
    SearchRegistryService,
    CustomFieldRegistryService,
    ProviderRegistryService,
    PROVIDER_REGISTRY_PORT,
    DomainEventBusService,
    DOMAIN_EVENT_BUS_PORT,
    OutboxPublisherService,
    OUTBOX_PUBLISHER_PORT,
    IdempotencyRegistryService,
    IDEMPOTENCY_PORT,
    ReconciliationRegistryService,
    RECONCILIATION_PORT,
    DataGovernanceHookRegistry,
  ],
})
export class KernelModule {}
