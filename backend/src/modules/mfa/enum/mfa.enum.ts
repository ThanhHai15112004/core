export {
  MFA_METHOD,
  MFA_METHOD_CODE,
  MFA_METHOD_NAME,
  MFA_POLICY,
  MFA_POLICY_CODE,
  VALID_MFA_METHODS,
  VALID_MFA_POLICIES,
  getMfaMethodName,
  getMfaPolicyName,
  parseMfaMethod,
  parseMfaMethodCode,
  parseMfaPolicy,
  parseMfaPolicyCode,
  type MfaMethodCode,
  type MfaMethodName,
  type MfaMethodType,
  type MfaPolicyCode,
  type MfaPolicyName,
  type MfaPolicyType,
} from '@modules/credentials/contracts/index.js';

export const EMAIL_OTP_TTL_SECONDS = 300; // 5 phút
export const SMS_OTP_TTL_SECONDS = 300; // 5 phút
export const DEFAULT_TRUSTED_DEVICE_DAYS = 30;
export const DEFAULT_MAX_TRUSTED_DEVICES = 20;
export const DEFAULT_RECOVERY_CODE_COUNT = 8;
export const DEFAULT_MFA_OTP_MAX_ATTEMPTS = 5;

export const MFA_CHALLENGE_ATTEMPT_TTL_SEC = 300;
export const MFA_CHALLENGE_MAX_L1_ENTRIES = 5000;
export const DEFAULT_MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const DEFAULT_AUTO_LOCK_DURATION_MINUTES = 15;

export const MFA_SETTING_KEYS = {
  MFA_POLICY: {
    key: 'security.mfa.policy',
    defaultValue: 'OPTIONAL',
  },
  MFA_ALLOWED_METHODS: {
    key: 'security.mfa.allowed_methods',
    defaultValue: ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'] as readonly string[],
  },
  MFA_EMAIL_OTP_TTL_SECONDS: {
    key: 'security.mfa.email_otp_ttl_seconds',
    defaultValue: 300,
  },
  MFA_SMS_OTP_TTL_SECONDS: {
    key: 'security.mfa.sms_otp_ttl_seconds',
    defaultValue: 300,
  },
  MFA_TRUSTED_DEVICE_DAYS: {
    key: 'security.mfa.trusted_device_days',
    defaultValue: 30,
  },
  MFA_MAX_TRUSTED_DEVICES: {
    key: 'security.mfa.max_trusted_devices',
    defaultValue: 20,
  },
  MFA_RECOVERY_CODE_COUNT: {
    key: 'security.mfa.recovery_code_count',
    defaultValue: 8,
  },
  MFA_CHALLENGE_TTL_SECONDS: {
    key: 'security.mfa.challenge_ttl_seconds',
    defaultValue: 300,
  },
  MFA_ADMIN_ROLE_CODES: {
    key: 'security.mfa.admin_role_codes',
    defaultValue: [
      'SUPER_ADMIN',
      'ADMIN',
      'SYSTEM_ADMIN',
      'IAM_ADMIN',
      'SECURITY_ADMIN',
    ] as readonly string[],
  },
} as const;
