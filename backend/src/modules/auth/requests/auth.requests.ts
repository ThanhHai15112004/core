import { z } from 'zod';

export const mfaMethodSchema = z.enum(['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE']);

export const loginRequestSchema = z.object({
  identifier: z.string().trim().min(2).max(255),
  password: z.string().min(1).max(255),
  deviceName: z.string().trim().max(128).optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const verifyMfaChallengeSchema = z.object({
  mfaChallengeToken: z.string().min(10),
  code: z.string().trim().min(4).max(32),
  method: mfaMethodSchema.optional(),
  deviceName: z.string().trim().max(128).optional(),
});

export type VerifyMfaChallengeRequest = z.infer<typeof verifyMfaChallengeSchema>;

export const sendEmailOtpSchema = z.object({
  mfaChallengeToken: z.string().min(10).optional(),
});

export type SendEmailOtpRequest = z.infer<typeof sendEmailOtpSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10),
});

export type RefreshTokenRequest = z.infer<typeof refreshTokenSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(255),
  newPassword: z.string().min(8).max(128),
  revokeOtherSessions: z.boolean().default(true),
});

export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(255),
});

export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(10).max(255),
  newPassword: z.string().min(8).max(128),
});

export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

export const enableTotpMfaSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

export type EnableTotpMfaRequest = z.infer<typeof enableTotpMfaSchema>;

export const enableEmailOtpMfaSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Email OTP code must be 6 digits')
    .optional(),
});

export type EnableEmailOtpMfaRequest = z.infer<typeof enableEmailOtpMfaSchema>;

export const disableMfaSchema = z.object({
  method: z.enum(['TOTP', 'EMAIL_OTP', 'ALL']).default('ALL'),
  code: z.string().trim().min(4).max(32).optional(),
});

export type DisableMfaRequest = z.infer<typeof disableMfaSchema>;

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
});

export type UpdateSecuritySettingsRequest = z.infer<typeof updateSecuritySettingsSchema>;
