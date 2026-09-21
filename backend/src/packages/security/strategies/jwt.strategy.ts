import type { TokenPayload, UserIdentity } from '../contracts/auth.contract.js';

export interface TokenVerificationStrategy {
  verify(token: string): Promise<TokenPayload | null>;
  validateUser(payload: TokenPayload): Promise<UserIdentity | null>;
}
