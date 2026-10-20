import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FEATURE_FLAGS_PUBLIC_SERVICE, SETTINGS_PUBLIC_SERVICE } from './contracts/index.js';
import { FeatureFlagsController } from './controllers/feature-flags.controller.js';
import { SettingsController } from './controllers/settings.controller.js';
import { FeatureFlagHistoryEntity } from './entities/feature-flag-history.entity.js';
import { FeatureFlagEntity } from './entities/feature-flag.entity.js';
import { SettingGroupEntity } from './entities/setting-group.entity.js';
import { SystemSettingHistoryEntity } from './entities/system-setting-history.entity.js';
import { SystemSettingScopeEntity } from './entities/system-setting-scope.entity.js';
import { SystemSettingEntity } from './entities/system-setting.entity.js';
import { FeatureFlagHistoryRepository } from './repositories/feature-flag-history.repository.js';
import { FeatureFlagRepository } from './repositories/feature-flag.repository.js';
import { SettingGroupRepository } from './repositories/setting-group.repository.js';
import { SystemSettingHistoryRepository } from './repositories/system-setting-history.repository.js';
import { SystemSettingScopeRepository } from './repositories/system-setting-scope.repository.js';
import { SystemSettingRepository } from './repositories/system-setting.repository.js';
import { FeatureFlagsService } from './services/feature-flags.service.js';
import { SettingsService } from './services/settings.service.js';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SettingGroupEntity,
      SystemSettingEntity,
      SystemSettingScopeEntity,
      SystemSettingHistoryEntity,
      FeatureFlagEntity,
      FeatureFlagHistoryEntity,
    ]),
  ],
  controllers: [SettingsController, FeatureFlagsController],
  providers: [
    SettingGroupRepository,
    SystemSettingRepository,
    SystemSettingScopeRepository,
    SystemSettingHistoryRepository,
    FeatureFlagRepository,
    FeatureFlagHistoryRepository,
    SettingsService,
    FeatureFlagsService,
    {
      provide: SETTINGS_PUBLIC_SERVICE,
      useExisting: SettingsService,
    },
    {
      provide: FEATURE_FLAGS_PUBLIC_SERVICE,
      useExisting: FeatureFlagsService,
    },
  ],
  exports: [
    SettingsService,
    FeatureFlagsService,
    SETTINGS_PUBLIC_SERVICE,
    FEATURE_FLAGS_PUBLIC_SERVICE,
    SettingGroupRepository,
    SystemSettingRepository,
    SystemSettingScopeRepository,
    SystemSettingHistoryRepository,
    FeatureFlagRepository,
    FeatureFlagHistoryRepository,
  ],
})
export class SettingsModule {}
