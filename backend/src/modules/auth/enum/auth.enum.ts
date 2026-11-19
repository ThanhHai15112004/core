export const STEP_UP_TOKEN_TTL_SECONDS = 300; // 5 phút
export const DEFAULT_ADMIN_ROLE_CODES: string[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'SYSTEM_ADMIN',
  'IAM_ADMIN',
  'SECURITY_ADMIN',
];

export const EMAIL_VERIFICATION_TTL_SECONDS = 900; // 15 phút
export const PHONE_OTP_TTL_SECONDS = 300; // 5 phút
export const DEFAULT_OTP_MAX_SENDS = 5;
export const DEFAULT_OTP_MAX_ATTEMPTS = 5;
export const DEFAULT_OTP_COOLDOWN_SECONDS = 60;

export const VERIFICATION_CHANNEL = {
  EMAIL: 1,
  PHONE_OTP: 2,
} as const;

export type VerificationChannelCode =
  (typeof VERIFICATION_CHANNEL)[keyof typeof VERIFICATION_CHANNEL];

export const VERIFICATION_PURPOSE = {
  VERIFY_EMAIL: 1,
  VERIFY_PHONE: 2,
  MFA_SMS: 3,
} as const;

export type VerificationPurposeCode =
  (typeof VERIFICATION_PURPOSE)[keyof typeof VERIFICATION_PURPOSE];
