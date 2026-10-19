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
import { PasswordHasherService } from './providers/password-hasher.service.js';
import { FieldEncryptionService } from './providers/field-encryption.service.js';
import { TotpService } from './providers/totp.service.js';
import { DataScopeService } from './providers/data-scope.service.js';
import { AuditLogService } from './providers/audit-log.service.js';

@Global()
@Module({
  providers: [
    EnvironmentSecretProvider,
    {
      provide: FileSecretProvider,
      useFactory: (config: CoreConfigService) =>
        new FileSecretProvider(config.auth.secretDir || undefined),
      inject: [CoreConfigService],
    },
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
    PasswordHasherService,
    FieldEncryptionService,
    TotpService,
    TokenService,
    DataScopeService,
    AuditLogService,
    AuthGuard,
    SecurityManageableAdapter,
  ],
  exports: [
    SECRET_PROVIDER,
    EnvironmentSecretProvider,
    FileSecretProvider,
    SecretService,
    SecretRegistryService,
    PasswordHasherService,
    FieldEncryptionService,
    TotpService,
    TokenService,
    DataScopeService,
    AuditLogService,
    AuthGuard,
    SecurityManageableAdapter,
  ],
})
export class SecurityModule {}
