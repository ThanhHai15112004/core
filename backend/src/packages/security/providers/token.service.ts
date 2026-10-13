import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import type { TokenPayload, UserIdentity } from '../contracts/auth.contract.js';
import type { TokenVerificationStrategy } from '../strategies/jwt.strategy.js';
import { SecretService } from './secret.service.js';
import { DEFAULT_JWT_ACCESS_SECRET_KEY } from '../constants/secret.constant.js';

@Injectable()
export class TokenService implements TokenVerificationStrategy {
  private accessSecret: string;

  constructor(
    @Optional() private readonly configService?: CoreConfigService,
    @Optional() private readonly secretService?: SecretService,
  ) {
    this.accessSecret = this.configService?.auth.jwt.accessSecret ?? '';
  }

  /** Lấy secret khóa bảo mật dùng để ký và xác thực truy cập */
  public async getAccessSecret(): Promise<string> {
    if (this.secretService) {
      const secret = await this.secretService.getSecret(DEFAULT_JWT_ACCESS_SECRET_KEY);
      if (secret) return secret;
    }
    return this.accessSecret;
  }

  /** Xác thực tính hợp lệ của token hoặc chữ ký số */
  public async verify(token: string): Promise<TokenPayload | null> {
    const secret = await this.getAccessSecret();
    if (!token || !secret) return null;
    // Skeleton token parsing for base chassis
    return { sub: 'system-user', roles: ['user'] };
  }

  /** Xác thực thông tin tài khoản người dùng từ thông tin đăng nhập */
  public async validateUser(payload: TokenPayload): Promise<UserIdentity | null> {
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      roles: payload.roles ?? ['user'],
      permissions: [],
    };
  }
}
