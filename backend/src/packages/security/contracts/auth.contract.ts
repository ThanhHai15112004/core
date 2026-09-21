export interface UserIdentity {
  readonly id: string;
  readonly email?: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface TokenPayload {
  readonly sub: string;
  readonly roles?: string[];
  readonly [key: string]: unknown;
}
