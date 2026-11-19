import type { CompleteExternalLoginInput, LoginResponse } from '../types/auth.types.js';

export * from '../enum/auth.enum.js';
export * from '../types/auth.types.js';

export interface IAuthPublicService {
  revokeAllUserSessions(userId: number, reason?: string, exceptSessionId?: number): Promise<number>;
  completeExternalLogin(input: CompleteExternalLoginInput): Promise<LoginResponse>;
  verifyStepUpToken(userId: number, stepUpToken: string, expectedAction?: string): Promise<boolean>;
}

export const AUTH_PUBLIC_SERVICE = Symbol('AUTH_PUBLIC_SERVICE');
