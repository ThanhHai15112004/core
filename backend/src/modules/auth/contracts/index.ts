export * from '../enum/auth.enum.js';
export * from '../types/auth.types.js';

export interface IAuthPublicService {
  revokeAllUserSessions(userId: number, reason?: string, exceptSessionId?: number): Promise<number>;
}

export const AUTH_PUBLIC_SERVICE = Symbol('AUTH_PUBLIC_SERVICE');
