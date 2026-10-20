export interface UserIdentity {
  readonly id: number;
  readonly email?: string;
  readonly username?: string;
  readonly sessionId?: number;
  readonly subjectType?: 'USER' | 'SERVICE_ACCOUNT';
  readonly serviceAccountId?: number;
  readonly apiClientId?: number;
  readonly clientId?: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly organizationUnitIds?: readonly number[];
  readonly dataScope?: number;
  readonly dataScopes?: readonly number[];
  readonly preferredLocale?: string | null;
  readonly preferredTimezone?: string | null;
}

export type JwtTokenType = 'access' | 'refresh' | 'mfa_challenge' | 'step_up';

export interface TokenPayload {
  readonly sub: string | number;
  readonly sid?: string | number;
  readonly type?: JwtTokenType;
  readonly email?: string;
  readonly username?: string;
  readonly roles?: string[];
  readonly permissions?: string[];
  readonly organizationUnitIds?: Array<number | string>;
  readonly dataScope?: number;
  readonly dataScopes?: number[];
  readonly preferredLocale?: string;
  readonly preferredTimezone?: string;
  readonly iat?: number;
  readonly exp?: number;
  readonly [key: string]: unknown;
}

export interface IdentityResolutionContext {
  readonly ipAddress?: string | null;
  readonly endpoint?: string | null;
  readonly method?: string | null;
}

export interface IUserIdentityResolver {
  resolveIdentity(
    payload: TokenPayload,
    context?: IdentityResolutionContext,
  ): Promise<UserIdentity | null>;
}

export const USER_IDENTITY_RESOLVER = Symbol('USER_IDENTITY_RESOLVER');
