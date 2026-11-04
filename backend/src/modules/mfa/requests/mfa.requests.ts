import { z } from 'zod';
import { mfaMethodSchema } from '@modules/credentials/index.js';

export { mfaMethodSchema };

export const verifyMfaChallengeSchema = z.object({
  mfaChallengeToken: z.string().min(10),
  code: z.string().trim().min(4).max(32),
  method: mfaMethodSchema.optional(),
  deviceName: z.string().trim().max(128).optional(),
  trustDevice: z.boolean().optional(),
  trustDurationDays: z.number().int().min(1).max(365).optional(),
});

export type VerifyMfaChallengeRequest = z.infer<typeof verifyMfaChallengeSchema>;

export const sendEmailOtpSchema = z
  .object({
    mfaChallengeToken: z.string().min(10).optional(),
  })
  .default({});

export type SendEmailOtpRequest = z.infer<typeof sendEmailOtpSchema>;

export const sendSmsOtpSchema = z
  .object({
    mfaChallengeToken: z.string().min(10).optional(),
    phone: z.string().trim().min(6).max(32).optional(),
  })
  .default({});

export type SendSmsOtpRequest = z.infer<typeof sendSmsOtpSchema>;

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

export const enableSmsOtpMfaSchema = z.object({
  enabled: z.boolean().optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'SMS OTP code must be 6 digits')
    .optional(),
});

export type EnableSmsOtpMfaRequest = z.infer<typeof enableSmsOtpMfaSchema>;

export const disableMfaSchema = z.object({
  method: z.enum(['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'ALL']).default('ALL'),
  code: z.string().trim().min(4).max(32).optional(),
  currentPassword: z.string().min(1).max(255).optional(),
  stepUpToken: z.string().trim().min(10).optional(),
});

export type DisableMfaRequest = z.infer<typeof disableMfaSchema>;

export const adminResetMfaRequestSchema = z.object({
  userId: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
  verificationReference: z.string().trim().max(255).optional(),
  revokeSessions: z.boolean().optional(),
  stepUpToken: z.string().trim().min(10).optional(),
});

export type AdminResetMfaRequest = z.infer<typeof adminResetMfaRequestSchema>;
export const adminResetMfaSchema = adminResetMfaRequestSchema;
