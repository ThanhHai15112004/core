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
  ],
})
export class KernelModule {}
