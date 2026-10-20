import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  FEATURE_FLAGS_PUBLIC_SERVICE,
  I18N_MANAGEMENT_PUBLIC_SERVICE,
  SETTINGS_PUBLIC_SERVICE,
} from './contracts/index.js';
import { FeatureFlagsController } from './controllers/feature-flags.controller.js';
import { I18nController } from './controllers/i18n.controller.js';
import { SettingsController } from './controllers/settings.controller.js';
import { FeatureFlagHistoryEntity } from './entities/feature-flag-history.entity.js';
import { FeatureFlagEntity } from './entities/feature-flag.entity.js';
import { I18nLocaleEntity } from './entities/i18n-locale.entity.js';
import { I18nTimezoneEntity } from './entities/i18n-timezone.entity.js';
import { I18nTranslationEntity } from './entities/i18n-translation.entity.js';
import { SettingGroupEntity } from './entities/setting-group.entity.js';
import { SystemSettingHistoryEntity } from './entities/system-setting-history.entity.js';
import { SystemSettingScopeEntity } from './entities/system-setting-scope.entity.js';
import { SystemSettingEntity } from './entities/system-setting.entity.js';
import { FeatureFlagHistoryRepository } from './repositories/feature-flag-history.repository.js';
import { FeatureFlagRepository } from './repositories/feature-flag.repository.js';
import { I18nLocaleRepository } from './repositories/i18n-locale.repository.js';
import { I18nTimezoneRepository } from './repositories/i18n-timezone.repository.js';
import { I18nTranslationRepository } from './repositories/i18n-translation.repository.js';
import { SettingGroupRepository } from './repositories/setting-group.repository.js';
import { SystemSettingHistoryRepository } from './repositories/system-setting-history.repository.js';
import { SystemSettingScopeRepository } from './repositories/system-setting-scope.repository.js';
import { SystemSettingRepository } from './repositories/system-setting.repository.js';
import { FeatureFlagsService } from './services/feature-flags.service.js';
import { I18nManagementService } from './services/i18n-management.service.js';
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
      I18nLocaleEntity,
      I18nTimezoneEntity,
      I18nTranslationEntity,
    ]),
  ],
  controllers: [SettingsController, FeatureFlagsController, I18nController],
  providers: [
    SettingGroupRepository,
    SystemSettingRepository,
    SystemSettingScopeRepository,
    SystemSettingHistoryRepository,
    FeatureFlagRepository,
    FeatureFlagHistoryRepository,
    I18nLocaleRepository,
    I18nTimezoneRepository,
    I18nTranslationRepository,
    SettingsService,
    FeatureFlagsService,
    I18nManagementService,
    {
      provide: SETTINGS_PUBLIC_SERVICE,
      useExisting: SettingsService,
    },
    {
      provide: FEATURE_FLAGS_PUBLIC_SERVICE,
      useExisting: FeatureFlagsService,
    },
    {
      provide: I18N_MANAGEMENT_PUBLIC_SERVICE,
      useExisting: I18nManagementService,
    },
  ],
  exports: [
    SettingsService,
    FeatureFlagsService,
    I18nManagementService,
    SETTINGS_PUBLIC_SERVICE,
    FEATURE_FLAGS_PUBLIC_SERVICE,
    I18N_MANAGEMENT_PUBLIC_SERVICE,
    SettingGroupRepository,
    SystemSettingRepository,
    SystemSettingScopeRepository,
    SystemSettingHistoryRepository,
    FeatureFlagRepository,
    FeatureFlagHistoryRepository,
    I18nLocaleRepository,
    I18nTimezoneRepository,
    I18nTranslationRepository,
  ],
})
export class SettingsModule {}
