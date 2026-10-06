import { Global, Module } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { SECRET_PROVIDER } from './contracts/secret-provider.contract.js';
import { EnvironmentSecretProvider } from './providers/env-secret.provider.js';
import { FileSecretProvider } from './providers/file-secret.provider.js';
import { SecretService } from './providers/secret.service.js';
import { TokenService } from './providers/token.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { SecurityManageableAdapter } from './providers/security-manageable.adapter.js';

import { SecretDriver } from './types/secret.types.js';

import { SecretRegistryService } from './providers/secret-registry.service.js';

@Global()
@Module({
  providers: [
    EnvironmentSecretProvider,
    FileSecretProvider,
    {
      provide: SECRET_PROVIDER,
      useFactory: (
        envProvider: EnvironmentSecretProvider,
        fileProvider: FileSecretProvider,
        config: CoreConfigService,
      ) => (config.auth.secretDriver === SecretDriver.FILE ? fileProvider : envProvider),
      inject: [EnvironmentSecretProvider, FileSecretProvider, CoreConfigService],
    },
    SecretService,
    SecretRegistryService,
    TokenService,
    AuthGuard,
    SecurityManageableAdapter,
  ],
  exports: [
    SECRET_PROVIDER,
    EnvironmentSecretProvider,
    FileSecretProvider,
    SecretService,
    SecretRegistryService,
    TokenService,
    AuthGuard,
    SecurityManageableAdapter,
  ],
})
export class SecurityModule {}
