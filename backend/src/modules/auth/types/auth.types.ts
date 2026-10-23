import type { AuthEventStatusCode, AuthEventTypeCode } from '../contracts/index.js';
import type { UpdateSecuritySettingsRequest } from '../requests/auth.requests.js';

export interface StoredTrustedDeviceRecord {
  readonly deviceId: string;
  readonly tokenHash: string;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  lastUsedAt: string;
  readonly trustedUntil: string;
}

export interface MfaExtendedEnvelope {
  codes: string[];
  smsOtpEnabled?: boolean;
  smsOtpCodeHash?: string | null;
  smsOtpExpiresAt?: string | null;
  smsOtpFailedAttempts?: number;
  trustedDevices?: StoredTrustedDeviceRecord[];
}

export type SettingDescriptorKind =
  | 'number'
  | 'boolean'
  | 'passwordHashAlgo'
  | 'dbEncryptionAlgo'
  | 'mfaPolicy'
  | 'mfaMethods'
  | 'stringArray';

export interface SecuritySettingDescriptor {
  readonly dtoField: keyof UpdateSecuritySettingsRequest;
  readonly key: string;
  readonly namespace: string;
  readonly kind: SettingDescriptorKind;
  readonly syncFromRegistryToDb?: boolean;
}

export interface IssuedSessionTokens {
  readonly sessionId: number;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export interface RecordAuthEventInput {
  readonly userId?: number | null;
  readonly actorId?: number | null;
  readonly sessionId?: number | null;
  readonly identifier?: string | null;
  readonly eventType: AuthEventTypeCode;
  readonly status?: AuthEventStatusCode;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly deviceName?: string | null;
  readonly reason?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}
