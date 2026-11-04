import { z } from 'zod';

export const mfaMethodSchema = z.enum(['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE']);

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(255).optional(),
  newPassword: z.string().min(6).max(128),
  revokeOtherSessions: z.boolean().optional(),
});

export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().email().max(255).optional(),
    identifier: z.string().trim().min(2).max(255).optional(),
  })
  .refine((data) => Boolean(data.email?.trim() || data.identifier?.trim()), {
    message: 'Either email or identifier (email/phone/username) must be provided',
  });

export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(4).max(255).optional(),
    otpCode: z.string().trim().min(4).max(32).optional(),
    email: z.string().trim().email().max(255).optional(),
    identifier: z.string().trim().min(2).max(255).optional(),
    newPassword: z.string().min(6).max(128),
  })
  .refine((data) => Boolean(data.token?.trim() || data.otpCode?.trim()), {
    message: 'Either reset token or otpCode must be provided',
  });

export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

export const suggestPasswordQuerySchema = z
  .object({
    count: z.coerce.number().int().min(1).max(10).optional().default(3),
    length: z.coerce.number().int().min(6).max(64).optional(),
  })
  .default({ count: 3 });

export type SuggestPasswordQuery = z.infer<typeof suggestPasswordQuerySchema>;

export const adminResetPasswordRequestSchema = z.object({
  userId: z.number().int().min(1),
  newPassword: z.string().min(6).max(128).optional(),
  useSuggestedPassword: z.boolean().optional().default(false),
  revokeSessions: z.boolean().optional().default(true),
});

export type AdminResetPasswordRequest = z.infer<typeof adminResetPasswordRequestSchema>;
export const adminResetPasswordSchema = adminResetPasswordRequestSchema;

export const passwordHashAlgorithmSchema = z.enum(['SCRYPT', 'PBKDF2_SHA512', 'PBKDF2_SHA256']);

export const dbEncryptionAlgorithmSchema = z.enum([
  'AES_256_GCM',
  'CHACHA20_POLY1305',
  'AES_256_CBC_HMAC',
]);

export const mfaEnforcementPolicySchema = z.enum([
  'OPTIONAL',
  'REQUIRED_FOR_ADMINS',
  'REQUIRED_FOR_ALL',
]);

export const updateSecuritySettingsSchema = z.object({
  passwordHashAlgorithm: passwordHashAlgorithmSchema.optional(),
  dbEncryptionAlgorithm: dbEncryptionAlgorithmSchema.optional(),
  encryptFieldsAtRest: z.boolean().optional(),
  mfaPolicy: mfaEnforcementPolicySchema.optional(),
  allowedMfaMethods: z.array(mfaMethodSchema).min(1).optional(),
  maxFailedLoginAttempts: z.number().int().min(3).max(20).optional(),
  lockoutDurationMinutes: z.number().int().min(1).max(1440).optional(),
  passwordMinLength: z.number().int().min(6).max(64).optional(),
  requireUppercase: z.boolean().optional(),
  requireNumbers: z.boolean().optional(),
  requireSpecialChars: z.boolean().optional(),
  requireCurrentPasswordOnChange: z.boolean().optional(),
  disallowedPasswords: z.array(z.string().trim().min(1).max(128)).max(500).optional(),
  disallowUserInfoInPassword: z.boolean().optional(),
  preventPasswordReuse: z.boolean().optional(),
  passwordHistoryLimit: z.number().int().min(1).max(20).optional(),
  revokeSessionsOnPasswordChange: z.boolean().optional(),
  allowEmailRegistration: z.boolean().optional(),
  allowPhoneRegistration: z.boolean().optional(),
  requireEmailVerification: z.boolean().optional(),
  requirePhoneVerification: z.boolean().optional(),
  otpMaxSendCount: z.number().int().min(1).max(50).optional(),
  otpMaxAttempts: z.number().int().min(1).max(20).optional(),
  otpCooldownSeconds: z.number().int().min(0).max(3600).optional(),
  sessionIdleTimeoutMinutes: z.number().int().min(0).max(10080).optional(),
  sessionMaxLifetimeMinutes: z.number().int().min(5).max(43200).optional(),
  enableLoginAuditLog: z.boolean().optional(),
  passwordResetTtlSeconds: z.number().int().min(60).max(86400).optional(),
  mfaEmailOtpTtlSeconds: z.number().int().min(30).max(3600).optional(),
  mfaSmsOtpTtlSeconds: z.number().int().min(30).max(3600).optional(),
  mfaTrustedDeviceDays: z.number().int().min(1).max(365).optional(),
  mfaMaxTrustedDevices: z.number().int().min(1).max(100).optional(),
  mfaRecoveryCodeCount: z.number().int().min(4).max(20).optional(),
  mfaChallengeTtlSeconds: z.number().int().min(60).max(1800).optional(),
  mfaAdminRoleCodes: z.array(z.string().trim().min(1).max(64)).min(1).max(50).optional(),
  stepUpTokenTtlSeconds: z.number().int().min(60).max(3600).optional(),
  emailVerificationTtlSeconds: z.number().int().min(60).max(86400).optional(),
  phoneOtpTtlSeconds: z.number().int().min(30).max(3600).optional(),
  sessionAccessTokenTtlSeconds: z.number().int().min(60).max(86400).optional(),
  sessionRefreshTokenTtlSeconds: z.number().int().min(300).max(7776000).optional(),
  apiClientDefaultTokenTtlSeconds: z.number().int().min(60).max(86400).optional(),
  apiClientMaxUsageLogs: z.number().int().min(5).max(500).optional(),
});

export type UpdateSecuritySettingsRequest = z.infer<typeof updateSecuritySettingsSchema>;
