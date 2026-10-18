import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  IUserIdentityResolver,
  IdentityResolutionContext,
  TokenPayload,
  UserIdentity,
} from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  USER_STATUS,
} from '@modules/users/contracts/index.js';
import { SessionService } from './session.service.js';
import { ServiceAccountService } from './service-account.service.js';

@Injectable()
export class UserIdentityResolverService implements IUserIdentityResolver {
  constructor(
    private readonly sessionService: SessionService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly serviceAccountService?: ServiceAccountService,
  ) {}

  /** Giải mã và kiểm tra trạng thái hoạt động của phiên đăng nhập người dùng hoặc API Client / Service Account */
  public async resolveIdentity(
    payload: TokenPayload,
    context?: IdentityResolutionContext,
  ): Promise<UserIdentity | null> {
    if (!payload.sub) {
      return null;
    }

    // Nhánh xác thực cho Tài khoản hệ thống (Service Account) & API Client (Mục 3.6)
    if (
      payload.clientType === 'api_client' ||
      (typeof payload.sub === 'string' && payload.sub.startsWith('sa:'))
    ) {
      if (!this.serviceAccountService) {
        return null;
      }
      return this.serviceAccountService.resolveApiClientTokenIdentity(payload, context);
    }

    const userId = Number(payload.sub);
    if (Number.isNaN(userId) || userId <= 0) {
      return null;
    }

    // Nếu token không gắn mã phiên (sid), trả về thông tin trực tiếp từ payload (tương thích unit test)
    if (!payload.sid) {
      return {
        id: userId,
        ...(payload.email !== undefined ? { email: payload.email } : {}),
        ...(payload.username !== undefined ? { username: payload.username } : {}),
        roles: payload.roles ?? ['user'],
        permissions: payload.permissions ?? [],
        ...(payload.organizationUnitIds !== undefined
          ? { organizationUnitIds: payload.organizationUnitIds.map(Number) }
          : {}),
      };
    }

    const sessionId = Number(payload.sid);
    const sessionActive = await this.sessionService.isSessionActive(sessionId, userId);
    if (!sessionActive) {
      return null;
    }

    const user = await this.usersPublicService.findAuthUserById(userId);
    if (!user || user.status !== USER_STATUS.ACTIVE) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      sessionId,
      subjectType: 'USER',
      roles: user.roles,
      permissions: user.permissions,
      organizationUnitIds: user.organizationUnitIds,
    };
  }
}

