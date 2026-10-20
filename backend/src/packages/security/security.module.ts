import { Global, Module, type OnModuleInit, Optional } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
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
import { PlatformSecurityService } from './providers/platform-security.service.js';

const PLATFORM_SECURITY_HOOKS_WATERMARK = Symbol.for('core:fastify_platform_security_hooks');

interface FastifyHookRequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface FastifyHookReplyLike {
  header: (name: string, value: string) => FastifyHookReplyLike;
  getHeader?: (name: string) => unknown;
  removeHeader?: (name: string) => void;
  status: (code: number) => FastifyHookReplyLike;
  send: (payload?: unknown) => void;
}

interface FastifySecurityInstanceLike {
  addHook?: (
    name: string,
    handler: (
      req: FastifyHookRequestLike,
      reply: FastifyHookReplyLike,
      payloadOrDone?: unknown,
      doneMaybe?: (err?: Error | null, value?: unknown) => void,
    ) => void,
  ) => void;
  [PLATFORM_SECURITY_HOOKS_WATERMARK]?: boolean;
}

/**
 * Đăng ký các Fastify Hook bảo mật nền tảng (Mục 4.5):
 * - `onRequest`: Kiểm soát CORS theo danh sách domain cho phép (Allowlist), chặn preflight từ origin lạ.
 * - `onSend`: Đính kèm đầy đủ Security Headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy...).
 */
export function configureFastifyPlatformSecurityHooks(
  instance: unknown,
  platformSecurity: PlatformSecurityService,
): void {
  if (!instance || typeof instance !== 'object') {
    return;
  }
  const fastify = instance as FastifySecurityInstanceLike;
  if (fastify[PLATFORM_SECURITY_HOOKS_WATERMARK] || typeof fastify.addHook !== 'function') {
    return;
  }

  try {
    fastify.addHook(
      'onRequest',
      (req: FastifyHookRequestLike, reply: FastifyHookReplyLike, done?: unknown) => {
        const secHeaders = platformSecurity.getSecurityHeaders();
        for (const [headerName, headerValue] of Object.entries(secHeaders)) {
          reply.header(headerName, headerValue);
        }

        const rawOrigin = req.headers?.['origin'];
        const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;

        if (typeof origin === 'string' && origin.trim().length > 0) {
          const evaluation = platformSecurity.evaluateCorsOrigin(origin);
          reply.header('vary', 'Origin');

          if (evaluation.allowed && evaluation.allowedOrigin) {
            reply.header('access-control-allow-origin', evaluation.allowedOrigin);
            reply.header('access-control-allow-credentials', 'true');
            reply.header(
              'access-control-allow-methods',
              'GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS',
            );
            reply.header(
              'access-control-allow-headers',
              'Content-Type, Authorization, X-Request-Id, X-Correlation-Id, X-Scope-Unit-Id, X-Scope-Subordinate-Ids, X-Step-Up-Token, Accept-Language, X-Locale, X-Timezone',
            );

            if (req.method?.toUpperCase() === 'OPTIONS') {
              reply.status(204).send();
              return;
            }
          } else {
            reply.removeHeader?.('access-control-allow-origin');
            if (req.method?.toUpperCase() === 'OPTIONS') {
              reply.status(403).send({
                success: false,
                statusCode: 403,
                error: {
                  code: 'CORS_ORIGIN_FORBIDDEN',
                  message: 'Origin is not allowed by CORS policy',
                },
                timestamp: new Date().toISOString(),
              });
              return;
            }
          }
        }

        if (typeof done === 'function') {
          (done as () => void)();
        }
      },
    );

    fastify.addHook(
      'onSend',
      (
        _req: FastifyHookRequestLike,
        reply: FastifyHookReplyLike,
        payload: unknown,
        done?: (err?: Error | null, value?: unknown) => void,
      ) => {
        const secHeaders = platformSecurity.getSecurityHeaders();
        for (const [headerName, headerValue] of Object.entries(secHeaders)) {
          if (!reply.getHeader?.(headerName)) {
            reply.header(headerName, headerValue);
          }
        }
        if (typeof done === 'function') {
          done(null, payload);
        }
      },
    );

    fastify[PLATFORM_SECURITY_HOOKS_WATERMARK] = true;
  } catch {
    // Ignore if hooks are locked after server ready
  }
}

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
    PlatformSecurityService,
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
    PlatformSecurityService,
    AuthGuard,
    SecurityManageableAdapter,
  ],
})
export class SecurityModule implements OnModuleInit {
  constructor(
    private readonly platformSecurity: PlatformSecurityService,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  public onModuleInit(): void {
    const instance = this.adapterHost?.httpAdapter?.getInstance?.() as unknown;
    configureFastifyPlatformSecurityHooks(instance, this.platformSecurity);
  }
}
