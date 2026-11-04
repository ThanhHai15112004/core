import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { SessionsModule } from '@modules/sessions/index.js';
import { CredentialsModule } from '@modules/credentials/index.js';
import { MFA_PUBLIC_SERVICE } from './contracts/index.js';
import { MfaController } from './controllers/mfa.controller.js';
import { AuthMfaConfigEntity } from './entities/auth-mfa-config.entity.js';
import { AuthMfaConfigRepository } from './repositories/auth-mfa-config.repository.js';
import { MfaService } from './services/mfa.service.js';
import enMfa from './locales/en/mfa.json' with { type: 'json' };
import viMfa from './locales/vi/mfa.json' with { type: 'json' };

new CoreI18nService().registerNamespace('mfa', { vi: viMfa, en: enMfa });
new CoreI18nService().registerNamespace('auth', { vi: viMfa, en: enMfa });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    TypeOrmModule.forFeature([AuthMfaConfigEntity]),
    UsersModule,
    SessionsModule,
    CredentialsModule,
  ],
  controllers: [MfaController],
  providers: [
    AuthMfaConfigRepository,
    MfaService,
    {
      provide: MFA_PUBLIC_SERVICE,
      useExisting: MfaService,
    },
  ],
  exports: [MfaService, MFA_PUBLIC_SERVICE],
})
export class MfaModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('mfa', { vi: viMfa, en: enMfa });
    i18n?.registerNamespace('auth', { vi: viMfa, en: enMfa });
  }
}
