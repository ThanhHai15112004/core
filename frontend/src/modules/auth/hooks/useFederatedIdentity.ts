import { useCallback, useEffect, useState } from 'react';
import { federatedIdentityApi } from '../services/federated-identity.api';
import type {
  FederatedAuthEventItem,
  FederatedDriverMetadata,
  FederatedIdentityItem,
  FederatedMonitoringSummaryData,
  FederatedPolicyData,
  FederatedProviderItem,
  OAuthCallbackResponseData,
  OidcDiscoveryTestResult,
  PublicFederatedProvider,
  TestFederatedProviderResult,
} from '../types/federated-identity.types';

const PENDING_OAUTH_STORAGE_KEY = 'core_pending_oauth_tx';

interface PendingOAuthTransaction {
  readonly providerCode: string;
  readonly flowType: 'LOGIN' | 'LINK';
  readonly redirectUri: string;
  readonly createdAtMs: number;
}

export function getDefaultOAuthRedirectUri(): string {
  if (typeof window === 'undefined') return 'http://localhost:5173/auth';
  return `${window.location.origin}/auth`;
}

export function useFederatedIdentity(
  accessToken: string,
  notify: (type: 'ok' | 'err', text: string) => void,
) {
  const [publicProviders, setPublicProviders] = useState<PublicFederatedProvider[]>([]);
  const [myAccounts, setMyAccounts] = useState<FederatedIdentityItem[]>([]);
  const [drivers, setDrivers] = useState<FederatedDriverMetadata[]>([]);
  const [adminProviders, setAdminProviders] = useState<FederatedProviderItem[]>([]);
  const [policy, setPolicy] = useState<FederatedPolicyData | null>(null);
  const [monitoringSummary, setMonitoringSummary] =
    useState<FederatedMonitoringSummaryData | null>(null);
  const [monitoringEvents, setMonitoringEvents] = useState<FederatedAuthEventItem[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshPublicProviders = useCallback(async () => {
    try {
      const list = await federatedIdentityApi.listPublicProviders();
      setPublicProviders(Array.isArray(list) ? list : []);
    } catch {
      setPublicProviders([]);
    }
  }, []);

  const refreshAllFederatedState = useCallback(async () => {
    await refreshPublicProviders();
    if (!accessToken) {
      setMyAccounts([]);
      setDrivers([]);
      setAdminProviders([]);
      setPolicy(null);
      setMonitoringSummary(null);
      setMonitoringEvents([]);
      return;
    }

    const [accountsRes, driversRes, policyRes, providersRes, summaryRes, eventsRes] =
      await Promise.all([
        federatedIdentityApi.listMyAccounts(accessToken).catch(() => []),
        federatedIdentityApi.listDrivers(accessToken).catch(() => []),
        federatedIdentityApi.getPolicy(accessToken).catch(() => null),
        federatedIdentityApi.listProviders(accessToken).catch(() => []),
        federatedIdentityApi.getMonitoringSummary(accessToken, 24).catch(() => null),
        federatedIdentityApi
          .listMonitoringEvents(accessToken, { page: 1, limit: 20 })
          .catch(() => ({ data: [] })),
      ]);

    setMyAccounts(Array.isArray(accountsRes) ? accountsRes : []);
    setDrivers(Array.isArray(driversRes) ? driversRes : []);
    setPolicy(policyRes);
    setAdminProviders(Array.isArray(providersRes) ? providersRes : []);
    setMonitoringSummary(summaryRes);
    setMonitoringEvents(Array.isArray(eventsRes?.data) ? eventsRes.data : []);
  }, [accessToken, refreshPublicProviders]);

  useEffect(() => {
    void refreshAllFederatedState();
  }, [refreshAllFederatedState]);

  const startOAuthLogin = useCallback(
    async (providerCode: string, deviceName?: string) => {
      setBusy(true);
      try {
        const redirectUri = getDefaultOAuthRedirectUri();
        const res = await federatedIdentityApi.initiateLoginAuthorize(providerCode, {
          redirectUri,
          deviceName,
        });
        const pending: PendingOAuthTransaction = {
          providerCode,
          flowType: 'LOGIN',
          redirectUri,
          createdAtMs: Date.now(),
        };
        window.sessionStorage.setItem(PENDING_OAUTH_STORAGE_KEY, JSON.stringify(pending));
        window.location.assign(res.authorizationUrl);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể khởi tạo đăng nhập OAuth');
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const startOAuthLink = useCallback(
    async (providerCode: string) => {
      if (!accessToken) {
        notify('err', 'Cần đăng nhập trước khi liên kết tài khoản ngoài');
        return;
      }
      setBusy(true);
      try {
        const redirectUri = getDefaultOAuthRedirectUri();
        const res = await federatedIdentityApi.initiateLinkAuthorize(accessToken, providerCode, {
          redirectUri,
        });
        const pending: PendingOAuthTransaction = {
          providerCode,
          flowType: 'LINK',
          redirectUri,
          createdAtMs: Date.now(),
        };
        window.sessionStorage.setItem(PENDING_OAUTH_STORAGE_KEY, JSON.stringify(pending));
        window.location.assign(res.authorizationUrl);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể khởi tạo liên kết OAuth');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify],
  );

  const consumePendingOAuthCallback = useCallback(
    async (options?: {
      readonly deviceName?: string;
      readonly trustedDeviceToken?: string;
    }): Promise<OAuthCallbackResponseData | null> => {
      if (typeof window === 'undefined') return null;
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const oauthError = params.get('error');
      const oauthErrorDesc = params.get('error_description');

      if (!state && !oauthError && !code) return null;

      const rawPending = window.sessionStorage.getItem(PENDING_OAUTH_STORAGE_KEY);
      if (!rawPending) return null;

      let pending: PendingOAuthTransaction | null = null;
      try {
        pending = JSON.parse(rawPending) as PendingOAuthTransaction;
      } catch {
        pending = null;
      }
      window.sessionStorage.removeItem(PENDING_OAUTH_STORAGE_KEY);

      // Làm sạch query OAuth khỏi thanh địa chỉ trình duyệt
      window.history.replaceState({}, document.title, window.location.pathname);

      if (!pending || !state) {
        if (oauthError) {
          notify('err', `Lỗi từ nhà cung cấp OAuth: ${oauthErrorDesc || oauthError}`);
        }
        return null;
      }

      setBusy(true);
      try {
        if (pending.flowType === 'LINK') {
          if (!accessToken) {
            notify('err', 'Phiên đăng nhập đã mất trước khi hoàn tất liên kết tài khoản ngoài.');
            return null;
          }
          return await federatedIdentityApi.handleLinkCallback(accessToken, pending.providerCode, {
            ...(code ? { code } : {}),
            state,
            redirectUri: pending.redirectUri,
            ...(oauthError ? { error: oauthError } : {}),
            ...(oauthErrorDesc ? { errorDescription: oauthErrorDesc } : {}),
          });
        }

        return await federatedIdentityApi.handleCallback(
          pending.providerCode,
          {
            ...(code ? { code } : {}),
            state,
            redirectUri: pending.redirectUri,
            ...(oauthError ? { error: oauthError } : {}),
            ...(oauthErrorDesc ? { errorDescription: oauthErrorDesc } : {}),
            ...(options?.deviceName ? { deviceName: options.deviceName } : {}),
            ...(options?.trustedDeviceToken
              ? { trustedDeviceToken: options.trustedDeviceToken }
              : {}),
          },
          accessToken || undefined,
        );
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify],
  );

  const unlinkAccount = useCallback(
    async (id: number, stepUpToken?: string) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        const res = await federatedIdentityApi.unlinkMyAccount(accessToken, id, stepUpToken);
        notify(
          'ok',
          `Đã gỡ liên kết ${res.providerCode} (còn ${res.remainingLinkedCount} liên kết ngoài).`,
        );
        await refreshAllFederatedState();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể gỡ liên kết tài khoản ngoài');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAllFederatedState],
  );

  const saveProvider = useCallback(
    async (
      providerCode: string,
      payload: Parameters<typeof federatedIdentityApi.upsertProvider>[2],
    ) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        await federatedIdentityApi.upsertProvider(accessToken, providerCode, payload);
        notify('ok', `Đã lưu cấu hình nhà cung cấp ${providerCode}.`);
        await refreshAllFederatedState();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi lưu cấu hình nhà cung cấp OAuth');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAllFederatedState],
  );

  const testProvider = useCallback(
    async (providerCode: string): Promise<TestFederatedProviderResult | null> => {
      if (!accessToken) return null;
      setBusy(true);
      try {
        const res = await federatedIdentityApi.testProvider(accessToken, providerCode);
        if (res.ok) {
          notify(
            'ok',
            `Kiểm tra ${res.providerCode} thành công: JWKS có ${res.keyCount} khóa (${res.durationMs}ms).`,
          );
        } else {
          notify(
            'err',
            `Kiểm tra ${res.providerCode} chưa đạt (${res.errorCode ?? 'ERROR'}): ${res.errorMessage ?? 'Thiếu cấu hình hoặc không kết nối được JWKS'}`,
          );
        }
        return res;
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi kiểm tra kết nối nhà cung cấp');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify],
  );

  const discoverProvider = useCallback(
    async (providerCode: string): Promise<OidcDiscoveryTestResult | null> => {
      if (!accessToken) return null;
      setBusy(true);
      try {
        const res = await federatedIdentityApi.discoverProvider(accessToken, providerCode);
        if (res.ok) {
          notify('ok', `Discovery ${res.providerCode} OK: ${res.jwksUri} (${res.durationMs}ms).`);
        } else {
          notify(
            'err',
            `Discovery ${res.providerCode} lỗi (${res.errorCode ?? 'ERROR'}): ${res.errorMessage ?? 'Không tải được cấu hình OIDC'}`,
          );
        }
        return res;
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi kiểm tra OIDC Discovery');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify],
  );

  const deleteProvider = useCallback(
    async (providerCode: string) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        await federatedIdentityApi.deleteProvider(accessToken, providerCode);
        notify('ok', `Đã xóa nhà cung cấp ${providerCode}.`);
        await refreshAllFederatedState();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi xóa nhà cung cấp');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAllFederatedState],
  );

  const loadMonitoringEvents = useCallback(
    async (filters?: { providerCode?: string; outcome?: string; flowType?: string }) => {
      if (!accessToken) return;
      try {
        const res = await federatedIdentityApi.listMonitoringEvents(accessToken, {
          page: 1,
          limit: 20,
          ...filters,
        });
        setMonitoringEvents(Array.isArray(res?.data) ? res.data : []);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi tải nhật ký SSO');
      }
    },
    [accessToken, notify],
  );

  const saveGlobalPolicy = useCallback(
    async (items: readonly { key: string; value: unknown }[]) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        await federatedIdentityApi.updateGlobalPolicy(accessToken, items);
        notify('ok', 'Đã cập nhật chính sách OAuth toàn hệ thống.');
        await refreshAllFederatedState();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi lưu chính sách OAuth');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAllFederatedState],
  );

  return {
    busy,
    publicProviders,
    myAccounts,
    drivers,
    adminProviders,
    policy,
    monitoringSummary,
    monitoringEvents,
    refreshAllFederatedState,
    startOAuthLogin,
    startOAuthLink,
    consumePendingOAuthCallback,
    unlinkAccount,
    saveProvider,
    testProvider,
    discoverProvider,
    deleteProvider,
    loadMonitoringEvents,
    saveGlobalPolicy,
  };
}
