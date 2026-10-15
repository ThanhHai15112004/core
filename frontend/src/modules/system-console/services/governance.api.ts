import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';

export interface SecretItem {
  key: string;
  driver: 'env' | 'file';
  present: boolean;
  length?: number;
}

export interface ConfigItem {
  domain: string;
  key: string;
  value: unknown;
  source: 'env' | 'default';
  sensitive: boolean;
}

export type PasswordHashAlgo = 'SCRYPT' | 'PBKDF2_SHA512' | 'PBKDF2_SHA256';
export type DbEncryptionAlgo = 'AES_256_GCM' | 'CHACHA20_POLY1305' | 'AES_256_CBC_HMAC';
export type MfaPolicyMode = 'OPTIONAL' | 'REQUIRED_FOR_ADMINS' | 'REQUIRED_FOR_ALL';
export type MfaMethodOption = 'TOTP' | 'EMAIL_OTP' | 'RECOVERY_CODE';

export interface SecurityPolicySettings {
  passwordHashAlgorithm: PasswordHashAlgo;
  dbEncryptionAlgorithm: DbEncryptionAlgo;
  encryptFieldsAtRest: boolean;
  mfaPolicy: MfaPolicyMode;
  allowedMfaMethods: MfaMethodOption[];
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
  passwordMinLength: number;
  requireUppercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  availablePasswordHashAlgorithms: PasswordHashAlgo[];
  availableDbEncryptionAlgorithms: DbEncryptionAlgo[];
  updatedAt: string;
}

export function fetchSecrets(): Promise<SecretItem[]> {
  return fetchApi<SecretItem[]>(API_ROUTES.OPS.SECRETS);
}

export function fetchConfiguration(): Promise<ConfigItem[]> {
  return fetchApi<ConfigItem[]>(API_ROUTES.OPS.CONFIGURATION);
}

export function fetchSecuritySettings(): Promise<SecurityPolicySettings> {
  return fetchApi<SecurityPolicySettings>(API_ROUTES.AUTH.SECURITY_SETTINGS);
}

export function updateSecuritySettings(
  payload: Partial<Omit<SecurityPolicySettings, 'availablePasswordHashAlgorithms' | 'availableDbEncryptionAlgorithms' | 'updatedAt'>>,
): Promise<SecurityPolicySettings> {
  return fetchApi<SecurityPolicySettings>(API_ROUTES.AUTH.SECURITY_SETTINGS, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
