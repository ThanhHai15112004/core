import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  KeyRound,
  Link2,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { authStyles } from './auth-ui.styles';
import type {
  FederatedAuthEventItem,
  FederatedDriverMetadata,
  FederatedIdentityItem,
  FederatedMonitoringSummaryData,
  FederatedPolicyData,
  FederatedProviderItem,
  PublicFederatedProvider,
} from '../types/federated-identity.types';

interface FederatedIdentityPanelProps {
  accessToken: string;
  busy: boolean;
  publicProviders: PublicFederatedProvider[];
  myAccounts: FederatedIdentityItem[];
  drivers: FederatedDriverMetadata[];
  adminProviders: FederatedProviderItem[];
  policy: FederatedPolicyData | null;
  monitoringSummary: FederatedMonitoringSummaryData | null;
  monitoringEvents: FederatedAuthEventItem[];
  onRefresh: () => Promise<void>;
  onStartLink: (providerCode: string) => Promise<void>;
  onUnlink: (id: number, stepUpToken?: string) => Promise<void>;
  onSaveProvider: (
    providerCode: string,
    payload: {
      driverCode?: string;
      displayName?: string;
      isEnabled?: boolean;
      clientId?: string | null;
      clientSecret?: string | null;
      tenantId?: string | null;
      allowedRedirectUris?: string[];
      allowAutoRegisterOverride?: boolean | null;
      autoLinkVerifiedEmailOverride?: boolean | null;
    },
  ) => Promise<void>;
  onTestProvider: (providerCode: string) => Promise<unknown>;
  onSaveGlobalPolicy: (items: readonly { key: string; value: unknown }[]) => Promise<void>;
}

type OverrideChoice = 'inherit' | 'true' | 'false';

function toOverrideChoice(val: boolean | null | undefined): OverrideChoice {
  if (val === true) return 'true';
  if (val === false) return 'false';
  return 'inherit';
}

function fromOverrideChoice(choice: OverrideChoice): boolean | null {
  if (choice === 'true') return true;
  if (choice === 'false') return false;
  return null;
}

export const FederatedIdentityPanel: React.FC<FederatedIdentityPanelProps> = ({
  accessToken,
  busy,
  publicProviders,
  myAccounts,
  drivers,
  adminProviders,
  policy,
  monitoringSummary,
  monitoringEvents,
  onRefresh,
  onStartLink,
  onUnlink,
  onSaveProvider,
  onTestProvider,
  onSaveGlobalPolicy,
}) => {
  const [stepUpToken, setStepUpToken] = useState('');

  // Global policy state
  const [autoLinkVerifiedEmail, setAutoLinkVerifiedEmail] = useState(false);
  const [allowAutoRegister, setAllowAutoRegister] = useState(true);
  const [requireVerifiedEmailForRegister, setRequireVerifiedEmailForRegister] = useState(true);
  const [requireStepUpForUnlink, setRequireStepUpForUnlink] = useState(false);
  const [transactionTtlSeconds, setTransactionTtlSeconds] = useState(600);
  const [globalRedirectUrisText, setGlobalRedirectUrisText] = useState('');

  // Provider editor state
  const [selectedCode, setSelectedCode] = useState<string>('google');
  const [driverCode, setDriverCode] = useState<string>('google');
  const [displayName, setDisplayName] = useState<string>('Google');
  const [isEnabled, setIsEnabled] = useState<boolean>(false);
  const [clientId, setClientId] = useState<string>('');
  const [clientSecret, setClientSecret] = useState<string>('');
  const [tenantId, setTenantId] = useState<string>('common');
  const [providerRedirectUrisText, setProviderRedirectUrisText] = useState<string>('');
  const [autoRegisterOverride, setAutoRegisterOverride] = useState<OverrideChoice>('inherit');
  const [autoLinkOverride, setAutoLinkOverride] = useState<OverrideChoice>('inherit');

  useEffect(() => {
    if (!policy) return;
    const cfg = policy.runtimeConfig;
    setAutoLinkVerifiedEmail(cfg.autoLinkVerifiedEmail);
    setAllowAutoRegister(cfg.allowAutoRegister);
    setRequireVerifiedEmailForRegister(cfg.requireVerifiedEmailForRegister);
    setRequireStepUpForUnlink(cfg.requireStepUpForUnlink);
    setTransactionTtlSeconds(cfg.transactionTtlSeconds);
    setGlobalRedirectUrisText(cfg.allowedRedirectUris.join('\n'));
  }, [policy]);

  useEffect(() => {
    const existing = adminProviders.find((p) => p.providerCode === selectedCode);
    const meta = drivers.find((d) => d.driverCode === (existing?.driverCode ?? selectedCode));
    if (existing) {
      setDriverCode(existing.driverCode);
      setDisplayName(existing.displayName);
      setIsEnabled(existing.isEnabled);
      setClientId(existing.clientId ?? '');
      setClientSecret('');
      setTenantId(existing.tenantId ?? meta?.defaultTenantId ?? '');
      setProviderRedirectUrisText(existing.allowedRedirectUris.join('\n'));
      setAutoRegisterOverride(toOverrideChoice(existing.allowAutoRegisterOverride));
      setAutoLinkOverride(toOverrideChoice(existing.autoLinkVerifiedEmailOverride));
    } else {
      const nextDriver = selectedCode === 'microsoft' ? 'microsoft' : 'google';
      const fallbackMeta = drivers.find((d) => d.driverCode === nextDriver);
      setDriverCode(nextDriver);
      setDisplayName(fallbackMeta?.displayName ?? (nextDriver === 'microsoft' ? 'Microsoft' : 'Google'));
      setIsEnabled(false);
      setClientId('');
      setClientSecret('');
      setTenantId(fallbackMeta?.defaultTenantId ?? '');
      setProviderRedirectUrisText('');
      setAutoRegisterOverride('inherit');
      setAutoLinkOverride('inherit');
    }
  }, [selectedCode, adminProviders, drivers]);

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    const uris = globalRedirectUrisText
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    await onSaveGlobalPolicy([
      { key: policy.settingKeys.autoLinkVerifiedEmail, value: autoLinkVerifiedEmail },
      { key: policy.settingKeys.allowAutoRegister, value: allowAutoRegister },
      {
        key: policy.settingKeys.requireVerifiedEmailForRegister,
        value: requireVerifiedEmailForRegister,
      },
      { key: policy.settingKeys.requireStepUpForUnlink, value: requireStepUpForUnlink },
      {
        key: policy.settingKeys.transactionTtlSeconds,
        value: Math.max(60, Math.min(1800, Number(transactionTtlSeconds) || 600)),
      },
      { key: policy.settingKeys.allowedRedirectUris, value: uris },
    ]);
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    const redirectUris = providerRedirectUrisText
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    await onSaveProvider(selectedCode, {
      driverCode,
      displayName: displayName.trim() || selectedCode,
      isEnabled,
      clientId: clientId.trim() || null,
      ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
      ...(driverCode === 'microsoft' ? { tenantId: tenantId.trim() || 'common' } : { tenantId: null }),
      allowedRedirectUris: redirectUris,
      allowAutoRegisterOverride: fromOverrideChoice(autoRegisterOverride),
      autoLinkVerifiedEmailOverride: fromOverrideChoice(autoLinkOverride),
    });
    setClientSecret('');
  };

  const activeProviderRecord = adminProviders.find((p) => p.providerCode === selectedCode);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Tài khoản ngoài đã liên kết của người dùng */}
      <section style={authStyles.cardHighlighted}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={authStyles.sectionTitle}>
              <Link2 size={18} color="var(--primary)" />
              <span>Tài Khoản Ngoài Đã Liên Kết (/federated-identity/accounts/me)</span>
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Lưu mã định danh ổn định <code>(provider, issuer, sub)</code>, ngăn tạo user trùng và
              chặn gỡ phương thức đăng nhập cuối cùng khi chưa có mật khẩu.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={busy}
            style={authStyles.btnSecondary}
          >
            <RefreshCw size={14} />
            <span>Làm mới</span>
          </button>
        </div>

        {!accessToken ? (
          <div style={authStyles.badgeWarning}>
            Vui lòng đăng nhập tại tab Cổng Xác Thực để xem hoặc liên kết tài khoản ngoài.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {publicProviders.length === 0 ? (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Chưa có nhà cung cấp OAuth nào đang bật. Quản trị viên có thể bật Google/Microsoft ở
                  khung cấu hình bên dưới.
                </span>
              ) : (
                publicProviders.map((prov) => (
                  <button
                    key={prov.providerCode}
                    type="button"
                    disabled={busy}
                    onClick={() => void onStartLink(prov.providerCode)}
                    style={authStyles.btnPrimary}
                  >
                    <Link2 size={14} />
                    <span>Liên kết với {prov.displayName}</span>
                  </button>
                ))
              )}
            </div>

            {policy?.runtimeConfig.requireStepUpForUnlink && (
              <div style={{ maxWidth: '420px', marginBottom: '12px' }}>
                <label style={authStyles.label}>Step-Up Token (bắt buộc khi gỡ liên kết)</label>
                <input
                  type="text"
                  value={stepUpToken}
                  onChange={(e) => setStepUpToken(e.target.value)}
                  placeholder="Dán stepUpToken từ tab MFA & Step-Up..."
                  style={authStyles.monoInput}
                />
              </div>
            )}

            {myAccounts.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Tài khoản hiện tại chưa liên kết với Google hoặc Microsoft.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={authStyles.tableHeaderCell}>Provider</th>
                      <th style={authStyles.tableHeaderCell}>Email tại IdP</th>
                      <th style={authStyles.tableHeaderCell}>Định danh ổn định (sub)</th>
                      <th style={authStyles.tableHeaderCell}>Liên kết lúc</th>
                      <th style={authStyles.tableHeaderCell}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myAccounts.map((acc) => (
                      <tr key={acc.id}>
                        <td style={authStyles.tableCell}>
                          <span style={authStyles.badgePrimary}>{acc.providerCode}</span>
                        </td>
                        <td style={authStyles.tableCell}>
                          <div>{acc.emailAtProvider ?? '—'}</div>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                            {acc.emailVerified ? 'Đã xác minh tại IdP' : 'Chưa xác minh'}
                          </div>
                        </td>
                        <td style={authStyles.tableCell}>
                          <code style={{ fontSize: '12px' }}>{acc.providerSubject}</code>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {acc.issuerUrl}
                          </div>
                        </td>
                        <td style={authStyles.tableCell}>
                          {new Date(acc.linkedAt).toLocaleString()}
                        </td>
                        <td style={authStyles.tableCell}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onUnlink(acc.id, stepUpToken.trim() || undefined)}
                            style={authStyles.btnDanger}
                          >
                            <Trash2 size={13} />
                            <span>Gỡ liên kết</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* 2. Quản trị Chính sách toàn hệ thống & Cấu hình Adapter */}
      {accessToken && (policy || adminProviders.length > 0 || drivers.length > 0) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
            gap: '20px',
          }}
        >
          {/* Chính sách Global */}
          <form onSubmit={handleSavePolicy} style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <Settings2 size={18} color="var(--secondary)" />
              <span>Chính Sách OAuth Toàn Hệ Thống (System Settings)</span>
            </h3>
            <p style={authStyles.sectionDesc}>
              Đồng bộ trực tiếp với bảng <code>system_settings</code> (có hiệu lực tức thì và giữ nguyên
              khi khởi động lại).
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={autoLinkVerifiedEmail}
                  onChange={(e) => setAutoLinkVerifiedEmail(e.target.checked)}
                />
                <span>
                  Tự động liên kết khi email đã xác minh trùng user sẵn có (
                  <code>auto_link_verified_email</code>)
                </span>
              </label>

              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={allowAutoRegister}
                  onChange={(e) => setAllowAutoRegister(e.target.checked)}
                />
                <span>
                  Cho phép tự tạo user mới khi đăng nhập OAuth lần đầu (
                  <code>allow_auto_register</code>)
                </span>
              </label>

              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={requireVerifiedEmailForRegister}
                  onChange={(e) => setRequireVerifiedEmailForRegister(e.target.checked)}
                />
                <span>Bắt buộc IdP xác nhận email_verified=true khi tự đăng ký</span>
              </label>

              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={requireStepUpForUnlink}
                  onChange={(e) => setRequireStepUpForUnlink(e.target.checked)}
                />
                <span>Yêu cầu Step-Up Authentication khi người dùng tự gỡ liên kết</span>
              </label>

              <div>
                <label style={authStyles.label}>Thời hạn State/Nonce/PKCE (giây)</label>
                <input
                  type="number"
                  min={60}
                  max={1800}
                  value={transactionTtlSeconds}
                  onChange={(e) => setTransactionTtlSeconds(Number(e.target.value))}
                  style={authStyles.input}
                />
              </div>

              <div>
                <label style={authStyles.label}>Allowlist Redirect URI mặc định (mỗi dòng 1 URI)</label>
                <textarea
                  rows={3}
                  value={globalRedirectUrisText}
                  onChange={(e) => setGlobalRedirectUrisText(e.target.value)}
                  style={authStyles.monoInput}
                />
              </div>

              <div>
                <button type="submit" disabled={busy || !policy} style={authStyles.btnTeal}>
                  <CheckCircle2 size={14} />
                  <span>Lưu chính sách hệ thống</span>
                </button>
              </div>
            </div>
          </form>

          {/* Cấu hình Provider Google / Microsoft */}
          <form onSubmit={handleSaveProvider} style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <KeyRound size={18} color="var(--primary)" />
              <span>Cấu Hình Nhà Cung Cấp (Google / Microsoft)</span>
            </h3>
            <p style={authStyles.sectionDesc}>
              Client Secret được mã hóa AES-256-GCM khi lưu DB; mỗi provider có thể override chính
              sách tự đăng ký / tự liên kết riêng.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
              {['google', 'microsoft'].map((code) => {
                const active = selectedCode === code;
                const rec = adminProviders.find((p) => p.providerCode === code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setSelectedCode(code)}
                    style={active ? authStyles.btnPrimary : authStyles.btnSecondary}
                  >
                    <span>{code === 'google' ? 'Google' : 'Microsoft'}</span>
                    {rec?.isEnabled && <span style={authStyles.badgeSuccess}>ON</span>}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={authStyles.label}>Tên hiển thị</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    style={authStyles.input}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => setIsEnabled(e.target.checked)}
                    />
                    <span>Bật nhà cung cấp này</span>
                  </label>
                </div>
              </div>

              <div>
                <label style={authStyles.label}>Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Nhập OAuth Client ID..."
                  style={authStyles.monoInput}
                />
              </div>

              <div>
                <label style={authStyles.label}>
                  Client Secret{' '}
                  {activeProviderRecord?.hasClientSecret
                    ? `(đã lưu: ${activeProviderRecord.clientSecretHint ?? '****'} — để trống nếu giữ nguyên)`
                    : '(bắt buộc khi bật)'}
                </label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Nhập Client Secret mới..."
                  style={authStyles.monoInput}
                />
              </div>

              {driverCode === 'microsoft' && (
                <div>
                  <label style={authStyles.label}>
                    Microsoft Tenant ID (<code>common</code>, <code>organizations</code>,{' '}
                    <code>consumers</code> hoặc GUID tenant)
                  </label>
                  <input
                    type="text"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    style={authStyles.monoInput}
                  />
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={authStyles.label}>Override Tự động liên kết email</label>
                  <select
                    value={autoLinkOverride}
                    onChange={(e) => setAutoLinkOverride(e.target.value as OverrideChoice)}
                    style={authStyles.input}
                  >
                    <option value="inherit">Kế thừa hệ thống</option>
                    <option value="true">Bắt buộc BẬT</option>
                    <option value="false">Bắt buộc TẮT</option>
                  </select>
                </div>
                <div>
                  <label style={authStyles.label}>Override Tự đăng ký mới</label>
                  <select
                    value={autoRegisterOverride}
                    onChange={(e) => setAutoRegisterOverride(e.target.value as OverrideChoice)}
                    style={authStyles.input}
                  >
                    <option value="inherit">Kế thừa hệ thống</option>
                    <option value="true">Bắt buộc BẬT</option>
                    <option value="false">Bắt buộc TẮT</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={authStyles.label}>
                  Allowlist Redirect URI riêng (để trống để kế thừa toàn hệ thống)
                </label>
                <textarea
                  rows={2}
                  value={providerRedirectUrisText}
                  onChange={(e) => setProviderRedirectUrisText(e.target.value)}
                  placeholder="http://localhost:5173/auth"
                  style={authStyles.monoInput}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="submit" disabled={busy} style={authStyles.btnPrimary}>
                  <CheckCircle2 size={14} />
                  <span>Lưu cấu hình {selectedCode}</span>
                </button>
                <button
                  type="button"
                  disabled={busy || !activeProviderRecord}
                  onClick={() => void onTestProvider(selectedCode)}
                  style={authStyles.btnSecondary}
                >
                  <Activity size={14} />
                  <span>Kiểm tra JWKS</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* 3. Monitoring lỗi từ nhà cung cấp */}
      {accessToken && monitoringSummary && (
        <section style={authStyles.card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '14px',
            }}
          >
            <div>
              <h3 style={authStyles.sectionTitle}>
                <ShieldAlert size={18} color="var(--accent)" />
                <span>Theo Dõi Lỗi Đăng Nhập Từ Nhà Cung Cấp (24h qua)</span>
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                Số liệu thực từ <code>federated_auth_events</code> và Prometheus metrics (đã che bí
                mật).
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={authStyles.badgePrimary}>
                Tổng lượt: {monitoringSummary.totalAttempts}
              </span>
              <span style={authStyles.badgeSuccess}>
                Thành công: {monitoringSummary.successCount}
              </span>
              <span
                style={
                  monitoringSummary.failureCount > 0
                    ? authStyles.badgeDanger
                    : authStyles.badgeSuccess
                }
              >
                Lỗi: {monitoringSummary.failureCount} ({monitoringSummary.errorRatePercent}%)
              </span>
              <span style={authStyles.badgePrimary}>
                Độ trễ TB: {monitoringSummary.avgDurationMs}ms
              </span>
            </div>
          </div>

          {monitoringEvents.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Chưa có sự kiện OAuth nào được ghi nhận trong nhật ký.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>Thời gian</th>
                    <th style={authStyles.tableHeaderCell}>Provider</th>
                    <th style={authStyles.tableHeaderCell}>Luồng / Giai đoạn</th>
                    <th style={authStyles.tableHeaderCell}>Kết quả</th>
                    <th style={authStyles.tableHeaderCell}>Mã lỗi / Chi tiết</th>
                    <th style={authStyles.tableHeaderCell}>HTTP / Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {monitoringEvents.map((ev) => (
                    <tr key={ev.id}>
                      <td style={authStyles.tableCell}>
                        {new Date(ev.occurredAt).toLocaleString()}
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgePrimary}>{ev.providerCode}</span>
                      </td>
                      <td style={authStyles.tableCell}>
                        <div>{ev.flowType}</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {ev.stage}
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span
                          style={
                            ev.outcome === 'SUCCESS'
                              ? authStyles.badgeSuccess
                              : authStyles.badgeDanger
                          }
                        >
                          {ev.outcome}
                        </span>
                      </td>
                      <td style={authStyles.tableCell}>
                        <code style={{ fontSize: '12px' }}>
                          {ev.errorCode ?? '—'}
                          {ev.providerError ? ` (${ev.providerError})` : ''}
                        </code>
                        {ev.errorMessage && (
                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                            {ev.errorMessage}
                          </div>
                        )}
                      </td>
                      <td style={authStyles.tableCell}>
                        {ev.httpStatus ?? '—'} / {ev.durationMs}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
