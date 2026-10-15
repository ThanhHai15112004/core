export type MfaMethodType = 'TOTP' | 'EMAIL_OTP' | 'RECOVERY_CODE';

export interface IAuthPublicService {
  revokeAllUserSessions(userId: string, reason?: string): Promise<number>;
}

export const AUTH_PUBLIC_SERVICE = Symbol('AUTH_PUBLIC_SERVICE');
