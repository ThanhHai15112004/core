import { Global, Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { FEATURE_FLAGS_PUBLIC_SERVICE } from './contracts/index.js';
import { FeatureFlagsController } from './controllers/feature-flags.controller.js';
import { FeatureFlagHistoryEntity } from './entities/feature-flag-history.entity.js';
import { FeatureFlagEntity } from './entities/feature-flag.entity.js';
import enFeatureFlags from './locales/en/feature-flags.json' with { type: 'json' };
import viFeatureFlags from './locales/vi/feature-flags.json' with { type: 'json' };
import { FeatureFlagHistoryRepository } from './repositories/feature-flag-history.repository.js';
import { FeatureFlagRepository } from './repositories/feature-flag.repository.js';
import { FeatureFlagsService } from './services/feature-flags.service.js';

new CoreI18nService().registerNamespace('feature-flags', {
  vi: viFeatureFlags,
  en: enFeatureFlags,
});

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([FeatureFlagEntity, FeatureFlagHistoryEntity])],
  controllers: [FeatureFlagsController],
  providers: [
    FeatureFlagRepository,
    FeatureFlagHistoryRepository,
    FeatureFlagsService,
    {
      provide: FEATURE_FLAGS_PUBLIC_SERVICE,
      useExisting: FeatureFlagsService,
    },
  ],
  exports: [
    FeatureFlagsService,
    FEATURE_FLAGS_PUBLIC_SERVICE,
    FeatureFlagRepository,
    FeatureFlagHistoryRepository,
  ],
})
export class FeatureFlagsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('feature-flags', {
      vi: viFeatureFlags,
      en: enFeatureFlags,
    });
  }
}
