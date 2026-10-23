export type MfaMethodType = 'TOTP' | 'EMAIL_OTP' | 'SMS_OTP' | 'RECOVERY_CODE';
export type MfaPolicyType = 'OPTIONAL' | 'REQUIRED_FOR_ADMINS' | 'REQUIRED_FOR_ALL';

export interface AuthenticatedUserProfile {
  id: number;
  username: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  status: number;
  statusName?: string;
  emailVerified: boolean;
  emailVerifiedAt?: string | null;
  phoneVerified: boolean;
  phoneVerifiedAt?: string | null;
  mfaEnabled: boolean;
  preferredLocale?: string | null;
  preferredTimezone?: string | null;
  roles: string[];
  permissions: string[];
  primaryOrganizationUnitId: number | null;
  organizationUnitIds: number[];
}

export interface LoginResponseData {
  mfaRequired: boolean;
  mfaPolicyEnforced?: boolean;
  mfaEnrollmentRequired?: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  trustedDeviceToken?: string;
  mfaChallengeToken?: string;
  availableMfaMethods?: MfaMethodType[];
  emailOtpSent?: boolean;
  smsOtpSent?: boolean;
  maskedEmail?: string;
  maskedPhone?: string;
  devOtpCode?: string;
  user?: AuthenticatedUserProfile;
}

export interface RegisterResponseData {
  registered: boolean;
  verificationRequired: boolean;
  verificationChannel?: 'EMAIL' | 'PHONE' | 'NONE';
  maskedTarget?: string;
  expiresInSeconds?: number;
  devVerificationCode?: string;
  accessToken?: string;
  refreshToken?: string;
  user: AuthenticatedUserProfile;
}

export interface VerificationSendResponseData {
  sent: boolean;
  channel: 'EMAIL' | 'PHONE';
  maskedTarget: string;
  expiresInSeconds: number;
  cooldownSeconds: number;
  remainingSends: number;
  devVerificationCode?: string;
  devVerificationToken?: string;
}

export interface UserPreferencesData {
  userId: number;
  preferredLocale: string | null;
  preferredTimezone: string | null;
  updatedAt: string;
}

export interface MfaStatusData {
  mfaEnabled: boolean;
  totpEnabled: boolean;
  emailOtpEnabled: boolean;
  smsOtpEnabled?: boolean;
  maskedPhone?: string | null;
  remainingRecoveryCodesCount: number;
  trustedDevicesCount?: number;
  mfaPolicy?: MfaPolicyType;
  allowedMfaMethods?: MfaMethodType[];
}

export interface MfaTotpSetupData {
  secret: string;
  otpauthUrl: string;
  issuer: string;
  accountName: string;
}

export interface MfaEnableResultData {
  enabled: boolean;
  method: 'TOTP' | 'EMAIL_OTP' | 'SMS_OTP';
  recoveryCodes: string[];
}

export interface TrustedDeviceItem {
  deviceId: string;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  trustedUntil: string;
}

export interface StepUpVerifyResponseData {
  verified: boolean;
  stepUpToken: string;
  expiresInSeconds: number;
  verifiedMethod: 'PASSWORD' | MfaMethodType;
  action?: string | null;
}

export interface SessionItem {
  id: number;
  userId?: number;
  deviceName: string | null;
  userAgent?: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  expiresAt: string;
  createdAt?: string;
  isCurrent: boolean;
}

export interface LoginHistoryItem {
  id: number;
  userId: number | null;
  identifier: string | null;
  sessionId: number | null;
  eventType: number;
  eventTypeName: string;
  status: number;
  statusName: string;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  reason: string | null;
  createdAt: string;
}

export interface SecuritySettingsState {
  passwordMinLength: number;
  requireUppercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  requireCurrentPasswordOnChange: boolean;
  disallowUserInfoInPassword: boolean;
  disallowedPasswords: string[];
  preventPasswordReuse: boolean;
  passwordHistoryLimit: number;
  revokeSessionsOnPasswordChange: boolean;
  passwordResetTtlSeconds?: number;
  passwordHashAlgorithm: 'argon2id' | 'bcrypt' | 'pbkdf2';
  dbEncryptionAlgorithm: 'aes-256-gcm' | 'aes-256-cbc';
  encryptFieldsAtRest: boolean;
  mfaPolicy: MfaPolicyType;
  allowedMfaMethods: MfaMethodType[];
  mfaEmailOtpTtlSeconds?: number;
  mfaSmsOtpTtlSeconds?: number;
  mfaTrustedDeviceDays?: number;
  mfaMaxTrustedDevices?: number;
  mfaRecoveryCodeCount?: number;
  stepUpTokenTtlSeconds?: number;
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
  allowEmailRegistration: boolean;
  allowPhoneRegistration: boolean;
  requireEmailVerification: boolean;
  requirePhoneVerification: boolean;
  otpMaxSendCount: number;
  otpMaxAttempts: number;
  otpCooldownSeconds: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
  enableLoginAuditLog: boolean;
  apiClientDefaultTokenTtlSeconds?: number;
  apiClientMaxUsageLogs?: number;
}

export interface ServiceAccountItem {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: number;
  statusName: 'ACTIVE' | 'DISABLED';
  isServiceAccount: true;
  userId: null;
  scopes: string[];
  createdBy: number | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  lastUsedResult: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiClientItem {
  id: number;
  serviceAccountId: number;
  serviceAccountCode?: string;
  serviceAccountName?: string;
  name: string;
  description: string | null;
  clientId: string;
  secretPrefix: string;
  scopes: string[];
  allowedIps: string[];
  status: number;
  statusName: 'ACTIVE' | 'REVOKED';
  tokenVersion: number;
  secretRotatedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  lastUsedResult: string | null;
  lastUsedEndpoint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiClientCreatedWithSecret extends ApiClientItem {
  clientSecret: string;
  secretShownOnceWarning: string;
}

export interface ApiClientUsageLogEntry {
  timestamp: string;
  ipAddress: string | null;
  action: 'ISSUE_TOKEN' | 'API_REQUEST';
  endpoint: string | null;
  status: 'SUCCESS' | 'FAILED';
  result: string;
  reason: string | null;
}

export interface ApiClientUsageLogResponseData {
  id: number;
  clientId: string;
  serviceAccountId: number;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  lastUsedResult: string | null;
  lastUsedEndpoint: string | null;
  logs: ApiClientUsageLogEntry[];
}

