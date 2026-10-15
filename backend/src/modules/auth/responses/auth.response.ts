import { z } from 'zod';
import type { MfaMethodType } from '../contracts/index.js';

export interface AuthenticatedUserProfileResponse {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly status: string;
  readonly mfaEnabled: boolean;
  readonly primaryOrganizationUnitId: string | null;
  readonly organizationUnitIds: readonly string[];
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface LoginResponse {
  readonly mfaRequired: boolean;
  readonly mfaChallengeToken?: string;
  readonly availableMfaMethods?: readonly MfaMethodType[];
  readonly emailOtpSent?: boolean;
  readonly maskedEmail?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly sessionId?: string;
  readonly expiresInSeconds?: number;
  readonly user?: AuthenticatedUserProfileResponse;
}

export interface SessionItemResponse {
  readonly id: string;
  readonly userId: string;
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
  readonly preferredMethod: 'TOTP' | 'EMAIL_OTP';
  readonly remainingRecoveryCodesCount: number;
  readonly verifiedAt: string | null;
}

export interface MfaTotpSetupResponse {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly accountName: string;
  readonly issuer: string;
}

export interface MfaEnableResultResponse {
  readonly mfaEnabled: true;
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
  readonly devResetToken?: string;
}

export const authenticatedUserProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  phone: z.string().nullable(),
  status: z.string(),
  mfaEnabled: z.boolean(),
  primaryOrganizationUnitId: z.string().uuid().nullable(),
  organizationUnitIds: z.array(z.string().uuid()),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export const loginResponseSchema = z.object({
  mfaRequired: z.boolean(),
  mfaChallengeToken: z.string().optional(),
  availableMfaMethods: z.array(z.enum(['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'])).optional(),
  emailOtpSent: z.boolean().optional(),
  maskedEmail: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  sessionId: z.string().uuid().optional(),
  expiresInSeconds: z.number().optional(),
  user: authenticatedUserProfileSchema.optional(),
});

export const sessionItemResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
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
  preferredMethod: z.enum(['TOTP', 'EMAIL_OTP']),
  remainingRecoveryCodesCount: z.number(),
  verifiedAt: z.string().nullable(),
});

export const mfaTotpSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
  accountName: z.string(),
  issuer: z.string(),
});

export const mfaEnableResultResponseSchema = z.object({
  mfaEnabled: z.literal(true),
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
  devResetToken: z.string().optional(),
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
  availablePasswordHashAlgorithms: z.array(z.enum(['SCRYPT', 'PBKDF2_SHA512', 'PBKDF2_SHA256'])),
  availableDbEncryptionAlgorithms: z.array(
    z.enum(['AES_256_GCM', 'CHACHA20_POLY1305', 'AES_256_CBC_HMAC']),
  ),
  updatedAt: z.string(),
});
