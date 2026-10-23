import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  ApiClientCreatedWithSecret,
  ApiClientItem,
  ApiClientUsageLogResponseData,
  AuthenticatedUserProfile,
  LoginHistoryItem,
  LoginResponseData,
  MfaEnableResultData,
  MfaMethodType,
  MfaStatusData,
  MfaTotpSetupData,
  RegisterResponseData,
  SecuritySettingsState,
  ServiceAccountItem,
  SessionItem,
  StepUpVerifyResponseData,
  TrustedDeviceItem,
  UserPreferencesData,
  VerificationSendResponseData,
} from '../types/auth.types';

function authHeaders(accessToken?: string): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export const authApi = {
  // 1. Gateway: Login, Register, Refresh, Logout, Me, Preferences, Verification
  login: (payload: {
    identifier: string;
    password: string;
    deviceName?: string;
    trustedDeviceToken?: string;
  }) =>
    fetchApi<LoginResponseData>(API_ROUTES.AUTH.LOGIN, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  register: (payload: {
    username?: string;
    email?: string;
    phone?: string;
    password: string;
    firstName: string;
    lastName: string;
    fullName?: string;
    preferredLocale?: string;
    preferredTimezone?: string;
  }) =>
    fetchApi<RegisterResponseData>(API_ROUTES.AUTH.REGISTER, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  refreshToken: (refreshToken: string) =>
    fetchApi<{ accessToken: string; refreshToken: string; expiresInSeconds: number }>(
      API_ROUTES.AUTH.REFRESH,
      {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      },
    ),

  logout: (accessToken: string, refreshToken?: string) =>
    fetchApi<{ loggedOut: boolean }>(API_ROUTES.AUTH.LOGOUT, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    }),

  getMe: (accessToken: string) =>
    fetchApi<AuthenticatedUserProfile>(API_ROUTES.AUTH.ME, {
      headers: authHeaders(accessToken),
    }),

  getPreferences: (accessToken: string) =>
    fetchApi<UserPreferencesData>(API_ROUTES.AUTH.PREFERENCES, {
      headers: authHeaders(accessToken),
    }),

  updatePreferences: (
    accessToken: string,
    payload: { preferredLocale?: string | null; preferredTimezone?: string | null },
  ) =>
    fetchApi<UserPreferencesData>(API_ROUTES.AUTH.PREFERENCES, {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  sendEmailVerification: (email: string, accessToken?: string) =>
    fetchApi<VerificationSendResponseData>(API_ROUTES.AUTH.VERIFY_EMAIL_SEND, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ email }),
    }),

  confirmEmailVerification: (payload: { email?: string; code?: string; token?: string }) =>
    fetchApi<{ verified: boolean; channel: string; verifiedAt: string }>(
      API_ROUTES.AUTH.VERIFY_EMAIL_CONFIRM,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  sendPhoneVerification: (phone: string, accessToken?: string) =>
    fetchApi<VerificationSendResponseData>(API_ROUTES.AUTH.VERIFY_PHONE_SEND, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ phone }),
    }),

  confirmPhoneVerification: (payload: { phone: string; code: string }) =>
    fetchApi<{ verified: boolean; channel: string; verifiedAt: string }>(
      API_ROUTES.AUTH.VERIFY_PHONE_CONFIRM,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  // 2. MFA, Trusted Devices & Step-Up
  verifyMfaChallenge: (payload: {
    mfaChallengeToken: string;
    code: string;
    method?: MfaMethodType;
    trustThisDevice?: boolean;
    deviceName?: string;
  }) =>
    fetchApi<LoginResponseData>(API_ROUTES.AUTH.MFA_VERIFY, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMfaStatus: (accessToken: string) =>
    fetchApi<MfaStatusData>(API_ROUTES.AUTH.MFA_STATUS, {
      headers: authHeaders(accessToken),
    }),

  setupTotp: (accessToken: string) =>
    fetchApi<MfaTotpSetupData>(API_ROUTES.AUTH.MFA_TOTP_SETUP, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({}),
    }),

  enableTotp: (accessToken: string, code: string) =>
    fetchApi<MfaEnableResultData>(API_ROUTES.AUTH.MFA_TOTP_ENABLE, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ code }),
    }),

  sendEmailOtp: (payload: { mfaChallengeToken?: string }, accessToken?: string) =>
    fetchApi<{ sent: boolean; maskedEmail: string; expiresInSeconds: number; devOtpCode?: string }>(
      API_ROUTES.AUTH.MFA_EMAIL_OTP_SEND,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify(payload),
      },
    ),

  enableEmailOtp: (accessToken: string, code?: string) =>
    fetchApi<MfaEnableResultData>(API_ROUTES.AUTH.MFA_EMAIL_OTP_ENABLE, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(code ? { code } : {}),
    }),

  sendSmsOtp: (payload: { mfaChallengeToken?: string; phone?: string }, accessToken?: string) =>
    fetchApi<{ sent: boolean; maskedPhone: string; expiresInSeconds: number; devOtpCode?: string }>(
      API_ROUTES.AUTH.MFA_SMS_OTP_SEND,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify(payload),
      },
    ),

  enableSmsOtp: (accessToken: string, payload: { phone?: string; code?: string }) =>
    fetchApi<MfaEnableResultData>(API_ROUTES.AUTH.MFA_SMS_OTP_ENABLE, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  disableMfa: (
    accessToken: string,
    payload: { method?: 'TOTP' | 'EMAIL_OTP' | 'SMS_OTP' | 'ALL'; code?: string },
  ) =>
    fetchApi<MfaStatusData>(API_ROUTES.AUTH.MFA_DISABLE, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  regenerateRecoveryCodes: (accessToken: string) =>
    fetchApi<{ recoveryCodes: string[] }>(API_ROUTES.AUTH.MFA_RECOVERY_CODES, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({}),
    }),

  listTrustedDevices: (accessToken: string) =>
    fetchApi<TrustedDeviceItem[]>(API_ROUTES.AUTH.MFA_TRUSTED_DEVICES, {
      headers: authHeaders(accessToken),
    }),

  revokeTrustedDevice: (accessToken: string, deviceId: string) =>
    fetchApi<{ revoked: boolean; deviceId: string }>(
      API_ROUTES.AUTH.MFA_TRUSTED_DEVICE_BY_ID(deviceId),
      {
        method: 'DELETE',
        headers: authHeaders(accessToken),
      },
    ),

  revokeAllTrustedDevices: (accessToken: string) =>
    fetchApi<{ revokedCount: number }>(API_ROUTES.AUTH.MFA_TRUSTED_DEVICES, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    }),

  adminResetMfa: (
    accessToken: string,
    payload: {
      userId: number;
      reason: string;
      verificationReference?: string;
      revokeAllSessions?: boolean;
    },
  ) =>
    fetchApi<{
      reset: boolean;
      userId: number;
      revokedSessionsCount: number;
      revokedTrustedDevicesCount: number;
      resetAt: string;
    }>(API_ROUTES.AUTH.MFA_ADMIN_RESET, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  verifyStepUp: (
    accessToken: string,
    payload: {
      password?: string;
      code?: string;
      method?: MfaMethodType;
      action?: string;
    },
  ) =>
    fetchApi<StepUpVerifyResponseData>(API_ROUTES.AUTH.STEP_UP_VERIFY, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  // 3. Sessions & Login History
  listSessions: (accessToken: string) =>
    fetchApi<SessionItem[]>(API_ROUTES.AUTH.SESSIONS, {
      headers: authHeaders(accessToken),
    }),

  revokeSession: (accessToken: string, sessionId: number) =>
    fetchApi<{ revoked: boolean; sessionId: number }>(API_ROUTES.AUTH.REVOKE_SESSION(sessionId), {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    }),

  revokeAllSessions: (accessToken: string, exceptCurrentSession = true) =>
    fetchApi<{ revokedCount: number }>(API_ROUTES.AUTH.REVOKE_ALL_SESSIONS, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ exceptCurrentSession }),
    }),

  listLoginHistory: (accessToken: string, limit = 50) =>
    fetchApi<LoginHistoryItem[]>(API_ROUTES.AUTH.LOGIN_HISTORY(limit), {
      headers: authHeaders(accessToken),
    }),

  // 4. Password & Security Policy Settings
  changePassword: (
    accessToken: string,
    payload: { currentPassword?: string; newPassword: string; revokeOtherSessions?: boolean },
  ) =>
    fetchApi<{ changed: boolean }>(API_ROUTES.AUTH.PASSWORD_CHANGE, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  suggestPasswords: (count = 4, length = 16) =>
    fetchApi<{ suggestions: string[]; policy: Record<string, unknown> }>(
      API_ROUTES.AUTH.PASSWORD_SUGGEST(count, length),
    ),

  forgotPassword: (identifier: string) =>
    fetchApi<{
      accepted: boolean;
      maskedEmail?: string;
      expiresInSeconds: number;
      devResetToken?: string;
      devOtpCode?: string;
    }>(API_ROUTES.AUTH.PASSWORD_FORGOT, {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    }),

  resetPassword: (payload: {
    token?: string;
    identifier?: string;
    otpCode?: string;
    newPassword: string;
  }) =>
    fetchApi<{ reset: boolean }>(API_ROUTES.AUTH.PASSWORD_RESET, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminResetPassword: (
    accessToken: string,
    payload: {
      userId: number;
      temporaryPassword?: string;
      mustChangePassword?: boolean;
      revokeAllSessions?: boolean;
      reason?: string;
    },
  ) =>
    fetchApi<{
      reset: boolean;
      userId: number;
      temporaryPassword: string;
      mustChangePassword: boolean;
      revokedSessionsCount: number;
    }>(API_ROUTES.AUTH.PASSWORD_ADMIN_RESET, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  getSecuritySettings: (accessToken: string) =>
    fetchApi<SecuritySettingsState>(API_ROUTES.AUTH.SECURITY_SETTINGS, {
      headers: authHeaders(accessToken),
    }),

  updateSecuritySettings: (accessToken: string, payload: Partial<SecuritySettingsState>) =>
    fetchApi<SecuritySettingsState>(API_ROUTES.AUTH.SECURITY_SETTINGS, {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  // 5. Service Accounts & API Clients (M2M)
  listServiceAccounts: (accessToken: string) =>
    fetchApi<ServiceAccountItem[]>(API_ROUTES.AUTH.SERVICE_ACCOUNTS, {
      headers: authHeaders(accessToken),
    }),

  createServiceAccount: (
    accessToken: string,
    payload: {
      code: string;
      name: string;
      description?: string;
      scopes: string[];
      status?: 'ACTIVE' | 'DISABLED';
    },
  ) =>
    fetchApi<ServiceAccountItem>(API_ROUTES.AUTH.SERVICE_ACCOUNTS, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  updateServiceAccount: (
    accessToken: string,
    id: number,
    payload: {
      name?: string;
      description?: string | null;
      scopes?: string[];
      status?: 'ACTIVE' | 'DISABLED';
    },
  ) =>
    fetchApi<ServiceAccountItem>(API_ROUTES.AUTH.SERVICE_ACCOUNT_BY_ID(id), {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  listApiClients: (accessToken: string, serviceAccountId?: number) =>
    fetchApi<ApiClientItem[]>(API_ROUTES.AUTH.API_CLIENTS(serviceAccountId), {
      headers: authHeaders(accessToken),
    }),

  createApiClient: (
    accessToken: string,
    payload: {
      serviceAccountId: number;
      name: string;
      description?: string;
      scopes: string[];
      allowedIps: string[];
    },
  ) =>
    fetchApi<ApiClientCreatedWithSecret>(API_ROUTES.AUTH.API_CLIENTS(), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload),
    }),

  updateApiClientScopes: (accessToken: string, id: number, scopes: string[]) =>
    fetchApi<ApiClientItem>(API_ROUTES.AUTH.API_CLIENT_SCOPES(id), {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ scopes }),
    }),

  updateApiClientAllowedIps: (accessToken: string, id: number, allowedIps: string[]) =>
    fetchApi<ApiClientItem>(API_ROUTES.AUTH.API_CLIENT_ALLOWED_IPS(id), {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ allowedIps }),
    }),

  rotateApiClientSecret: (accessToken: string, id: number, reason?: string) =>
    fetchApi<{
      id: number;
      clientId: string;
      clientSecret: string;
      secretPrefix: string;
      tokenVersion: number;
      secretRotatedAt: string;
      secretShownOnceWarning: string;
    }>(API_ROUTES.AUTH.API_CLIENT_ROTATE_SECRET(id), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  revokeApiClient: (accessToken: string, id: number, reason?: string) =>
    fetchApi<{
      revoked: boolean;
      id: number;
      clientId: string;
      revokedAt: string;
      reason: string;
    }>(API_ROUTES.AUTH.API_CLIENT_REVOKE(id), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  getApiClientUsageLogs: (accessToken: string, id: number) =>
    fetchApi<ApiClientUsageLogResponseData>(API_ROUTES.AUTH.API_CLIENT_USAGE(id), {
      headers: authHeaders(accessToken),
    }),

  issueApiClientToken: (payload: {
    clientId: string;
    clientSecret: string;
    scopes?: string[];
  }) =>
    fetchApi<{
      accessToken: string;
      tokenType: 'Bearer';
      expiresInSeconds: number;
      scopes: string[];
      serviceAccountCode: string;
      clientId: string;
    }>(API_ROUTES.AUTH.API_CLIENT_TOKEN, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

