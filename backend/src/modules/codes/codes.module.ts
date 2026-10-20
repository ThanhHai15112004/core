import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { CODES_PUBLIC_SERVICE } from './contracts/index.js';
import { CodeTypeEntity } from './entities/code-type.entity.js';
import { CodeValueEntity } from './entities/code-value.entity.js';
import { CodeTypeRepository } from './repositories/code-type.repository.js';
import { CodeValueRepository } from './repositories/code-value.repository.js';
import { CodesService } from './services/codes.service.js';
import { CodesController } from './controllers/codes.controller.js';
import enCodes from './locales/en/codes.json' with { type: 'json' };
import viCodes from './locales/vi/codes.json' with { type: 'json' };

new CoreI18nService().registerNamespace('codes', { vi: viCodes, en: enCodes });

@Module({
  imports: [TypeOrmModule.forFeature([CodeTypeEntity, CodeValueEntity])],
  controllers: [CodesController],
  providers: [
    CodeTypeRepository,
    CodeValueRepository,
    CodesService,
    {
      provide: CODES_PUBLIC_SERVICE,
      useExisting: CodesService,
    },
  ],
  exports: [CodesService, CODES_PUBLIC_SERVICE],
})
export class CodesModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('codes', { vi: viCodes, en: enCodes });
  }
}
