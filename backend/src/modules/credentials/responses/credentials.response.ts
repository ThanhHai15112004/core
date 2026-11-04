import { z } from 'zod';
import type {
  AdminResetPasswordResponse,
  ForgotPasswordResponse,
  SecuritySettingsResponse,
  SuggestedPasswordResponse,
} from '../types/credentials.types.js';

export type {
  AdminResetPasswordResponse,
  ForgotPasswordResponse,
  SecuritySettingsResponse,
  SuggestedPasswordResponse,
};

export const securitySettingsResponseSchema = z.object({
  passwordHashAlgorithm: z.enum(['SCRYPT', 'PBKDF2_SHA512', 'PBKDF2_SHA256']),
  dbEncryptionAlgorithm: z.enum(['AES_256_GCM', 'CHACHA20_POLY1305', 'AES_256_CBC_HMAC']),
  encryptFieldsAtRest: z.boolean(),
  mfaPolicy: z.enum(['OPTIONAL', 'REQUIRED_FOR_ADMINS', 'REQUIRED_FOR_ALL']),
  allowedMfaMethods: z.array(z.enum(['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE'])),
  maxFailedLoginAttempts: z.number(),
  lockoutDurationMinutes: z.number(),
  passwordMinLength: z.number(),
  requireUppercase: z.boolean(),
  requireNumbers: z.boolean(),
  requireSpecialChars: z.boolean(),
  requireCurrentPasswordOnChange: z.boolean(),
  disallowedPasswords: z.array(z.string()),
  disallowUserInfoInPassword: z.boolean(),
  preventPasswordReuse: z.boolean(),
  passwordHistoryLimit: z.number(),
  revokeSessionsOnPasswordChange: z.boolean(),
  allowEmailRegistration: z.boolean(),
  allowPhoneRegistration: z.boolean(),
  requireEmailVerification: z.boolean(),
  requirePhoneVerification: z.boolean(),
  otpMaxSendCount: z.number(),
  otpMaxAttempts: z.number(),
  otpCooldownSeconds: z.number(),
  sessionIdleTimeoutMinutes: z.number().optional(),
  sessionMaxLifetimeMinutes: z.number().optional(),
  enableLoginAuditLog: z.boolean().optional(),
  passwordResetTtlSeconds: z.number().optional(),
  mfaEmailOtpTtlSeconds: z.number().optional(),
  mfaSmsOtpTtlSeconds: z.number().optional(),
  mfaTrustedDeviceDays: z.number().optional(),
  mfaMaxTrustedDevices: z.number().optional(),
  mfaRecoveryCodeCount: z.number().optional(),
  mfaChallengeTtlSeconds: z.number().optional(),
  mfaAdminRoleCodes: z.array(z.string()).optional(),
  stepUpTokenTtlSeconds: z.number().optional(),
  emailVerificationTtlSeconds: z.number().optional(),
  phoneOtpTtlSeconds: z.number().optional(),
  sessionAccessTokenTtlSeconds: z.number().optional(),
  sessionRefreshTokenTtlSeconds: z.number().optional(),
  apiClientDefaultTokenTtlSeconds: z.number().optional(),
  apiClientMaxUsageLogs: z.number().optional(),
  availablePasswordHashAlgorithms: z.array(z.enum(['SCRYPT', 'PBKDF2_SHA512', 'PBKDF2_SHA256'])),
  availableDbEncryptionAlgorithms: z.array(
    z.enum(['AES_256_GCM', 'CHACHA20_POLY1305', 'AES_256_CBC_HMAC']),
  ),
  updatedAt: z.string(),
});

export const forgotPasswordResponseSchema = z.object({
  accepted: z.literal(true),
  expiresInSeconds: z.number(),
  maskedTarget: z.string().optional(),
  devResetToken: z.string().optional(),
  devResetOtp: z.string().optional(),
});

export const suggestedPasswordResponseSchema = z.object({
  password: z.string(),
  suggestedPassword: z.string(),
  suggestions: z.array(z.string()),
  policy: z.object({
    passwordMinLength: z.number(),
    requireUppercase: z.boolean(),
    requireNumbers: z.boolean(),
    requireSpecialChars: z.boolean(),
  }),
});

export const adminResetPasswordResponseSchema = z.object({
  reset: z.literal(true),
  userId: z.number().int().min(1),
  revokedSessionsCount: z.number().int().min(0),
  generatedPassword: z.string().optional(),
});

export const changePasswordResponseSchema = z.object({
  changed: z.literal(true),
  revokedSessionsCount: z.number(),
});

export const resetPasswordResponseSchema = z.object({
  reset: z.literal(true),
  revokedSessionsCount: z.number(),
});
