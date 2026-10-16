import { z } from 'zod';
import type { UserProfileView } from '@modules/users/contracts/index.js';
import { userProfileResponseSchema } from '@modules/users/responses/users.response.js';
import type { MfaMethodType } from '../contracts/index.js';

export interface AuthenticatedUserProfileResponse {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly avatarUrl?: string | null;
  readonly phone: string | null;
  readonly status: number;
  readonly statusName: string;
  readonly emailVerifiedAt?: string | null;
  readonly phoneVerifiedAt?: string | null;
  readonly mfaEnabled: boolean;
  readonly primaryOrganizationUnitId: number | null;
  readonly organizationUnitIds: readonly number[];
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly profile?: UserProfileView;
}

export interface RegisterResponse {
  readonly registered: true;
  readonly verificationRequired: boolean;
  readonly verificationChannel?: 'EMAIL' | 'PHONE_OTP' | null;
  readonly maskedTarget?: string;
  readonly expiresInSeconds?: number;
  readonly devVerificationCode?: string;
  readonly devVerificationToken?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly sessionId?: number;
  readonly user: AuthenticatedUserProfileResponse;
}

export interface VerificationSendResponse {
  readonly sent: true;
  readonly channel: 'EMAIL' | 'PHONE_OTP';
  readonly maskedTarget: string;
  readonly expiresInSeconds: number;
  readonly sendCount: number;
  readonly maxSends: number;
  readonly cooldownSeconds: number;
  readonly devVerificationCode?: string;
  readonly devVerificationToken?: string;
}

export interface VerificationConfirmResponse {
  readonly verified: true;
  readonly channel: 'EMAIL' | 'PHONE_OTP';
  readonly userId: number;
  readonly verifiedAt: string;
}

export interface LoginResponse {
  readonly mfaRequired: boolean;
  readonly mfaChallengeToken?: string;
  readonly availableMfaMethods?: readonly MfaMethodType[];
  readonly emailOtpSent?: boolean;
  readonly maskedEmail?: string;
  readonly devOtpCode?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly sessionId?: number;
  readonly expiresInSeconds?: number;
  readonly user?: AuthenticatedUserProfileResponse;
}

export interface SessionItemResponse {
  readonly id: number;
  readonly userId: number;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceName: string | null;
  readonly isCurrent: boolean;
  readonly lastActiveAt: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface MfaStatusResponse {
  readonly mfaEnabled: boolean;
  readonly totpEnabled: boolean;
  readonly emailOtpEnabled: boolean;
  readonly preferredMethod: 'TOTP' | 'EMAIL_OTP' | 'RECOVERY_CODE';
  readonly remainingRecoveryCodesCount: number;
  readonly remainingRecoveryCodes: number;
  readonly verifiedAt: string | null;
}

export interface MfaTotpSetupResponse {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly otpauthUrl: string;
  readonly accountName: string;
  readonly issuer: string;
}

export interface MfaEnableResultResponse {
  readonly mfaEnabled: boolean;
  readonly totpEnabled: boolean;
  readonly emailOtpEnabled: boolean;
  readonly recoveryCodes: readonly string[];
}

export interface SendEmailOtpResponse {
  readonly sent: true;
  readonly maskedEmail: string;
  readonly expiresInSeconds: number;
  readonly devOtpCode?: string;
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

export const authenticatedUserProfileSchema = z.object({
  id: z.number().int().min(1),
  username: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  avatarUrl: z.string().nullable().optional(),
  phone: z.string().nullable(),
  status: z.number().int().min(1).max(4),
  statusName: z.string(),
  emailVerifiedAt: z.string().nullable().optional(),
  phoneVerifiedAt: z.string().nullable().optional(),
  mfaEnabled: z.boolean(),
  primaryOrganizationUnitId: z.number().int().min(1).nullable(),
  organizationUnitIds: z.array(z.number().int().min(1)),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  profile: userProfileResponseSchema.optional(),
});

export const registerResponseSchema = z.object({
  registered: z.literal(true),
  verificationRequired: z.boolean(),
  verificationChannel: z.enum(['EMAIL', 'PHONE_OTP']).nullable().optional(),
  maskedTarget: z.string().optional(),
  expiresInSeconds: z.number().optional(),
  devVerificationCode: z.string().optional(),
  devVerificationToken: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  sessionId: z.number().int().min(1).optional(),
  user: authenticatedUserProfileSchema,
});

export const verificationSendResponseSchema = z.object({
  sent: z.literal(true),
  channel: z.enum(['EMAIL', 'PHONE_OTP']),
  maskedTarget: z.string(),
  expiresInSeconds: z.number(),
  sendCount: z.number(),
  maxSends: z.number(),
  cooldownSeconds: z.number(),
  devVerificationCode: z.string().optional(),
  devVerificationToken: z.string().optional(),
});

export const verificationConfirmResponseSchema = z.object({
  verified: z.literal(true),
  channel: z.enum(['EMAIL', 'PHONE_OTP']),
  userId: z.number().int().min(1),
  verifiedAt: z.string(),
});

export const loginResponseSchema = z.object({
  mfaRequired: z.boolean(),
  mfaChallengeToken: z.string().optional(),
  availableMfaMethods: z.array(z.enum(['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'])).optional(),
  emailOtpSent: z.boolean().optional(),
  maskedEmail: z.string().optional(),
  devOtpCode: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  sessionId: z.number().int().min(1).optional(),
  expiresInSeconds: z.number().optional(),
  user: authenticatedUserProfileSchema.optional(),
});

export const sessionItemResponseSchema = z.object({
  id: z.number().int().min(1),
  userId: z.number().int().min(1),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  deviceName: z.string().nullable(),
  isCurrent: z.boolean(),
  lastActiveAt: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const mfaStatusResponseSchema = z.object({
  mfaEnabled: z.boolean(),
  totpEnabled: z.boolean(),
  emailOtpEnabled: z.boolean(),
  preferredMethod: z.enum(['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE']),
  remainingRecoveryCodesCount: z.number(),
  remainingRecoveryCodes: z.number(),
  verifiedAt: z.string().nullable(),
});

export const mfaTotpSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
  otpauthUrl: z.string(),
  accountName: z.string(),
  issuer: z.string(),
});

export const mfaEnableResultResponseSchema = z.object({
  mfaEnabled: z.boolean(),
  totpEnabled: z.boolean(),
  emailOtpEnabled: z.boolean(),
  recoveryCodes: z.array(z.string()),
});

export const sendEmailOtpResponseSchema = z.object({
  sent: z.literal(true),
  maskedEmail: z.string(),
  expiresInSeconds: z.number(),
  devOtpCode: z.string().optional(),
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

export interface SecuritySettingsResponse {
  readonly passwordHashAlgorithm: 'SCRYPT' | 'PBKDF2_SHA512' | 'PBKDF2_SHA256';
  readonly dbEncryptionAlgorithm: 'AES_256_GCM' | 'CHACHA20_POLY1305' | 'AES_256_CBC_HMAC';
  readonly encryptFieldsAtRest: boolean;
  readonly mfaPolicy: 'OPTIONAL' | 'REQUIRED_FOR_ADMINS' | 'REQUIRED_FOR_ALL';
  readonly allowedMfaMethods: readonly ('TOTP' | 'EMAIL_OTP' | 'RECOVERY_CODE')[];
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
  readonly availablePasswordHashAlgorithms: readonly (
    'SCRYPT' | 'PBKDF2_SHA512' | 'PBKDF2_SHA256'
  )[];
  readonly availableDbEncryptionAlgorithms: readonly (
    'AES_256_GCM' | 'CHACHA20_POLY1305' | 'AES_256_CBC_HMAC'
  )[];
  readonly updatedAt: string;
}

export const securitySettingsResponseSchema = z.object({
  passwordHashAlgorithm: z.enum(['SCRYPT', 'PBKDF2_SHA512', 'PBKDF2_SHA256']),
  dbEncryptionAlgorithm: z.enum(['AES_256_GCM', 'CHACHA20_POLY1305', 'AES_256_CBC_HMAC']),
  encryptFieldsAtRest: z.boolean(),
  mfaPolicy: z.enum(['OPTIONAL', 'REQUIRED_FOR_ADMINS', 'REQUIRED_FOR_ALL']),
  allowedMfaMethods: z.array(z.enum(['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'])),
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
  availablePasswordHashAlgorithms: z.array(z.enum(['SCRYPT', 'PBKDF2_SHA512', 'PBKDF2_SHA256'])),
  availableDbEncryptionAlgorithms: z.array(
    z.enum(['AES_256_GCM', 'CHACHA20_POLY1305', 'AES_256_CBC_HMAC']),
  ),
  updatedAt: z.string(),
});

