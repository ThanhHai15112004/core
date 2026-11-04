import { z } from 'zod';
import type {
  AdminResetMfaResponse,
  MfaEnableResultResponse,
  MfaStatusResponse,
  MfaTotpSetupResponse,
  SendEmailOtpResponse,
  SendSmsOtpResponse,
  TrustedDeviceItemResponse,
} from '../types/mfa.types.js';

export type {
  AdminResetMfaResponse,
  MfaEnableResultResponse,
  MfaStatusResponse,
  MfaTotpSetupResponse,
  SendEmailOtpResponse,
  SendSmsOtpResponse,
  TrustedDeviceItemResponse,
};

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
