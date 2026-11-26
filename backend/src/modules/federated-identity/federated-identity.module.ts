import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { AuthModule } from '@modules/auth/index.js';
import { CredentialsModule } from '@modules/credentials/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { SessionsModule } from '@modules/sessions/index.js';
import { UsersModule } from '@modules/users/index.js';
import { GenericOidcAdapter } from './adapters/generic-oidc.adapter.js';
import { GoogleOAuthAdapter } from './adapters/google-oauth.adapter.js';
import { MicrosoftOAuthAdapter } from './adapters/microsoft-oauth.adapter.js';
import { FEDERATED_IDENTITY_PUBLIC_SERVICE, OAUTH_PROVIDER_REGISTRY } from './contracts/index.js';
import { FederatedIdentityController } from './controllers/federated-identity.controller.js';
import { FederatedAuthEventEntity } from './entities/federated-auth-event.entity.js';
import { FederatedAuthTransactionEntity } from './entities/federated-auth-transaction.entity.js';
import { FederatedIdentityProviderEntity } from './entities/federated-identity-provider.entity.js';
import { FederatedIdentityEntity } from './entities/federated-identity.entity.js';
import enFederatedIdentity from './locales/en/federated-identity.json' with { type: 'json' };
import viFederatedIdentity from './locales/vi/federated-identity.json' with { type: 'json' };
import { FederatedAuthEventRepository } from './repositories/federated-auth-event.repository.js';
import { FederatedAuthTransactionRepository } from './repositories/federated-auth-transaction.repository.js';
import { FederatedIdentityProviderRepository } from './repositories/federated-identity-provider.repository.js';
import { FederatedIdentityRepository } from './repositories/federated-identity.repository.js';
import { FederatedAuthFlowService } from './services/federated-auth-flow.service.js';
import { FederatedIdentityService } from './services/federated-identity.service.js';
import { FederatedJwksService } from './services/federated-jwks.service.js';
import { FederatedMonitoringService } from './services/federated-monitoring.service.js';
import { FederatedProvidersService } from './services/federated-providers.service.js';
import { FederatedRoleSyncService } from './services/federated-role-sync.service.js';
import { OAuthProviderRegistryService } from './services/oauth-provider-registry.service.js';
import { OidcDiscoveryService } from './services/oidc-discovery.service.js';

new CoreI18nService().registerNamespace('federated-identity', {
  vi: viFederatedIdentity,
  en: enFederatedIdentity,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    UsersModule,
    RolesModule,
    CredentialsModule,
    SessionsModule,
    AuthModule,
    TypeOrmModule.forFeature([
      FederatedIdentityProviderEntity,
      FederatedIdentityEntity,
      FederatedAuthTransactionEntity,
      FederatedAuthEventEntity,
    ]),
  ],
  controllers: [FederatedIdentityController],
  providers: [
    FederatedIdentityProviderRepository,
    FederatedIdentityRepository,
    FederatedAuthTransactionRepository,
    FederatedAuthEventRepository,
    FederatedJwksService,
    OidcDiscoveryService,
    GoogleOAuthAdapter,
    MicrosoftOAuthAdapter,
    GenericOidcAdapter,
    OAuthProviderRegistryService,
    FederatedMonitoringService,
    FederatedProvidersService,
    FederatedRoleSyncService,
    FederatedAuthFlowService,
    FederatedIdentityService,
    {
      provide: FEDERATED_IDENTITY_PUBLIC_SERVICE,
      useExisting: FederatedIdentityService,
    },
    {
      provide: OAUTH_PROVIDER_REGISTRY,
      useExisting: OAuthProviderRegistryService,
    },
  ],
  exports: [
    FederatedIdentityService,
    OAuthProviderRegistryService,
    OidcDiscoveryService,
    FederatedRoleSyncService,
    FEDERATED_IDENTITY_PUBLIC_SERVICE,
    OAUTH_PROVIDER_REGISTRY,
  ],
})
export class FederatedIdentityModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('federated-identity', {
      vi: viFederatedIdentity,
      en: enFederatedIdentity,
    });
  }
}
