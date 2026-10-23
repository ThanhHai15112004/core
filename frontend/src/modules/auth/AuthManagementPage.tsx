import React from 'react';
import {
  ShieldCheck,
  KeyRound,
  Smartphone,
  Laptop,
  Lock,
  Bot,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { AUTH_MODULE_TABS, type AuthSubTabId } from './enum/auth.enum';
import { useAuthManagement } from './hooks/useAuthManagement';
import { AuthGatewayPanel } from './components/AuthGatewayPanel';
import { MfaAndDevicesPanel } from './components/MfaAndDevicesPanel';
import { SessionsAndHistoryPanel } from './components/SessionsAndHistoryPanel';
import { PasswordAndPolicyPanel } from './components/PasswordAndPolicyPanel';
import { ServiceAccountsPanel } from './components/ServiceAccountsPanel';
import { authStyles } from './components/auth-ui.styles';

export const AuthManagementPage: React.FC = () => {
  const {
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
    mfaStatus,
    trustedDevices,
    sessions,
    loginHistory,
    securitySettings,
    setSecuritySettings,
    serviceAccounts,
    apiClients,
    refreshProfileAndCoreState,
    handleLogout,
    handleRotateRefreshToken,
  } = useAuthManagement();

  const resolveTabIcon = (id: AuthSubTabId) => {
    switch (id) {
      case 'gateway':
        return <KeyRound size={15} />;
      case 'mfa-devices':
        return <Smartphone size={15} />;
      case 'sessions-history':
        return <Laptop size={15} />;
      case 'password-policy':
        return <Lock size={15} />;
      case 'service-accounts':
        return <Bot size={15} />;
    }
  };

  return (
    <main
      style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '28px 24px 64px',
        width: '100%',
      }}
      className="animate-fade-in"
    >
      {/* Module Header Banner */}
      <section
        style={{
          ...authStyles.cardHighlighted,
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px var(--primary-glow)',
            }}
          >
            <ShieldCheck size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1
                style={{
                  fontSize: '21px',
                  fontWeight: 800,
                  color: 'var(--text-main)',
                  margin: 0,
                  letterSpacing: '-0.3px',
                }}
              >
                Module Xác Thực, Phiên, MFA & Service Accounts (`modules/auth`)
              </h1>
              <span style={authStyles.badgePrimary}>Mục 3.2 — 3.6</span>
            </div>
            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Kiến trúc Modular độc lập: Đăng ký/Đăng nhập đa định danh, JWT Rotation, TOTP/Email/SMS
              MFA, Thiết bị tin cậy, Step-Up Auth và API Clients M2M.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {currentUser ? (
            <span style={authStyles.badgeSuccess}>
              <CheckCircle2 size={13} /> Đã xác thực: {currentUser.email}
            </span>
          ) : (
            <span style={authStyles.badgeWarning}>Chưa đăng nhập</span>
          )}
          <button
            type="button"
            onClick={() => void refreshProfileAndCoreState()}
            disabled={loading}
            style={authStyles.btnSecondary}
          >
            <RefreshCw size={14} />
            <span>{loading ? 'Đang đồng bộ...' : 'Đồng bộ dữ liệu'}</span>
          </button>
        </div>
      </section>

      {/* Thông báo trạng thái thao tác */}
      {statusBanner && (
        <div
          style={{
            marginBottom: '18px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            background:
              statusBanner.type === 'ok'
                ? 'var(--status-success-bg)'
                : 'var(--status-danger-bg)',
            border: `1px solid ${
              statusBanner.type === 'ok' ? 'var(--status-success)' : 'var(--status-danger)'
            }`,
            color:
              statusBanner.type === 'ok' ? 'var(--status-success)' : 'var(--status-danger)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '13.5px',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {statusBanner.type === 'ok' ? (
              <CheckCircle2 size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            <span>{statusBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Thanh điều hướng 5 Sub-Tabs của Module Auth */}
      <nav
        style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '20px',
          padding: '6px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {AUTH_MODULE_TABS.map((tab) => {
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              style={{
                padding: '9px 15px',
                borderRadius: 'var(--radius-sm)',
                border: isActive
                  ? '1px solid var(--primary)'
                  : '1px solid transparent',
                background: isActive ? 'var(--primary)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'var(--transition-fast)',
              }}
            >
              {resolveTabIcon(tab.id)}
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  style={{
                    fontSize: '10.5px',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--bg-light-blue)',
                    color: isActive ? '#ffffff' : 'var(--primary)',
                    fontWeight: 700,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Nội dung từng Sub-Tab */}
      {subTab === 'gateway' && (
        <AuthGatewayPanel
          accessToken={accessToken}
          refreshToken={refreshToken}
          currentUser={currentUser}
          onAuthenticated={async (newAccess, newRefresh) => {
            setAccessToken(newAccess);
            if (newRefresh) setRefreshToken(newRefresh);
            await refreshProfileAndCoreState(newAccess);
          }}
          onLogout={handleLogout}
          onRotateRefresh={handleRotateRefreshToken}
          notify={notify}
        />
      )}

      {subTab === 'mfa-devices' && (
        <MfaAndDevicesPanel
          accessToken={accessToken}
          mfaStatus={mfaStatus}
          trustedDevices={trustedDevices}
          onRefresh={() => refreshProfileAndCoreState()}
          notify={notify}
        />
      )}

      {subTab === 'sessions-history' && (
        <SessionsAndHistoryPanel
          accessToken={accessToken}
          sessions={sessions}
          loginHistory={loginHistory}
          onRefresh={() => refreshProfileAndCoreState()}
          notify={notify}
        />
      )}

      {subTab === 'password-policy' && (
        <PasswordAndPolicyPanel
          accessToken={accessToken}
          securitySettings={securitySettings}
          onUpdateSettingsState={setSecuritySettings}
          onRefresh={() => refreshProfileAndCoreState()}
          notify={notify}
        />
      )}

      {subTab === 'service-accounts' && (
        <ServiceAccountsPanel
          accessToken={accessToken}
          serviceAccounts={serviceAccounts}
          apiClients={apiClients}
          onRefresh={() => refreshProfileAndCoreState()}
          notify={notify}
        />
      )}
    </main>
  );
};

