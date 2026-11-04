import type { UpdateSecuritySettingsRequest } from '../requests/credentials.requests.js';

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

export interface SecuritySettingsResponse {
  readonly passwordHashAlgorithm: 'SCRYPT' | 'PBKDF2_SHA512' | 'PBKDF2_SHA256';
  readonly dbEncryptionAlgorithm: 'AES_256_GCM' | 'CHACHA20_POLY1305' | 'AES_256_CBC_HMAC';
  readonly encryptFieldsAtRest: boolean;
  readonly mfaPolicy: 'OPTIONAL' | 'REQUIRED_FOR_ADMINS' | 'REQUIRED_FOR_ALL';
  readonly allowedMfaMethods: readonly ('TOTP' | 'EMAIL_OTP' | 'SMS_OTP' | 'RECOVERY_CODE')[];
  readonly maxFailedLoginAttempts: number;
  readonly lockoutDurationMinutes: number;
  readonly passwordMinLength: number;
  readonly requireUppercase: boolean;
  readonly requireNumbers: boolean;
  readonly requireSpecialChars: boolean;
  readonly requireCurrentPasswordOnChange: boolean;
  readonly disallowedPasswords: readonly string[];
  readonly disallowUserInfoInPassword: boolean;
  readonly preventPasswordReuse: boolean;
  readonly passwordHistoryLimit: number;
  readonly revokeSessionsOnPasswordChange: boolean;
  readonly allowEmailRegistration: boolean;
  readonly allowPhoneRegistration: boolean;
  readonly requireEmailVerification: boolean;
  readonly requirePhoneVerification: boolean;
  readonly otpMaxSendCount: number;
  readonly otpMaxAttempts: number;
  readonly otpCooldownSeconds: number;
  readonly sessionIdleTimeoutMinutes?: number;
  readonly sessionMaxLifetimeMinutes?: number;
  readonly enableLoginAuditLog?: boolean;
  readonly passwordResetTtlSeconds?: number;
  readonly mfaEmailOtpTtlSeconds?: number;
  readonly mfaSmsOtpTtlSeconds?: number;
  readonly mfaTrustedDeviceDays?: number;
  readonly mfaMaxTrustedDevices?: number;
  readonly mfaRecoveryCodeCount?: number;
  readonly mfaChallengeTtlSeconds?: number;
  readonly mfaAdminRoleCodes?: readonly string[];
  readonly stepUpTokenTtlSeconds?: number;
  readonly emailVerificationTtlSeconds?: number;
  readonly phoneOtpTtlSeconds?: number;
  readonly sessionAccessTokenTtlSeconds?: number;
  readonly sessionRefreshTokenTtlSeconds?: number;
  readonly apiClientDefaultTokenTtlSeconds?: number;
  readonly apiClientMaxUsageLogs?: number;
  readonly availablePasswordHashAlgorithms: readonly (
    'SCRYPT' | 'PBKDF2_SHA512' | 'PBKDF2_SHA256'
  )[];
  readonly availableDbEncryptionAlgorithms: readonly (
    'AES_256_GCM' | 'CHACHA20_POLY1305' | 'AES_256_CBC_HMAC'
  )[];
  readonly updatedAt: string;
}

export interface ForgotPasswordResponse {
  readonly accepted: true;
  readonly expiresInSeconds: number;
  readonly maskedTarget?: string;
  readonly devResetToken?: string;
  readonly devResetOtp?: string;
}

export interface SuggestedPasswordResponse {
  readonly password: string;
  readonly suggestedPassword: string;
  readonly suggestions: readonly string[];
  readonly policy: {
    readonly passwordMinLength: number;
    readonly requireUppercase: boolean;
    readonly requireNumbers: boolean;
    readonly requireSpecialChars: boolean;
  };
}

export interface AdminResetPasswordResponse {
  readonly reset: true;
  readonly userId: number;
  readonly revokedSessionsCount: number;
  readonly generatedPassword?: string;
}
