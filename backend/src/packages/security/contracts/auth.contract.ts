export interface UserIdentity {
  readonly id: string;
  readonly email?: string;
  readonly username?: string;
  readonly sessionId?: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly organizationUnitIds?: readonly string[];
}

export type JwtTokenType = 'access' | 'refresh' | 'mfa_challenge';

export interface TokenPayload {
  readonly sub: string;
  readonly sid?: string;
  readonly type?: JwtTokenType;
  readonly email?: string;
  readonly username?: string;
  readonly roles?: string[];
  readonly permissions?: string[];
  readonly organizationUnitIds?: string[];
  readonly iat?: number;
  readonly exp?: number;
  readonly [key: string]: unknown;
}

export interface IUserIdentityResolver {
  resolveIdentity(payload: TokenPayload): Promise<UserIdentity | null>;
}

export const USER_IDENTITY_RESOLVER = Symbol('USER_IDENTITY_RESOLVER');
