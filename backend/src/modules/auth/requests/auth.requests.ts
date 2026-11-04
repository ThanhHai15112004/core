import { z } from 'zod';
import { isSupportedLocale, isValidIanaTimezone } from '@packages/i18n/index.js';
import { mfaMethodSchema } from '@modules/mfa/index.js';

export const updateMyPreferencesSchema = z.object({
  preferredLocale: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .refine((loc) => isSupportedLocale(loc), {
      message: 'Unsupported or inactive locale code in i18n_locales',
    })
    .optional(),
  preferredTimezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((tz) => isValidIanaTimezone(tz), {
      message: 'Invalid IANA timezone identifier (e.g., Asia/Ho_Chi_Minh, UTC, America/New_York)',
    })
    .optional(),
});

export type UpdateMyPreferencesRequest = z.infer<typeof updateMyPreferencesSchema>;

export const loginRequestSchema = z.object({
  identifier: z.string().trim().min(2).max(255),
  password: z.string().min(1).max(255),
  deviceName: z.string().trim().max(128).optional(),
  trustedDeviceToken: z.string().trim().min(10).max(255).optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10),
});

export type RefreshTokenRequest = z.infer<typeof refreshTokenSchema>;

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
    preferredLocale: z.enum(['vi', 'en']).optional(),
    preferredTimezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((tz) => isValidIanaTimezone(tz), {
        message: 'Invalid IANA timezone identifier',
      })
      .optional(),
    deviceName: z.string().trim().max(128).optional(),
  })
  .refine((data) => Boolean(data.email?.trim() || data.phone?.trim()), {
    message: 'Either email or phone must be provided for registration',
  });

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

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

export const stepUpVerifySchema = z
  .object({
    password: z.string().min(1).max(255).optional(),
    code: z.string().trim().min(4).max(32).optional(),
    method: mfaMethodSchema.optional(),
    action: z.string().trim().max(128).optional(),
  })
  .refine((data) => Boolean(data.password?.trim() || data.code?.trim()), {
    message:
      'Either current password or MFA verification code is required for step-up authentication',
  });

export type StepUpVerifyRequest = z.infer<typeof stepUpVerifySchema>;
