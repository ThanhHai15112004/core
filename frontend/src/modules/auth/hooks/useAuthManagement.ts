import { useState, useEffect, useCallback } from 'react';
import {
  ensureAccessToken,
  getStoredAccessToken,
  getStoredRefreshToken,
  IAM_ACCESS_TOKEN_KEY,
  IAM_AUTH_CHANGED_EVENT,
  IAM_REFRESH_TOKEN_KEY,
} from '../../../core/services/api';
import { authApi } from '../services/auth.api';
import type { AuthSubTabId } from '../enum/auth.enum';
import type {
  ApiClientItem,
  AuthenticatedUserProfile,
  LoginHistoryItem,
  MfaStatusData,
  SecuritySettingsState,
  ServiceAccountItem,
  SessionItem,
  TrustedDeviceItem,
} from '../types/auth.types';

const DEFAULT_SECURITY_SETTINGS: SecuritySettingsState = {
  passwordMinLength: 10,
  requireUppercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  requireCurrentPasswordOnChange: false,
  disallowUserInfoInPassword: true,
  disallowedPasswords: ['password', '12345678', 'admin123'],
  preventPasswordReuse: true,
  passwordHistoryLimit: 5,
  revokeSessionsOnPasswordChange: true,
  passwordHashAlgorithm: 'argon2id',
  dbEncryptionAlgorithm: 'aes-256-gcm',
  encryptFieldsAtRest: true,
  mfaPolicy: 'OPTIONAL',
  allowedMfaMethods: ['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE'],
  maxFailedLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  allowEmailRegistration: true,
  allowPhoneRegistration: true,
  requireEmailVerification: false,
  requirePhoneVerification: false,
  otpMaxSendCount: 5,
  otpMaxAttempts: 5,
  otpCooldownSeconds: 60,
  sessionIdleTimeoutMinutes: 30,
  sessionMaxLifetimeMinutes: 10080,
  enableLoginAuditLog: true,
};

export function useAuthManagement() {
  const [subTab, setSubTab] = useState<AuthSubTabId>('gateway');
  const [statusBanner, setStatusBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(false);

  const [accessToken, setAccessTokenState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(IAM_ACCESS_TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [refreshToken, setRefreshTokenState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(IAM_REFRESH_TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const setAccessToken = useCallback((token: string) => {
    setAccessTokenState(token);
    try {
      if (token) window.localStorage.setItem(IAM_ACCESS_TOKEN_KEY, token);
      else window.localStorage.removeItem(IAM_ACCESS_TOKEN_KEY);
      window.dispatchEvent(new CustomEvent(IAM_AUTH_CHANGED_EVENT));
    } catch {
      // ignore storage errors
    }
  }, []);

  const setRefreshToken = useCallback((token: string) => {
    setRefreshTokenState(token);
    try {
      if (token) window.localStorage.setItem(IAM_REFRESH_TOKEN_KEY, token);
      else window.localStorage.removeItem(IAM_REFRESH_TOKEN_KEY);
      window.dispatchEvent(new CustomEvent(IAM_AUTH_CHANGED_EVENT));
    } catch {
      // ignore storage errors
    }
  }, []);

  const [currentUser, setCurrentUser] = useState<AuthenticatedUserProfile | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatusData | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryItem[]>([]);
  const [securitySettings, setSecuritySettings] =
    useState<SecuritySettingsState>(DEFAULT_SECURITY_SETTINGS);
  const [serviceAccounts, setServiceAccounts] = useState<ServiceAccountItem[]>([]);
  const [apiClients, setApiClients] = useState<ApiClientItem[]>([]);

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setStatusBanner({ type, text });
  }, []);

  const refreshProfileAndCoreState = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride ?? accessToken;
      if (!token) {
        setCurrentUser(null);
        setMfaStatus(null);
        setTrustedDevices([]);
        setSessions([]);
        setLoginHistory([]);
        return;
      }

      setLoading(true);
      try {
        const [meRes, mfaRes, devicesRes, sessionsRes, historyRes, secRes, saRes, clientsRes] =
          await Promise.all([
            authApi.getMe(token).catch(() => null),
            authApi.getMfaStatus(token).catch(() => null),
            authApi.listTrustedDevices(token).catch(() => []),
            authApi.listSessions(token).catch(() => []),
            authApi.listLoginHistory(token, 50).catch(() => []),
            authApi.getSecuritySettings(token).catch(() => null),
            authApi.listServiceAccounts(token).catch(() => []),
            authApi.listApiClients(token).catch(() => []),
          ]);

        if (meRes) setCurrentUser(meRes);
        if (mfaRes) setMfaStatus(mfaRes);
        if (Array.isArray(devicesRes)) setTrustedDevices(devicesRes);
        if (Array.isArray(sessionsRes)) setSessions(sessionsRes);
        if (Array.isArray(historyRes)) setLoginHistory(historyRes);
        if (secRes) setSecuritySettings((prev) => ({ ...prev, ...secRes }));
        if (Array.isArray(saRes)) setServiceAccounts(saRes);
        if (Array.isArray(clientsRes)) setApiClients(clientsRes);
      } finally {
        setLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    const syncTokensFromStorage = () => {
      const storedAccess = getStoredAccessToken() ?? '';
      const storedRefresh = getStoredRefreshToken() ?? '';
      setAccessTokenState(storedAccess);
      setRefreshTokenState(storedRefresh);
    };
    window.addEventListener(IAM_AUTH_CHANGED_EVENT, syncTokensFromStorage);
    return () => {
      window.removeEventListener(IAM_AUTH_CHANGED_EVENT, syncTokensFromStorage);
    };
  }, []);

  useEffect(() => {
    if (accessToken) {
      void refreshProfileAndCoreState(accessToken);
    } else {
      void ensureAccessToken(false).then((bootstrappedToken) => {
        if (bootstrappedToken) {
          setAccessTokenState(bootstrappedToken);
          setRefreshTokenState(getStoredRefreshToken() ?? '');
        }
      });
    }
  }, [accessToken, refreshProfileAndCoreState]);

  const handleLogout = useCallback(async () => {
    if (accessToken) {
      await authApi.logout(accessToken, refreshToken).catch(() => null);
    }
    setAccessToken('');
    setRefreshToken('');
    setCurrentUser(null);
    setMfaStatus(null);
    setTrustedDevices([]);
    setSessions([]);
    setLoginHistory([]);
    notify('ok', 'Đã đăng xuất và xóa khóa phiên cục bộ.');
  }, [accessToken, refreshToken, setAccessToken, setRefreshToken, notify]);

  const handleRotateRefreshToken = useCallback(async () => {
    if (!refreshToken) {
      notify('err', 'Không tìm thấy Refresh Token để xoay vòng.');
      return;
    }
    try {
      const res = await authApi.refreshToken(refreshToken);
      setAccessToken(res.accessToken);
      setRefreshToken(res.refreshToken);
      notify(
        'ok',
        `Đã xoay vòng Refresh Token thành công (TTL: ${res.expiresInSeconds}s).`,
      );
      await refreshProfileAndCoreState(res.accessToken);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi xoay vòng Refresh Token');
    }
  }, [refreshToken, setAccessToken, setRefreshToken, notify, refreshProfileAndCoreState]);

  return {
    subTab,
    setSubTab,
    statusBanner,
    setStatusBanner,
    notify,
    loading,
    accessToken,
    refreshToken,
    setAccessToken,
    setRefreshToken,
    currentUser,
    setCurrentUser,
    mfaStatus,
    setMfaStatus,
    trustedDevices,
    setTrustedDevices,
    sessions,
    setSessions,
    loginHistory,
    setLoginHistory,
    securitySettings,
    setSecuritySettings,
    serviceAccounts,
    setServiceAccounts,
    apiClients,
    setApiClients,
    refreshProfileAndCoreState,
    handleLogout,
    handleRotateRefreshToken,
  };
}

