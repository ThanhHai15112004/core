import { Global, Module } from '@nestjs/common';
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
  ],
  exports: [
    CodeRegistryService,
    SettingRegistryService,
    FeatureFlagRegistryService,
    SequenceRegistryService,
    MenuRegistryService,
    ImportRegistryService,
  ],
})
export class KernelModule {}
