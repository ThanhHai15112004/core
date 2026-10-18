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
  readonly mfaPolicyEnforced?: boolean;
  readonly mfaEnrollmentRequired?: boolean;
  readonly mfaChallengeToken?: string;
  readonly availableMfaMethods?: readonly MfaMethodType[];
  readonly emailOtpSent?: boolean;
  readonly smsOtpSent?: boolean;
  readonly maskedEmail?: string;
  readonly maskedPhone?: string;
  readonly devOtpCode?: string;
  readonly trustedDeviceToken?: string;
  readonly trustedDeviceExpiresAt?: string;
  readonly trustedDeviceBypassed?: boolean;
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
  readonly revokedAt?: string | null;
  readonly revokeReason?: string | null;
}

export interface LoginHistoryItemResponse {
  readonly id: number;
  readonly userId: number | null;
  readonly sessionId: number | null;
  readonly identifier: string | null;
  readonly eventType: number;
  readonly eventTypeName:
    | 'LOGIN_SUCCESS'
    | 'LOGIN_FAILED'
    | 'MFA_CHALLENGE'
    | 'MFA_FAILED'
    | 'LOGOUT'
    | 'SESSION_REVOKED'
    | 'SESSION_REVOKE_ALL'
    | 'SESSION_EXPIRED'
    | 'TOKEN_REUSE_DETECTED';
  readonly status: number;
  readonly statusName: 'SUCCESS' | 'FAILED';
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceName: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface MfaStatusResponse {
  readonly mfaEnabled: boolean;
  readonly totpEnabled: boolean;
  readonly emailOtpEnabled: boolean;
  readonly smsOtpEnabled?: boolean;
  readonly preferredMethod: 'TOTP' | 'EMAIL_OTP' | 'SMS_OTP' | 'RECOVERY_CODE';
  readonly remainingRecoveryCodesCount: number;
  readonly remainingRecoveryCodes: number;
  readonly trustedDevicesCount?: number;
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
  readonly smsOtpEnabled?: boolean;
  readonly recoveryCodes: readonly string[];
}

export interface SendEmailOtpResponse {
  readonly sent: true;
  readonly maskedEmail: string;
  readonly expiresInSeconds: number;
  readonly messageId?: string;
  readonly devOtpCode?: string;
}

export interface SendSmsOtpResponse {
  readonly sent: true;
  readonly maskedPhone: string;
  readonly expiresInSeconds: number;
  readonly providerMessageId?: string;
  readonly devOtpCode?: string;
}

export interface TrustedDeviceItemResponse {
  readonly deviceId: string;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly trustedUntil: string;
}

export interface StepUpVerifyResponse {
  readonly verified: true;
  readonly stepUpToken: string;
  readonly expiresInSeconds: number;
  readonly method: string;
  readonly action?: string | null;
}

export interface AdminResetMfaResponse {
  readonly reset: true;
  readonly userId: number;
  readonly revokedSessionsCount: number;
  readonly revokedTrustedDevicesCount: number;
  readonly reason: string;
  readonly verificationReference?: string | null;
  readonly resetByActorId?: number | null;
  readonly resetAt: string;
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
  mfaPolicyEnforced: z.boolean().optional(),
  mfaEnrollmentRequired: z.boolean().optional(),
  mfaChallengeToken: z.string().optional(),
  availableMfaMethods: z.array(z.enum(['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE'])).optional(),
  emailOtpSent: z.boolean().optional(),
  smsOtpSent: z.boolean().optional(),
  maskedEmail: z.string().optional(),
  maskedPhone: z.string().optional(),
  devOtpCode: z.string().optional(),
  trustedDeviceToken: z.string().optional(),
  trustedDeviceExpiresAt: z.string().optional(),
  trustedDeviceBypassed: z.boolean().optional(),
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
  revokedAt: z.string().nullable().optional(),
  revokeReason: z.string().nullable().optional(),
});

export const loginHistoryItemResponseSchema = z.object({
  id: z.number().int().min(1),
  userId: z.number().int().min(1).nullable(),
  sessionId: z.number().int().min(1).nullable(),
  identifier: z.string().nullable(),
  eventType: z.number().int().min(1).max(9),
  eventTypeName: z.enum([
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'MFA_CHALLENGE',
    'MFA_FAILED',
    'LOGOUT',
    'SESSION_REVOKED',
    'SESSION_REVOKE_ALL',
    'SESSION_EXPIRED',
    'TOKEN_REUSE_DETECTED',
  ]),
  status: z.number().int().min(1).max(2),
  statusName: z.enum(['SUCCESS', 'FAILED']),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  deviceName: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const mfaStatusResponseSchema = z.object({
  mfaEnabled: z.boolean(),
  totpEnabled: z.boolean(),
  emailOtpEnabled: z.boolean(),
  smsOtpEnabled: z.boolean().optional(),
  preferredMethod: z.enum(['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE']),
  remainingRecoveryCodesCount: z.number(),
  remainingRecoveryCodes: z.number(),
  trustedDevicesCount: z.number().optional(),
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
  smsOtpEnabled: z.boolean().optional(),
  recoveryCodes: z.array(z.string()),
});

export const sendEmailOtpResponseSchema = z.object({
  sent: z.literal(true),
  maskedEmail: z.string(),
  expiresInSeconds: z.number(),
  messageId: z.string().optional(),
  devOtpCode: z.string().optional(),
});

export const sendSmsOtpResponseSchema = z.object({
  sent: z.literal(true),
  maskedPhone: z.string(),
  expiresInSeconds: z.number(),
  providerMessageId: z.string().optional(),
  devOtpCode: z.string().optional(),
});

export const trustedDeviceItemResponseSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  trustedUntil: z.string(),
});

export const stepUpVerifyResponseSchema = z.object({
  verified: z.literal(true),
  stepUpToken: z.string(),
  expiresInSeconds: z.number(),
  method: z.string(),
  action: z.string().nullable().optional(),
});

export const adminResetMfaResponseSchema = z.object({
  reset: z.literal(true),
  userId: z.number().int().min(1),
  revokedSessionsCount: z.number().int().min(0),
  revokedTrustedDevicesCount: z.number().int().min(0),
  reason: z.string(),
  verificationReference: z.string().nullable().optional(),
  resetByActorId: z.number().int().nullable().optional(),
  resetAt: z.string(),
});

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

// ============================================================================
// MỤC 3.6: TÀI KHOẢN HỆ THỐNG (SERVICE ACCOUNT) & API CLIENT RESPONSES
// ============================================================================

export interface ServiceAccountResponse {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  readonly isServiceAccount: true;
  readonly userId: null;
  readonly scopes: readonly string[];
  readonly createdBy: number | null;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly lastUsedResult: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiClientResponse {
  readonly id: number;
  readonly serviceAccountId: number;
  readonly serviceAccountCode?: string;
  readonly serviceAccountName?: string;
  readonly name: string;
  readonly description: string | null;
  readonly clientId: string;
  readonly secretPrefix: string;
  readonly scopes: readonly string[];
  readonly allowedIps: readonly string[];
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'REVOKED';
  readonly tokenVersion: number;
  readonly secretRotatedAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly lastUsedResult: string | null;
  readonly lastUsedEndpoint: string | null;
  readonly createdBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiClientCreatedWithSecretResponse extends ApiClientResponse {
  readonly clientSecret: string;
  readonly oneTimeSecretWarning: true;
}

export interface ApiClientRotateSecretResponse {
  readonly rotated: true;
  readonly id: number;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly secretPrefix: string;
  readonly tokenVersion: number;
  readonly secretRotatedAt: string;
  readonly oneTimeSecretWarning: true;
}

export interface ApiClientRevokeResponse {
  readonly revoked: true;
  readonly id: number;
  readonly clientId: string;
  readonly status: number;
  readonly statusName: 'REVOKED';
  readonly tokenVersion: number;
  readonly revokedAt: string;
  readonly revokedReason: string | null;
}

export interface ApiClientTokenResponse {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly clientId: string;
  readonly serviceAccountId: number;
  readonly serviceAccountCode: string;
  readonly scopes: readonly string[];
}

export interface ApiClientUsageLogResponse {
  readonly id: number;
  readonly clientId: string;
  readonly serviceAccountId: number;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly lastUsedResult: string | null;
  readonly lastUsedEndpoint: string | null;
  readonly logs: ReadonlyArray<{
    readonly timestamp: string;
    readonly ipAddress: string | null;
    readonly action: 'ISSUE_TOKEN' | 'API_REQUEST';
    readonly endpoint: string | null;
    readonly status: 'SUCCESS' | 'FAILED';
    readonly result: string;
    readonly reason?: string | null;
  }>;
}

export const serviceAccountResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.number().int().min(1).max(3),
  statusName: z.enum(['ACTIVE', 'INACTIVE', 'REVOKED']),
  isServiceAccount: z.literal(true),
  userId: z.null(),
  scopes: z.array(z.string()),
  createdBy: z.number().int().nullable(),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  lastUsedResult: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const apiClientResponseSchema = z.object({
  id: z.number().int().min(1),
  serviceAccountId: z.number().int().min(1),
  serviceAccountCode: z.string().optional(),
  serviceAccountName: z.string().optional(),
  name: z.string(),
  description: z.string().nullable(),
  clientId: z.string(),
  secretPrefix: z.string(),
  scopes: z.array(z.string()),
  allowedIps: z.array(z.string()),
  status: z.number().int().min(1).max(2),
  statusName: z.enum(['ACTIVE', 'REVOKED']),
  tokenVersion: z.number().int().min(1),
  secretRotatedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  lastUsedResult: z.string().nullable(),
  lastUsedEndpoint: z.string().nullable(),
  createdBy: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const apiClientCreatedWithSecretResponseSchema = apiClientResponseSchema.extend({
  clientSecret: z.string(),
  oneTimeSecretWarning: z.literal(true),
});

export const apiClientRotateSecretResponseSchema = z.object({
  rotated: z.literal(true),
  id: z.number().int().min(1),
  clientId: z.string(),
  clientSecret: z.string(),
  secretPrefix: z.string(),
  tokenVersion: z.number().int().min(1),
  secretRotatedAt: z.string(),
  oneTimeSecretWarning: z.literal(true),
});

export const apiClientRevokeResponseSchema = z.object({
  revoked: z.literal(true),
  id: z.number().int().min(1),
  clientId: z.string(),
  status: z.number().int(),
  statusName: z.literal('REVOKED'),
  tokenVersion: z.number().int().min(1),
  revokedAt: z.string(),
  revokedReason: z.string().nullable(),
});

export const apiClientTokenResponseSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
  clientId: z.string(),
  serviceAccountId: z.number().int().min(1),
  serviceAccountCode: z.string(),
  scopes: z.array(z.string()),
});

export const apiClientUsageLogResponseSchema = z.object({
  id: z.number().int().min(1),
  clientId: z.string(),
  serviceAccountId: z.number().int().min(1),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  lastUsedResult: z.string().nullable(),
  lastUsedEndpoint: z.string().nullable(),
  logs: z.array(
    z.object({
      timestamp: z.string(),
      ipAddress: z.string().nullable(),
      action: z.enum(['ISSUE_TOKEN', 'API_REQUEST']),
      endpoint: z.string().nullable(),
      status: z.enum(['SUCCESS', 'FAILED']),
      result: z.string(),
      reason: z.string().nullable().optional(),
    }),
  ),
});

