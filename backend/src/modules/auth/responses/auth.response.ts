import { z } from 'zod';
import { type UserProfileView, userProfileResponseSchema } from '@modules/users/index.js';
import type { MfaMethodType } from '@modules/mfa/contracts/index.js';

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
  readonly preferredLocale?: string;
  readonly preferredTimezone?: string;
  readonly profile?: UserProfileView;
}

export interface UserPreferencesResponse {
  readonly userId: number;
  readonly preferredLocale: string;
  readonly preferredTimezone: string;
  readonly updatedAt: string;
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

export interface StepUpVerifyResponse {
  readonly verified: true;
  readonly stepUpToken: string;
  readonly expiresInSeconds: number;
  readonly method: string;
  readonly action?: string | null;
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
  preferredLocale: z.string().optional(),
  preferredTimezone: z.string().optional(),
  profile: userProfileResponseSchema.optional(),
});

export const userPreferencesResponseSchema = z.object({
  userId: z.number().int().min(1),
  preferredLocale: z.string(),
  preferredTimezone: z.string(),
  updatedAt: z.string(),
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
  availableMfaMethods: z
    .array(z.enum(['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE']))
    .optional(),
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

export const stepUpVerifyResponseSchema = z.object({
  verified: z.literal(true),
  stepUpToken: z.string(),
  expiresInSeconds: z.number(),
  method: z.string(),
  action: z.string().nullable().optional(),
});
