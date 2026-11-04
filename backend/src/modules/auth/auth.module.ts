import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule, USER_IDENTITY_RESOLVER } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { SessionsModule } from '@modules/sessions/index.js';
import { CredentialsModule } from '@modules/credentials/index.js';
import { MfaModule } from '@modules/mfa/index.js';
import { MachineIdentitiesModule } from '@modules/machine-identities/index.js';
import { AUTH_PUBLIC_SERVICE } from './contracts/index.js';
import { AuthController } from './controllers/auth.controller.js';
import { AuthVerificationCodeEntity } from './entities/auth-verification-code.entity.js';
import { AuthVerificationCodeRepository } from './repositories/auth-verification-code.repository.js';
import { AuthService } from './services/auth.service.js';
import { UserIdentityResolverService } from './services/user-identity-resolver.service.js';
import { VerificationService } from './services/verification.service.js';
import enAuth from './locales/en/auth.json' with { type: 'json' };
import viAuth from './locales/vi/auth.json' with { type: 'json' };

new CoreI18nService().registerNamespace('auth', { vi: viAuth, en: enAuth });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    TypeOrmModule.forFeature([AuthVerificationCodeEntity]),
    UsersModule,
    SessionsModule,
    CredentialsModule,
    MfaModule,
    MachineIdentitiesModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthVerificationCodeRepository,
    VerificationService,
    AuthService,
    UserIdentityResolverService,
    {
      provide: AUTH_PUBLIC_SERVICE,
      useExisting: AuthService,
    },
    {
      provide: USER_IDENTITY_RESOLVER,
      useExisting: UserIdentityResolverService,
    },
  ],
  exports: [
    AuthService,
    VerificationService,
    UserIdentityResolverService,
    AUTH_PUBLIC_SERVICE,
    USER_IDENTITY_RESOLVER,
  ],
})
export class AuthModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('auth', { vi: viAuth, en: enAuth });
  }
}
