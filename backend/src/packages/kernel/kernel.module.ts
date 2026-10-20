import { Global, Module } from '@nestjs/common';
import { CodeRegistryService, defaultCodeRegistry } from './contracts/code-lookup.contract.js';
import {
  FeatureFlagRegistryService,
  defaultFeatureFlagRegistry,
} from './contracts/feature-flag.contract.js';
import { MenuRegistryService, defaultMenuRegistry } from './contracts/menu.contract.js';
import { SequenceRegistryService, defaultSequenceRegistry } from './contracts/sequence.contract.js';
import {
  SettingRegistryService,
  defaultSettingRegistry,
} from './contracts/setting-lookup.contract.js';

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
  ],
  exports: [
    CodeRegistryService,
    SettingRegistryService,
    FeatureFlagRegistryService,
    SequenceRegistryService,
    MenuRegistryService,
  ],
})
export class KernelModule {}
