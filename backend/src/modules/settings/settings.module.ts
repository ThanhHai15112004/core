import { Global, Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SETTINGS_PUBLIC_SERVICE } from './contracts/index.js';
import { SettingsController } from './controllers/settings.controller.js';
import { SettingGroupEntity } from './entities/setting-group.entity.js';
import { SystemSettingHistoryEntity } from './entities/system-setting-history.entity.js';
import { SystemSettingScopeEntity } from './entities/system-setting-scope.entity.js';
import { SystemSettingEntity } from './entities/system-setting.entity.js';
import enSettings from './locales/en/settings.json' with { type: 'json' };
import viSettings from './locales/vi/settings.json' with { type: 'json' };
import { SettingGroupRepository } from './repositories/setting-group.repository.js';
import { SystemSettingHistoryRepository } from './repositories/system-setting-history.repository.js';
import { SystemSettingScopeRepository } from './repositories/system-setting-scope.repository.js';
import { SystemSettingRepository } from './repositories/system-setting.repository.js';
import { SettingsService } from './services/settings.service.js';

new CoreI18nService().registerNamespace('settings', { vi: viSettings, en: enSettings });

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SettingGroupEntity,
      SystemSettingEntity,
      SystemSettingScopeEntity,
      SystemSettingHistoryEntity,
    ]),
  ],
  controllers: [SettingsController],
  providers: [
    SettingGroupRepository,
    SystemSettingRepository,
    SystemSettingScopeRepository,
    SystemSettingHistoryRepository,
    SettingsService,
    {
      provide: SETTINGS_PUBLIC_SERVICE,
      useExisting: SettingsService,
    },
  ],
  exports: [
    SettingsService,
    SETTINGS_PUBLIC_SERVICE,
    SettingGroupRepository,
    SystemSettingRepository,
    SystemSettingScopeRepository,
    SystemSettingHistoryRepository,
  ],
})
export class SettingsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('settings', { vi: viSettings, en: enSettings });
  }
}
