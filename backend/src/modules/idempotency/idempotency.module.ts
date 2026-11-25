import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { IDEMPOTENCY_PUBLIC_SERVICE } from './contracts/index.js';
import { IdempotencyController } from './controllers/idempotency.controller.js';
import { IdempotencyRecordEntity } from './entities/idempotency-record.entity.js';
import enIdempotency from './locales/en/idempotency.json' with { type: 'json' };
import viIdempotency from './locales/vi/idempotency.json' with { type: 'json' };
import { IdempotencyRecordRepository } from './repositories/idempotency-record.repository.js';
import { IdempotencyStoreService } from './services/idempotency-store.service.js';
import { IdempotencyService } from './services/idempotency.service.js';

new CoreI18nService().registerNamespace('idempotency', {
  vi: viIdempotency,
  en: enIdempotency,
});

@Module({
  imports: [DatabaseModule, SecurityModule, TypeOrmModule.forFeature([IdempotencyRecordEntity])],
  controllers: [IdempotencyController],
  providers: [
    IdempotencyRecordRepository,
    IdempotencyStoreService,
    IdempotencyService,
    {
      provide: IDEMPOTENCY_PUBLIC_SERVICE,
      useExisting: IdempotencyService,
    },
  ],
  exports: [IdempotencyService, IdempotencyStoreService, IDEMPOTENCY_PUBLIC_SERVICE],
})
export class IdempotencyModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('idempotency', {
      vi: viIdempotency,
      en: enIdempotency,
    });
  }
}
