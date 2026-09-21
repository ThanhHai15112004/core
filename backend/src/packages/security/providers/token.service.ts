import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import type { TokenPayload, UserIdentity } from '../contracts/auth.contract.js';
import type { TokenVerificationStrategy } from '../strategies/jwt.strategy.js';

@Injectable()
export class TokenService implements TokenVerificationStrategy {
  private readonly accessSecret: string;

  constructor(private readonly configService: CoreConfigService) {
    this.accessSecret = this.configService.auth.jwt.accessSecret;
  }

  public async verify(token: string): Promise<TokenPayload | null> {
    if (!token || !this.accessSecret) return null;
    // Skeleton token parsing for base chassis
    return { sub: 'system-user', roles: ['user'] };
  }

  public async validateUser(payload: TokenPayload): Promise<UserIdentity | null> {
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      roles: payload.roles ?? ['user'],
      permissions: [],
    };
  }
}
