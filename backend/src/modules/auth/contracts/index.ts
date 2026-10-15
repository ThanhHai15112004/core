import type { DbEncryptionAlgorithm, PasswordHashAlgorithm } from '@packages/security/index.js';

export type MfaMethodType = 'TOTP' | 'EMAIL_OTP' | 'RECOVERY_CODE';
export type MfaPolicyType = 'OPTIONAL' | 'REQUIRED_FOR_ADMINS' | 'REQUIRED_FOR_ALL';

export const MFA_METHOD_CODE = {
  TOTP: 1,
  EMAIL_OTP: 2,
  RECOVERY_CODE: 3,
} as const;

export const MFA_METHOD = MFA_METHOD_CODE;

export const MFA_METHOD_NAME: Record<number, MfaMethodType> = {
  1: 'TOTP',
  2: 'EMAIL_OTP',
  3: 'RECOVERY_CODE',
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
  return MFA_METHOD_CODE.TOTP;
}

export function getMfaMethodName(code: number): MfaMethodType {
  if (code === MFA_METHOD_CODE.EMAIL_OTP) return 'EMAIL_OTP';
  if (code === MFA_METHOD_CODE.RECOVERY_CODE) return 'RECOVERY_CODE';
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

export interface IAuthPublicService {
  revokeAllUserSessions(userId: number, reason?: string): Promise<number>;
}

export const AUTH_PUBLIC_SERVICE = Symbol('AUTH_PUBLIC_SERVICE');
