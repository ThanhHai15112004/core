import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ForbiddenAppException, HTTP_ERROR_CODE } from '@packages/kernel/index.js';
import {
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ROLES_KEY,
} from '@packages/http/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { TokenService } from '../providers/token.service.js';
import type { UserIdentity } from '../contracts/auth.contract.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  private attachActorToContext(request: FastifyRequest, user: UserIdentity): void {
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

  /** Kiểm tra xác thực JWT và quyền truy cập (Roles & Permissions) của yêu cầu HTTP trước khi vào controller */
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: UserIdentity }>();
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
      return true;
    }

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedException('Invalid Authorization token format');
    }

    const token = parts[1];
    if (!token) {
      throw new UnauthorizedException('Token is required');
    }
    const payload = await this.tokenService.verify(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.tokenService.validateUser(payload, resolutionContext);
    if (!user) {
      throw new UnauthorizedException('User not found or disabled');
    }

    request.user = user;
    this.attachActorToContext(request, user);

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
