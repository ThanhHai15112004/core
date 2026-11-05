import { Global, Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { I18N_MANAGEMENT_PUBLIC_SERVICE, LOCALIZATION_PUBLIC_SERVICE } from './contracts/index.js';
import { I18nController } from './controllers/i18n.controller.js';
import { I18nLocaleEntity } from './entities/i18n-locale.entity.js';
import { I18nTimezoneEntity } from './entities/i18n-timezone.entity.js';
import { I18nTranslationEntity } from './entities/i18n-translation.entity.js';
import enLocalization from './locales/en/localization.json' with { type: 'json' };
import viLocalization from './locales/vi/localization.json' with { type: 'json' };
import { I18nLocaleRepository } from './repositories/i18n-locale.repository.js';
import { I18nTimezoneRepository } from './repositories/i18n-timezone.repository.js';
import { I18nTranslationRepository } from './repositories/i18n-translation.repository.js';
import { I18nManagementService } from './services/i18n-management.service.js';

new CoreI18nService().registerNamespace('localization', {
  vi: viLocalization,
  en: enLocalization,
});
new CoreI18nService().registerNamespace('i18n', {
  vi: viLocalization,
  en: enLocalization,
});

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([I18nLocaleEntity, I18nTimezoneEntity, I18nTranslationEntity]),
  ],
  controllers: [I18nController],
  providers: [
    I18nLocaleRepository,
    I18nTimezoneRepository,
    I18nTranslationRepository,
    I18nManagementService,
    {
      provide: I18N_MANAGEMENT_PUBLIC_SERVICE,
      useExisting: I18nManagementService,
    },
    {
      provide: LOCALIZATION_PUBLIC_SERVICE,
      useExisting: I18nManagementService,
    },
  ],
  exports: [
    I18nManagementService,
    I18N_MANAGEMENT_PUBLIC_SERVICE,
    LOCALIZATION_PUBLIC_SERVICE,
    I18nLocaleRepository,
    I18nTimezoneRepository,
    I18nTranslationRepository,
  ],
})
export class LocalizationModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('localization', {
      vi: viLocalization,
      en: enLocalization,
    });
    i18n?.registerNamespace('i18n', {
      vi: viLocalization,
      en: enLocalization,
    });
  }
}
