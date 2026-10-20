import { Global, Module } from '@nestjs/common';
import { CodeRegistryService, defaultCodeRegistry } from './contracts/code-lookup.contract.js';
import {
  FeatureFlagRegistryService,
  defaultFeatureFlagRegistry,
} from './contracts/feature-flag.contract.js';
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
  ],
  exports: [CodeRegistryService, SettingRegistryService, FeatureFlagRegistryService],
})
export class KernelModule {}
