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


export const enableTotpMfaSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

export type EnableTotpMfaRequest = z.infer<typeof enableTotpMfaSchema>;

export const enableEmailOtpMfaSchema = z.object({
  enabled: z.boolean().optional(),
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

export const registerRequestSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional(),
    email: z.string().trim().email().max(255).nullable().optional(),
    phone: z.string().trim().min(6).max(32).nullable().optional(),
    password: z.string().min(6).max(128),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(150).optional(),
    fullName: z.string().trim().min(2).max(255).optional(),
    avatarUrl: z.string().trim().url().max(500).nullable().optional(),
    dateOfBirth: z.string().trim().max(32).nullable().optional(),
    gender: z.number().int().min(1).max(3).nullable().optional(),
    address: z.string().trim().max(255).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    country: z.string().trim().max(100).nullable().optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
    deviceName: z.string().trim().max(128).optional(),
  })
  .refine((data) => Boolean(data.email?.trim() || data.phone?.trim()), {
    message: 'Either email or phone must be provided for registration',
  });

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const revokeAllSessionsSchema = z
  .object({
    includeCurrent: z.boolean().optional().default(false),
  })
  .default({ includeCurrent: false });

export type RevokeAllSessionsRequest = z.infer<typeof revokeAllSessionsSchema>;

export const sendEmailVerificationSchema = z
  .object({
    email: z.string().trim().email().max(255).optional(),
  })
  .default({});

export type SendEmailVerificationRequest = z.infer<typeof sendEmailVerificationSchema>;

export const confirmEmailVerificationSchema = z.object({
  email: z.string().trim().email().max(255).optional(),
  tokenOrCode: z.string().trim().min(4).max(255),
});

export type ConfirmEmailVerificationRequest = z.infer<typeof confirmEmailVerificationSchema>;

export const sendPhoneOtpVerificationSchema = z
  .object({
    phone: z.string().trim().min(6).max(32).optional(),
  })
  .default({});

export type SendPhoneOtpVerificationRequest = z.infer<typeof sendPhoneOtpVerificationSchema>;

export const confirmPhoneOtpVerificationSchema = z.object({
  phone: z.string().trim().min(6).max(32).optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'OTP code must be 6 digits'),
});

export type ConfirmPhoneOtpVerificationRequest = z.infer<typeof confirmPhoneOtpVerificationSchema>;

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
});

export type UpdateSecuritySettingsRequest = z.infer<typeof updateSecuritySettingsSchema>;

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

