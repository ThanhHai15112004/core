import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { MACHINE_IDENTITIES_PUBLIC_SERVICE } from './contracts/index.js';
import { MachineIdentitiesController } from './controllers/machine-identities.controller.js';
import { AuthApiClientEntity } from './entities/auth-api-client.entity.js';
import { AuthServiceAccountEntity } from './entities/auth-service-account.entity.js';
import { AuthApiClientRepository } from './repositories/auth-api-client.repository.js';
import { AuthServiceAccountRepository } from './repositories/auth-service-account.repository.js';
import { ServiceAccountService } from './services/service-account.service.js';
import enMachineIdentities from './locales/en/machine-identities.json' with { type: 'json' };
import viMachineIdentities from './locales/vi/machine-identities.json' with { type: 'json' };

new CoreI18nService().registerNamespace('machine-identities', {
  vi: viMachineIdentities,
  en: enMachineIdentities,
});
new CoreI18nService().registerNamespace('auth', {
  vi: viMachineIdentities,
  en: enMachineIdentities,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    TypeOrmModule.forFeature([AuthServiceAccountEntity, AuthApiClientEntity]),
  ],
  controllers: [MachineIdentitiesController],
  providers: [
    AuthServiceAccountRepository,
    AuthApiClientRepository,
    ServiceAccountService,
    {
      provide: MACHINE_IDENTITIES_PUBLIC_SERVICE,
      useExisting: ServiceAccountService,
    },
  ],
  exports: [ServiceAccountService, MACHINE_IDENTITIES_PUBLIC_SERVICE],
})
export class MachineIdentitiesModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('machine-identities', {
      vi: viMachineIdentities,
      en: enMachineIdentities,
    });
    i18n?.registerNamespace('auth', {
      vi: viMachineIdentities,
      en: enMachineIdentities,
    });
  }
}
