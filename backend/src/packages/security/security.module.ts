import { Global, Module } from '@nestjs/common';
import { SECRET_PROVIDER } from './contracts/secret-provider.contract.js';
import { EnvironmentSecretProvider } from './providers/env-secret.provider.js';
import { FileSecretProvider } from './providers/file-secret.provider.js';
import { SecretService } from './providers/secret.service.js';
import { TokenService } from './providers/token.service.js';
import { AuthGuard } from './guards/auth.guard.js';

import { SecretDriver } from './types/secret.types.js';

@Global()
@Module({
  providers: [
    EnvironmentSecretProvider,
    FileSecretProvider,
    {
      provide: SECRET_PROVIDER,
      useFactory: (envProvider: EnvironmentSecretProvider, fileProvider: FileSecretProvider) => {
        const driver = process.env.SECRET_DRIVER?.toLowerCase();
        if (driver === SecretDriver.FILE) {
          return fileProvider;
        }
        return envProvider;
      },
      inject: [EnvironmentSecretProvider, FileSecretProvider],
    },
    SecretService,
    TokenService,
    AuthGuard,
  ],
  exports: [
    SECRET_PROVIDER,
    EnvironmentSecretProvider,
    FileSecretProvider,
    SecretService,
    TokenService,
    AuthGuard,
  ],
})
export class SecurityModule {}
