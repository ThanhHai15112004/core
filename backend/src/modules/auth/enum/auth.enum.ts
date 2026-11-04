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

export {
  VERIFICATION_CHANNEL,
  VERIFICATION_PURPOSE,
  type VerificationChannelCode,
  type VerificationPurposeCode,
} from '../entities/auth-verification-code.entity.js';
