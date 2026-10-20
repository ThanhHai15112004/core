import { Global, Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  FEATURE_FLAGS_PUBLIC_SERVICE,
  I18N_MANAGEMENT_PUBLIC_SERVICE,
  SEQUENCES_PUBLIC_SERVICE,
  SETTINGS_PUBLIC_SERVICE,
} from './contracts/index.js';
import { FeatureFlagsController } from './controllers/feature-flags.controller.js';
import { I18nController } from './controllers/i18n.controller.js';
import { SequencesController } from './controllers/sequences.controller.js';
import { SettingsController } from './controllers/settings.controller.js';
import { FeatureFlagHistoryEntity } from './entities/feature-flag-history.entity.js';
import { FeatureFlagEntity } from './entities/feature-flag.entity.js';
import { I18nLocaleEntity } from './entities/i18n-locale.entity.js';
import { I18nTimezoneEntity } from './entities/i18n-timezone.entity.js';
import { I18nTranslationEntity } from './entities/i18n-translation.entity.js';
import { SequenceCounterEntity } from './entities/sequence-counter.entity.js';
import { SequenceRuleHistoryEntity } from './entities/sequence-rule-history.entity.js';
import { SequenceRuleEntity } from './entities/sequence-rule.entity.js';
import { SettingGroupEntity } from './entities/setting-group.entity.js';
import { SystemSettingHistoryEntity } from './entities/system-setting-history.entity.js';
import { SystemSettingScopeEntity } from './entities/system-setting-scope.entity.js';
import { SystemSettingEntity } from './entities/system-setting.entity.js';
import { FeatureFlagHistoryRepository } from './repositories/feature-flag-history.repository.js';
import { FeatureFlagRepository } from './repositories/feature-flag.repository.js';
import { I18nLocaleRepository } from './repositories/i18n-locale.repository.js';
import { I18nTimezoneRepository } from './repositories/i18n-timezone.repository.js';
import { I18nTranslationRepository } from './repositories/i18n-translation.repository.js';
import { SequenceCounterRepository } from './repositories/sequence-counter.repository.js';
import { SequenceRuleHistoryRepository } from './repositories/sequence-rule-history.repository.js';
import { SequenceRuleRepository } from './repositories/sequence-rule.repository.js';
import { SettingGroupRepository } from './repositories/setting-group.repository.js';
import { SystemSettingHistoryRepository } from './repositories/system-setting-history.repository.js';
import { SystemSettingScopeRepository } from './repositories/system-setting-scope.repository.js';
import { SystemSettingRepository } from './repositories/system-setting.repository.js';
import { FeatureFlagsService } from './services/feature-flags.service.js';
import { I18nManagementService } from './services/i18n-management.service.js';
import { SequencesService } from './services/sequences.service.js';
import { SettingsService } from './services/settings.service.js';
import enSettings from './locales/en/settings.json' with { type: 'json' };
import viSettings from './locales/vi/settings.json' with { type: 'json' };

new CoreI18nService().registerNamespace('settings', { vi: viSettings, en: enSettings });

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
      SequenceRuleEntity,
      SequenceCounterEntity,
      SequenceRuleHistoryEntity,
    ]),
  ],
  controllers: [SettingsController, FeatureFlagsController, I18nController, SequencesController],
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
    SequenceRuleRepository,
    SequenceCounterRepository,
    SequenceRuleHistoryRepository,
    SettingsService,
    FeatureFlagsService,
    I18nManagementService,
    SequencesService,
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
    {
      provide: SEQUENCES_PUBLIC_SERVICE,
      useExisting: SequencesService,
    },
  ],
  exports: [
    SettingsService,
    FeatureFlagsService,
    I18nManagementService,
    SequencesService,
    SETTINGS_PUBLIC_SERVICE,
    FEATURE_FLAGS_PUBLIC_SERVICE,
    I18N_MANAGEMENT_PUBLIC_SERVICE,
    SEQUENCES_PUBLIC_SERVICE,
    SettingGroupRepository,
    SystemSettingRepository,
    SystemSettingScopeRepository,
    SystemSettingHistoryRepository,
    FeatureFlagRepository,
    FeatureFlagHistoryRepository,
    I18nLocaleRepository,
    I18nTimezoneRepository,
    I18nTranslationRepository,
    SequenceRuleRepository,
    SequenceCounterRepository,
    SequenceRuleHistoryRepository,
  ],
})
export class SettingsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('settings', { vi: viSettings, en: enSettings });
  }
}
