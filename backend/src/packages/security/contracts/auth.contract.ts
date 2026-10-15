export interface UserIdentity {
  readonly id: number;
  readonly email?: string;
  readonly username?: string;
  readonly sessionId?: number;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly organizationUnitIds?: readonly number[];
}

export type JwtTokenType = 'access' | 'refresh' | 'mfa_challenge';

export interface TokenPayload {
  readonly sub: string | number;
  readonly sid?: string | number;
  readonly type?: JwtTokenType;
  readonly email?: string;
  readonly username?: string;
  readonly roles?: string[];
  readonly permissions?: string[];
  readonly organizationUnitIds?: Array<number | string>;
  readonly iat?: number;
  readonly exp?: number;
  readonly [key: string]: unknown;
}

export interface IUserIdentityResolver {
  resolveIdentity(payload: TokenPayload): Promise<UserIdentity | null>;
}

export const USER_IDENTITY_RESOLVER = Symbol('USER_IDENTITY_RESOLVER');
