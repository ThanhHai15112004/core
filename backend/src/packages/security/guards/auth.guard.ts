import { type CanActivate, type ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import {
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ROLES_KEY,
} from '@packages/http/index.js';
import { LocaleContext } from '@packages/i18n/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { TokenService } from '../providers/token.service.js';
import { PlatformSecurityService } from '../providers/platform-security.service.js';
import type { UserIdentity } from '../contracts/auth.contract.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    @Optional() private readonly platformSecurityService?: PlatformSecurityService,
  ) {}

  private attachActorToContext(request: FastifyRequest, user: UserIdentity): void {
    LocaleContext.applyUserPreferences({
      preferredLocale: user.preferredLocale ?? null,
      preferredTimezone: user.preferredTimezone ?? null,
    });
    const store = RequestContextService.current();
    if (!store) return;
    store.actor = user;
    store.userId = String(user.id);
    if (!store.ipAddress && request.ip) {
      store.ipAddress = request.ip;
    }
    const ua = request.headers['user-agent'];
    if (!store.userAgent && ua) {
      store.userAgent = Array.isArray(ua) ? ua[0] : ua;
    }
  }

  private async enforceRateLimit(
    request: FastifyRequest & { user?: UserIdentity },
    reply?: FastifyReply,
  ): Promise<void> {
    if (!this.platformSecurityService) return;
    const forwarded = request.headers['x-forwarded-for'];
    const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const clientIp =
      (typeof rawForwarded === 'string' ? rawForwarded.split(',')[0]?.trim() : undefined) ||
      request.ip ||
      '127.0.0.1';

    try {
      const rl = await this.platformSecurityService.assertRateLimit({
        ipAddress: clientIp,
        userId: request.user?.id ?? null,
        method: request.method,
        url: request.url,
      });
      reply?.header('x-ratelimit-limit', String(rl.limit));
      reply?.header('x-ratelimit-remaining', String(rl.remaining));
      reply?.header('x-ratelimit-reset', String(Math.ceil(rl.resetAtMs / 1000)));
    } catch (err) {
      const details = (err as { details?: Array<{ retryAfterSeconds?: number; limit?: number }> })
        ?.details;
      const retryAfter = details?.[0]?.retryAfterSeconds ?? 60;
      const limit = details?.[0]?.limit ?? 0;
      reply?.header('x-ratelimit-limit', String(limit));
      reply?.header('x-ratelimit-remaining', '0');
      reply?.header('retry-after', String(retryAfter));
      throw err;
    }
  }

  /** Kiểm tra xác thực JWT, Rate Limit (IP/User/API) và quyền truy cập (Roles & Permissions) của yêu cầu HTTP */
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest & { user?: UserIdentity }>();
    const reply =
      typeof http.getResponse === 'function' ? http.getResponse<FastifyReply>() : undefined;
    const authHeader = request.headers['authorization'];
    const resolutionContext = {
      ipAddress: request.ip ?? null,
      endpoint: request.url ?? null,
      method: request.method ?? null,
    };

    if (isPublic) {
      if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token.length > 0) {
          const payload = await this.tokenService.verify(token).catch(() => null);
          if (payload) {
            const optionalUser = await this.tokenService
              .validateUser(payload, resolutionContext)
              .catch(() => null);
            if (optionalUser) {
              request.user = optionalUser;
              this.attachActorToContext(request, optionalUser);
            }
          }
        }
      }
      await this.enforceRateLimit(request, reply);
      return true;
    }

    if (!authHeader || typeof authHeader !== 'string') {
      await this.enforceRateLimit(request, reply);
      throw new UnauthorizedAppException('security.missingAuthHeader');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      await this.enforceRateLimit(request, reply);
      throw new UnauthorizedAppException('security.invalidAuthTokenFormat');
    }

    const token = parts[1];
    if (!token) {
      await this.enforceRateLimit(request, reply);
      throw new UnauthorizedAppException('security.tokenRequired');
    }
    const payload = await this.tokenService.verify(token);
    if (!payload) {
      await this.enforceRateLimit(request, reply);
      throw new UnauthorizedAppException('security.invalidOrExpiredToken');
    }

    const user = await this.tokenService.validateUser(payload, resolutionContext);
    if (!user) {
      await this.enforceRateLimit(request, reply);
      throw new UnauthorizedAppException('security.userNotFoundOrDisabled');
    }

    request.user = user;
    this.attachActorToContext(request, user);
    await this.enforceRateLimit(request, reply);

    const requiredRoles =
      this.reflector.getAllAndOverride<readonly string[]>(REQUIRED_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredRoles.length > 0) {
      const userRoles = new Set(user.roles ?? []);
      const hasRole = requiredRoles.some((role) => userRoles.has(role));
      if (!hasRole) {
        throw new ForbiddenAppException(HTTP_ERROR_CODE.FORBIDDEN, [
          { requiredRoles, actualRoles: user.roles ?? [] },
        ]);
      }
    }

    const requiredPermissions =
      this.reflector.getAllAndOverride<readonly string[]>(REQUIRED_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredPermissions.length > 0) {
      const userPermissions = new Set(user.permissions ?? []);
      const missingPermissions = requiredPermissions.filter((perm) => !userPermissions.has(perm));
      if (missingPermissions.length > 0) {
        throw new ForbiddenAppException(HTTP_ERROR_CODE.FORBIDDEN, [
          { requiredPermissions, missingPermissions },
        ]);
      }
    }

    return true;
  }
}
