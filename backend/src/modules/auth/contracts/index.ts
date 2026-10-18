import type { DbEncryptionAlgorithm, PasswordHashAlgorithm } from '@packages/security/index.js';

export type MfaMethodType = 'TOTP' | 'EMAIL_OTP' | 'SMS_OTP' | 'RECOVERY_CODE';
export type MfaPolicyType = 'OPTIONAL' | 'REQUIRED_FOR_ADMINS' | 'REQUIRED_FOR_ALL';

export const MFA_METHOD_CODE = {
  TOTP: 1,
  EMAIL_OTP: 2,
  RECOVERY_CODE: 3,
  SMS_OTP: 4,
} as const;

export const MFA_METHOD = MFA_METHOD_CODE;

export const MFA_METHOD_NAME: Record<number, MfaMethodType> = {
  1: 'TOTP',
  2: 'EMAIL_OTP',
  3: 'RECOVERY_CODE',
  4: 'SMS_OTP',
};

export type MfaMethodCode = (typeof MFA_METHOD_CODE)[keyof typeof MFA_METHOD_CODE];

export const MFA_POLICY_CODE = {
  OPTIONAL: 1,
  REQUIRED_FOR_ADMINS: 2,
  REQUIRED_FOR_ALL: 3,
} as const;

export const MFA_POLICY = MFA_POLICY_CODE;

export type MfaPolicyCode = (typeof MFA_POLICY_CODE)[keyof typeof MFA_POLICY_CODE];

export const PASSWORD_HASH_ALGO_CODE = {
  SCRYPT: 1,
  PBKDF2_SHA512: 2,
  PBKDF2_SHA256: 3,
} as const;

export type PasswordHashAlgoCode =
  (typeof PASSWORD_HASH_ALGO_CODE)[keyof typeof PASSWORD_HASH_ALGO_CODE];

export const DB_ENCRYPTION_ALGO_CODE = {
  AES_256_GCM: 1,
  CHACHA20_POLY1305: 2,
  AES_256_CBC_HMAC: 3,
} as const;

export type DbEncryptionAlgoCode =
  (typeof DB_ENCRYPTION_ALGO_CODE)[keyof typeof DB_ENCRYPTION_ALGO_CODE];

export function parseMfaMethodCode(val: unknown): MfaMethodCode {
  if (val === 1 || val === '1' || val === 'TOTP') return MFA_METHOD_CODE.TOTP;
  if (val === 2 || val === '2' || val === 'EMAIL_OTP') return MFA_METHOD_CODE.EMAIL_OTP;
  if (val === 3 || val === '3' || val === 'RECOVERY_CODE') return MFA_METHOD_CODE.RECOVERY_CODE;
  if (val === 4 || val === '4' || val === 'SMS_OTP') return MFA_METHOD_CODE.SMS_OTP;
  return MFA_METHOD_CODE.TOTP;
}

export function getMfaMethodName(code: number): MfaMethodType {
  if (code === MFA_METHOD_CODE.EMAIL_OTP) return 'EMAIL_OTP';
  if (code === MFA_METHOD_CODE.RECOVERY_CODE) return 'RECOVERY_CODE';
  if (code === MFA_METHOD_CODE.SMS_OTP) return 'SMS_OTP';
  return 'TOTP';
}

export function parseMfaPolicyCode(val: unknown): MfaPolicyCode {
  if (val === 2 || val === '2' || val === 'REQUIRED_FOR_ADMINS') {
    return MFA_POLICY_CODE.REQUIRED_FOR_ADMINS;
  }
  if (val === 3 || val === '3' || val === 'REQUIRED_FOR_ALL') {
    return MFA_POLICY_CODE.REQUIRED_FOR_ALL;
  }
  return MFA_POLICY_CODE.OPTIONAL;
}

export function getMfaPolicyName(code: number): MfaPolicyType {
  if (code === MFA_POLICY_CODE.REQUIRED_FOR_ADMINS) return 'REQUIRED_FOR_ADMINS';
  if (code === MFA_POLICY_CODE.REQUIRED_FOR_ALL) return 'REQUIRED_FOR_ALL';
  return 'OPTIONAL';
}

export function parsePasswordHashAlgoCode(val: unknown): PasswordHashAlgoCode {
  if (val === 2 || val === '2' || val === 'PBKDF2_SHA512') {
    return PASSWORD_HASH_ALGO_CODE.PBKDF2_SHA512;
  }
  if (val === 3 || val === '3' || val === 'PBKDF2_SHA256') {
    return PASSWORD_HASH_ALGO_CODE.PBKDF2_SHA256;
  }
  return PASSWORD_HASH_ALGO_CODE.SCRYPT;
}

export function getPasswordHashAlgoName(code: number): PasswordHashAlgorithm {
  if (code === PASSWORD_HASH_ALGO_CODE.PBKDF2_SHA512) return 'PBKDF2_SHA512';
  if (code === PASSWORD_HASH_ALGO_CODE.PBKDF2_SHA256) return 'PBKDF2_SHA256';
  return 'SCRYPT';
}

export function parseDbEncryptionAlgoCode(val: unknown): DbEncryptionAlgoCode {
  if (val === 2 || val === '2' || val === 'CHACHA20_POLY1305') {
    return DB_ENCRYPTION_ALGO_CODE.CHACHA20_POLY1305;
  }
  if (val === 3 || val === '3' || val === 'AES_256_CBC_HMAC') {
    return DB_ENCRYPTION_ALGO_CODE.AES_256_CBC_HMAC;
  }
  return DB_ENCRYPTION_ALGO_CODE.AES_256_GCM;
}

export function getDbEncryptionAlgoName(code: number): DbEncryptionAlgorithm {
  if (code === DB_ENCRYPTION_ALGO_CODE.CHACHA20_POLY1305) return 'CHACHA20_POLY1305';
  if (code === DB_ENCRYPTION_ALGO_CODE.AES_256_CBC_HMAC) return 'AES_256_CBC_HMAC';
  return 'AES_256_GCM';
}

export const AUTH_EVENT_TYPE = {
  LOGIN_SUCCESS: 1,
  LOGIN_FAILED: 2,
  MFA_CHALLENGE: 3,
  MFA_FAILED: 4,
  LOGOUT: 5,
  SESSION_REVOKED: 6,
  SESSION_REVOKE_ALL: 7,
  SESSION_EXPIRED: 8,
  TOKEN_REUSE_DETECTED: 9,
} as const;

export type AuthEventTypeCode = (typeof AUTH_EVENT_TYPE)[keyof typeof AUTH_EVENT_TYPE];
export type AuthEventTypeName = keyof typeof AUTH_EVENT_TYPE;

export const AUTH_EVENT_STATUS = {
  SUCCESS: 1,
  FAILED: 2,
} as const;

export type AuthEventStatusCode = (typeof AUTH_EVENT_STATUS)[keyof typeof AUTH_EVENT_STATUS];
export type AuthEventStatusName = keyof typeof AUTH_EVENT_STATUS;

export function getAuthEventTypeName(code: number): AuthEventTypeName {
  switch (Number(code)) {
    case AUTH_EVENT_TYPE.LOGIN_FAILED:
      return 'LOGIN_FAILED';
    case AUTH_EVENT_TYPE.MFA_CHALLENGE:
      return 'MFA_CHALLENGE';
    case AUTH_EVENT_TYPE.MFA_FAILED:
      return 'MFA_FAILED';
    case AUTH_EVENT_TYPE.LOGOUT:
      return 'LOGOUT';
    case AUTH_EVENT_TYPE.SESSION_REVOKED:
      return 'SESSION_REVOKED';
    case AUTH_EVENT_TYPE.SESSION_REVOKE_ALL:
      return 'SESSION_REVOKE_ALL';
    case AUTH_EVENT_TYPE.SESSION_EXPIRED:
      return 'SESSION_EXPIRED';
    case AUTH_EVENT_TYPE.TOKEN_REUSE_DETECTED:
      return 'TOKEN_REUSE_DETECTED';
    case AUTH_EVENT_TYPE.LOGIN_SUCCESS:
    default:
      return 'LOGIN_SUCCESS';
  }
}

export function getAuthEventStatusName(code: number): AuthEventStatusName {
  return Number(code) === AUTH_EVENT_STATUS.FAILED ? 'FAILED' : 'SUCCESS';
}

export interface IEmailNotificationAdapter {
  sendOtpEmail(payload: {
    userId: number;
    email: string;
    otpCode: string;
    expiresInSeconds: number;
    purpose: 'MFA_EMAIL_OTP' | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
    verificationToken?: string | undefined;
  }): Promise<{ delivered: boolean; messageId?: string }>;
}

export interface ISmsOtpProvider {
  sendOtpSms(payload: {
    userId: number;
    phone: string;
    otpCode: string;
    expiresInSeconds: number;
    purpose: 'MFA_SMS_OTP' | 'PHONE_VERIFICATION';
  }): Promise<{ delivered: boolean; providerMessageId?: string }>;
}

export const AUTH_EMAIL_NOTIFICATION_ADAPTER = Symbol('AUTH_EMAIL_NOTIFICATION_ADAPTER');
export const AUTH_SMS_OTP_PROVIDER = Symbol('AUTH_SMS_OTP_PROVIDER');

export interface TrustedDeviceView {
  readonly deviceId: string;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly trustedUntil: string;
}

export interface AdminResetMfaInput {
  readonly reason: string;
  readonly verificationReference?: string | undefined;
  readonly revokeSessions?: boolean | undefined;
}

export interface AdminResetMfaResult {
  readonly reset: true;
  readonly userId: number;
  readonly revokedSessionsCount: number;
  readonly revokedTrustedDevicesCount: number;
  readonly reason: string;
  readonly verificationReference?: string | null;
  readonly resetByActorId?: number | null;
  readonly resetAt: string;
}

export interface IAuthPublicService {
  revokeAllUserSessions(
    userId: number,
    reason?: string,
    exceptSessionId?: number,
  ): Promise<number>;
}

export const AUTH_PUBLIC_SERVICE = Symbol('AUTH_PUBLIC_SERVICE');

export {
  SERVICE_ACCOUNT_STATUS,
  type ServiceAccountStatusCode,
  type ServiceAccountStatusName,
  getServiceAccountStatusName,
  parseServiceAccountStatus,
} from '../entities/auth-service-account.entity.js';

export {
  API_CLIENT_STATUS,
  type ApiClientStatusCode,
  type ApiClientStatusName,
  type ApiClientUsageLogItem,
  type ApiClientUsageResultType,
  getApiClientStatusName,
} from '../entities/auth-api-client.entity.js';



