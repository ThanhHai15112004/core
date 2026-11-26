import { type CanActivate, type ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  UnauthorizedAppException,
  resolveForwardedContext,
} from '@packages/kernel/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import {
  IS_PUBLIC_KEY,
  REQUIRED_ANY_PERMISSIONS_KEY,
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
    @Optional() private readonly config?: CoreConfigService,
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
    const resolvedIp = resolveForwardedContext(request, this.config?.gateway.proxy).clientIp;
    if (resolvedIp) {
      store.ipAddress = resolvedIp;
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
    const forwarded = resolveForwardedContext(request, this.config?.gateway.proxy);
    const clientIp = forwarded.clientIp || '127.0.0.1';
    const rateLimitCfg = this.config?.gateway.rateLimit;
    const layerMode = rateLimitCfg?.layerMode ?? 'backend-only';
    const rawUrl = (request.url ?? '/').split('?')[0] ?? '/';
    const isSensitiveRoute = (rateLimitCfg?.alwaysEnforceIpRoutes ?? []).some((route) =>
      rawUrl.includes(route),
    );
    const sourceHeaderName = rateLimitCfg?.gatewaySourceHeader || 'x-ratelimit-source';
    const rawSourceHeader = request.headers[sourceHeaderName];
    const sourceHeaderVal = (
      Array.isArray(rawSourceHeader) ? rawSourceHeader[0] : rawSourceHeader
    )
      ?.trim()
      .toLowerCase();
    const hasEdgeGatewayMarker =
      forwarded.trustedProxy &&
      (!rateLimitCfg?.gatewaySourceValue ||
        sourceHeaderVal === rateLimitCfg.gatewaySourceValue ||
        rateLimitCfg.skipBackendIpWhenEdgeApplied);

    if (layerMode === 'gateway-only' && hasEdgeGatewayMarker && !isSensitiveRoute) {
      reply?.header('x-ratelimit-policy', 'gateway-only');
      reply?.header('x-ratelimit-scope', 'gateway-edge');
      return;
    }

    const skipIpCheck =
      layerMode === 'edge-ip-backend-business' &&
      Boolean(rateLimitCfg?.skipBackendIpWhenEdgeApplied) &&
      hasEdgeGatewayMarker &&
      !isSensitiveRoute;

    const scopeHeader = skipIpCheck ? 'backend-business' : 'backend-full';

    try {
      const rl = await this.platformSecurityService.assertRateLimit({
        ipAddress: clientIp,
        userId: request.user?.id ?? null,
        method: request.method,
        url: request.url,
        skipIpCheck,
      });
      reply?.header('x-ratelimit-limit', String(rl.limit));
      reply?.header('x-ratelimit-remaining', String(rl.remaining));
      reply?.header('x-ratelimit-reset', String(Math.ceil(rl.resetAtMs / 1000)));
      reply?.header('x-ratelimit-policy', layerMode);
      reply?.header('x-ratelimit-scope', scopeHeader);
    } catch (err) {
      const details = (err as { details?: Array<{ retryAfterSeconds?: number; limit?: number }> })
        ?.details;
      const retryAfter = details?.[0]?.retryAfterSeconds ?? 60;
      const limit = details?.[0]?.limit ?? 0;
      reply?.header('x-ratelimit-limit', String(limit));
      reply?.header('x-ratelimit-remaining', '0');
      reply?.header('retry-after', String(retryAfter));
      reply?.header('x-ratelimit-policy', layerMode);
      reply?.header('x-ratelimit-scope', scopeHeader);
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
    const resolvedClientIp = resolveForwardedContext(request, this.config?.gateway.proxy).clientIp;
    const resolutionContext = {
      ipAddress: resolvedClientIp ?? null,
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
      const matchAny = Boolean(
        this.reflector.getAllAndOverride<boolean>(REQUIRED_ANY_PERMISSIONS_KEY, [
          context.getHandler(),
          context.getClass(),
        ]),
      );
      const userPermissions = new Set(user.permissions ?? []);
      const hasWildcard = userPermissions.has('*') || userPermissions.has('system.admin');

      if (!hasWildcard) {
        if (matchAny) {
          const hasAny = requiredPermissions.some((perm) => userPermissions.has(perm));
          if (!hasAny) {
            throw new ForbiddenAppException(HTTP_ERROR_CODE.FORBIDDEN, [
              { requiredPermissions, missingPermissions: requiredPermissions },
            ]);
          }
        } else {
          const missingPermissions = requiredPermissions.filter(
            (perm) => !userPermissions.has(perm),
          );
          if (missingPermissions.length > 0) {
            throw new ForbiddenAppException(HTTP_ERROR_CODE.FORBIDDEN, [
              { requiredPermissions, missingPermissions },
            ]);
          }
        }
      }
    }

    return true;
  }
}
