import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  type IUserIdentityResolver,
  type TokenPayload,
  USER_IDENTITY_RESOLVER,
  type UserIdentity,
} from '../contracts/auth.contract.js';
import type { TokenVerificationStrategy } from '../strategies/jwt.strategy.js';
import { SecretService } from './secret.service.js';
import {
  DEFAULT_JWT_ACCESS_SECRET_KEY,
  DEFAULT_JWT_REFRESH_SECRET_KEY,
} from '../constants/secret.constant.js';

const DEFAULT_ACCESS_TTL_SECONDS = 900; // 15m
const DEFAULT_REFRESH_TTL_SECONDS = 604_800; // 7d
const DEFAULT_MFA_CHALLENGE_TTL_SECONDS = 300; // 5m

/** Chuyển đổi chuỗi thời hạn (vd: '15m', '7d', '3600s', '2h') sang số giây */
export function parseDurationSeconds(
  duration: string | number | undefined,
  fallbackSeconds: number,
): number {
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    return Math.trunc(duration);
  }
  if (typeof duration !== 'string' || duration.trim().length === 0) {
    return fallbackSeconds;
  }

  const trimmed = duration.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)\s*(s|m|h|d)?$/);
  if (!match) {
    return fallbackSeconds;
  }

  const value = Number.parseInt(match[1] ?? '0', 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackSeconds;
  }

  const unit = match[2] ?? 's';
  switch (unit) {
    case 'd':
      return value * 86_400;
    case 'h':
      return value * 3_600;
    case 'm':
      return value * 60;
    case 's':
    default:
      return value;
  }
}

@Injectable()
export class TokenService implements TokenVerificationStrategy {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiration: string;
  private readonly refreshExpiration: string;

  constructor(
    @Optional() private readonly configService?: CoreConfigService,
    @Optional() private readonly secretService?: SecretService,
    @Optional()
    @Inject(USER_IDENTITY_RESOLVER)
    private readonly identityResolver?: IUserIdentityResolver,
  ) {
    this.accessSecret = this.configService?.auth.jwt.accessSecret ?? '';
    this.refreshSecret = this.configService?.auth.jwt.refreshSecret ?? '';
    this.accessExpiration = this.configService?.auth.jwt.accessExpiration ?? '15m';
    this.refreshExpiration = this.configService?.auth.jwt.refreshExpiration ?? '7d';
  }

  /** Lấy secret khóa bảo mật dùng để ký và xác thực Access Token */
  public async getAccessSecret(): Promise<string> {
    if (this.secretService) {
      const secret = await this.secretService.getSecret(DEFAULT_JWT_ACCESS_SECRET_KEY);
      if (secret) return secret;
    }
    return this.accessSecret;
  }

  /** Lấy secret khóa bảo mật dùng để ký và xác thực Refresh Token */
  public async getRefreshSecret(): Promise<string> {
    if (this.secretService) {
      const secret = await this.secretService.getSecret(DEFAULT_JWT_REFRESH_SECRET_KEY);
      if (secret) return secret;
    }
    return this.refreshSecret || this.accessSecret;
  }

  /** Ký phát hành Access Token chuẩn JWT HS256 */
  public async signAccessToken(
    payload: Omit<TokenPayload, 'iat' | 'exp' | 'type'>,
    expiresIn?: string | number,
  ): Promise<string> {
    const secret = await this.getAccessSecret();
    const ttlSeconds = parseDurationSeconds(
      expiresIn ?? this.accessExpiration,
      DEFAULT_ACCESS_TTL_SECONDS,
    );
    return this.signHs256({ ...payload, type: 'access' }, secret, ttlSeconds);
  }

  /** Ký phát hành Refresh Token chuẩn JWT HS256 */
  public async signRefreshToken(
    payload: { sub: string | number; sid: string | number },
    expiresIn?: string | number,
  ): Promise<string> {
    const secret = await this.getRefreshSecret();
    const ttlSeconds = parseDurationSeconds(
      expiresIn ?? this.refreshExpiration,
      DEFAULT_REFRESH_TTL_SECONDS,
    );
    return this.signHs256({ ...payload, jti: randomUUID(), type: 'refresh' }, secret, ttlSeconds);
  }

  /** Ký phát hành MFA Challenge Token ngắn hạn (mặc định 5 phút) phục vụ xác thực bước 2 */
  public async signMfaChallengeToken(
    payload: { sub: string | number; methods?: string[]; email?: string },
    expiresIn?: string | number,
  ): Promise<string> {
    const secret = await this.getAccessSecret();
    const ttlSeconds = parseDurationSeconds(expiresIn, DEFAULT_MFA_CHALLENGE_TTL_SECONDS);
    return this.signHs256({ ...payload, type: 'mfa_challenge' }, secret, ttlSeconds);
  }

  /** Xác thực tính hợp lệ và chữ ký số của Access Token */
  public async verify(token: string): Promise<TokenPayload | null> {
    const secret = await this.getAccessSecret();
    const payload = this.verifyHs256(token, secret);
    if (!payload) {
      return null;
    }
    if (payload.type !== undefined && payload.type !== 'access') {
      return null;
    }
    return payload;
  }

  /** Xác thực tính hợp lệ và chữ ký số của Refresh Token */
  public async verifyRefreshToken(token: string): Promise<TokenPayload | null> {
    const secret = await this.getRefreshSecret();
    const payload = this.verifyHs256(token, secret);
    if (!payload || payload.type !== 'refresh' || !payload.sid) {
      return null;
    }
    return payload;
  }

  /** Xác thực tính hợp lệ của MFA Challenge Token bước 2 */
  public async verifyMfaChallengeToken(token: string): Promise<TokenPayload | null> {
    const secret = await this.getAccessSecret();
    const payload = this.verifyHs256(token, secret);
    if (!payload || payload.type !== 'mfa_challenge') {
      return null;
    }
    return payload;
  }

  /** Xác thực thông tin danh tính tài khoản người dùng từ payload JWT */
  public async validateUser(payload: TokenPayload): Promise<UserIdentity | null> {
    if (payload.sub === undefined || payload.sub === null || payload.sub === '') return null;

    if (this.identityResolver) {
      return this.identityResolver.resolveIdentity(payload);
    }

    const numericId = typeof payload.sub === 'number' ? payload.sub : Number(payload.sub) || 1;
    const numericSid =
      payload.sid !== undefined
        ? typeof payload.sid === 'number'
          ? payload.sid
          : Number(payload.sid) || 1
        : undefined;

    return {
      id: numericId,
      ...(payload.email !== undefined ? { email: payload.email } : {}),
      ...(payload.username !== undefined ? { username: payload.username } : {}),
      ...(numericSid !== undefined ? { sessionId: numericSid } : {}),
      roles: payload.roles ?? ['user'],
      permissions: payload.permissions ?? [],
      ...(payload.organizationUnitIds !== undefined
        ? {
            organizationUnitIds: payload.organizationUnitIds.map((v) =>
              typeof v === 'number' ? v : Number(v) || 1,
            ),
          }
        : {}),
    };
  }

  /** Ký chuỗi JWT bằng thuật toán HMAC-SHA256 */
  private signHs256(
    payload: Omit<TokenPayload, 'iat' | 'exp'>,
    secret: string,
    ttlSeconds: number,
  ): string {
    if (!secret) {
      throw new Error('JWT secret is not configured');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const fullPayload: TokenPayload = {
      ...payload,
      sub: typeof payload.sub === 'number' ? payload.sub : String(payload.sub ?? ''),
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
    };

    const headerSegment = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      'utf8',
    ).toString('base64url');
    const payloadSegment = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
    const signingInput = `${headerSegment}.${payloadSegment}`;
    const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');

    return `${signingInput}.${signature}`;
  }

  /** Giải mã và kiểm tra chữ ký HMAC-SHA256 cùng thời hạn exp của JWT */
  private verifyHs256(token: string, secret: string): TokenPayload | null {
    if (!token || !secret) {
      return null;
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      return null;
    }

    const [headerSeg, payloadSeg, signatureSeg] = segments;
    if (!headerSeg || !payloadSeg || !signatureSeg) {
      return null;
    }

    try {
      const signingInput = `${headerSeg}.${payloadSeg}`;
      const expectedSig = createHmac('sha256', secret).update(signingInput).digest('base64url');

      const sigBuf = Buffer.from(signatureSeg, 'utf8');
      const expectedBuf = Buffer.from(expectedSig, 'utf8');
      if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
      }

      const header = JSON.parse(Buffer.from(headerSeg, 'base64url').toString('utf8')) as {
        alg?: string;
      };
      if (header.alg !== 'HS256') {
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(payloadSeg, 'base64url').toString('utf8'),
      ) as TokenPayload;

      if (
        !payload ||
        typeof payload !== 'object' ||
        (typeof payload.sub !== 'string' && typeof payload.sub !== 'number')
      ) {
        return null;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === 'number' && payload.exp <= nowSeconds) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }
}
