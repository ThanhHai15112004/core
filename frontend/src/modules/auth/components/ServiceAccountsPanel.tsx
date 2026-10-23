import React, { useState } from 'react';
import {
  Bot,
  Webhook,
  KeyRound,
  RotateCcw,
  Ban,
  Activity,
  Copy,
  ShieldCheck,
  Globe,
} from 'lucide-react';
import { authApi } from '../services/auth.api';
import { authStyles } from './auth-ui.styles';
import type {
  ApiClientItem,
  ApiClientUsageLogResponseData,
  ServiceAccountItem,
} from '../types/auth.types';

interface ServiceAccountsPanelProps {
  accessToken: string;
  serviceAccounts: ServiceAccountItem[];
  apiClients: ApiClientItem[];
  onRefresh: () => Promise<void>;
  notify: (type: 'ok' | 'err', text: string) => void;
}

export const ServiceAccountsPanel: React.FC<ServiceAccountsPanelProps> = ({
  accessToken,
  serviceAccounts,
  apiClients,
  onRefresh,
  notify,
}) => {
  // Create Service Account form
  const [saCode, setSaCode] = useState('SA_ERP_SYNC_WORKER');
  const [saName, setSaName] = useState('ERP Synchronization Worker');
  const [saDesc, setSaDesc] = useState('Tài khoản hệ thống đồng bộ dữ liệu tự động');
  const [saScopes, setSaScopes] = useState('users.read,files.read,organizations.read');

  // Create API Client form
  const [selectedSaId, setSelectedSaId] = useState<string>('');
  const [clientName, setClientName] = useState('ERP Webhook Integration Client');
  const [clientScopes, setClientScopes] = useState('users.read,files.read');
  const [clientAllowedIps, setClientAllowedIps] = useState('127.0.0.1,10.0.0.0/8');

  // Issued secret banner (one-time view)
  const [oneTimeSecretInfo, setOneTimeSecretInfo] = useState<{
    clientId: string;
    clientSecret: string;
    warning: string;
  } | null>(null);

  // Test M2M Token issuance
  const [testClientId, setTestClientId] = useState('');
  const [testClientSecret, setTestClientSecret] = useState('');
  const [issuedM2mToken, setIssuedM2mToken] = useState<string | null>(null);

  // Usage logs modal/panel
  const [usageData, setUsageData] = useState<ApiClientUsageLogResponseData | null>(null);

  const handleCreateServiceAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    try {
      const scopes = saScopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const created = await authApi.createServiceAccount(accessToken, {
        code: saCode.trim().toUpperCase(),
        name: saName.trim(),
        description: saDesc.trim(),
        scopes,
        status: 'ACTIVE',
      });
      setSelectedSaId(String(created.id));
      notify('ok', `Đã tạo Service Account ${created.code} (#${created.id}).`);
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi tạo Service Account');
    }
  };

  const handleCreateApiClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    const targetSaId = Number(selectedSaId || serviceAccounts[0]?.id || 0);
    if (!targetSaId) {
      notify('err', 'Vui lòng tạo hoặc chọn một Service Account trước.');
      return;
    }
    try {
      const scopes = clientScopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const allowedIps = clientAllowedIps
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const created = await authApi.createApiClient(accessToken, {
        serviceAccountId: targetSaId,
        name: clientName.trim(),
        scopes,
        allowedIps,
      });
      setOneTimeSecretInfo({
        clientId: created.clientId,
        clientSecret: created.clientSecret,
        warning: created.secretShownOnceWarning,
      });
      setTestClientId(created.clientId);
      setTestClientSecret(created.clientSecret);
      notify('ok', `Đã tạo API Client ${created.clientId}! Hãy sao chép Client Secret ngay.`);
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi tạo API Client');
    }
  };

  const handleIssueM2mToken = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await authApi.issueApiClientToken({
        clientId: testClientId.trim(),
        clientSecret: testClientSecret.trim(),
      });
      setIssuedM2mToken(res.accessToken);
      notify(
        'ok',
        `Đã cấp M2M Bearer Token cho ${res.serviceAccountCode} (TTL: ${res.expiresInSeconds}s).`,
      );
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Cấp M2M Token thất bại');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Cấp mới / Xoay vòng Client Secret (Hiển thị 1 lần duy nhất) */}
      {oneTimeSecretInfo && (
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--status-warning-bg)',
            border: '1px solid var(--accent)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ color: 'var(--text-main)', fontSize: '14px' }}>
              ⚠️ Khóa Bí Mật API Client (Chỉ hiển thị duy nhất 1 lần):
            </strong>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  `CLIENT_ID=${oneTimeSecretInfo.clientId}\nCLIENT_SECRET=${oneTimeSecretInfo.clientSecret}`,
                );
                notify('ok', 'Đã sao chép Client ID & Client Secret!');
              }}
              style={authStyles.btnAccent}
            >
              <Copy size={13} /> Sao chép thông tin khóa
            </button>
          </div>
          <div style={authStyles.codeBox}>
            <div>
              <strong>Client ID:</strong> {oneTimeSecretInfo.clientId}
            </div>
            <div>
              <strong>Client Secret:</strong> {oneTimeSecretInfo.clientSecret}
            </div>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {oneTimeSecretInfo.warning}
          </span>
        </div>
      )}

      {/* Hàng 1: Tạo Service Account, Tạo API Client & Phát hành thử M2M Token */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '20px',
        }}
      >
        {/* 1. Tạo Service Account */}
        <div style={authStyles.cardHighlighted}>
          <h3 style={authStyles.sectionTitle}>
            <Bot size={18} color="var(--primary)" />
            <span>1. Tạo Service Account (Mục 3.6.1)</span>
          </h3>
          <p style={authStyles.sectionDesc}>
            Tài khoản hệ thống dành cho job/worker/tích hợp liên dịch vụ (`userId = null`).
          </p>

          <form
            onSubmit={handleCreateServiceAccount}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <div>
              <label style={authStyles.label}>Mã định danh (Code — IN HOA)</label>
              <input
                type="text"
                value={saCode}
                onChange={(e) => setSaCode(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Tên hiển thị Service Account</label>
              <input
                type="text"
                value={saName}
                onChange={(e) => setSaName(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Mô tả mục đích sử dụng</label>
              <input
                type="text"
                value={saDesc}
                onChange={(e) => setSaDesc(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Phạm vi quyền tối đa (Scopes — phân tách dấu phẩy)</label>
              <input
                type="text"
                value={saScopes}
                onChange={(e) => setSaScopes(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <button type="submit" style={authStyles.btnPrimary}>
                <Bot size={15} />
                <span>Tạo Service Account</span>
              </button>
            </div>
          </form>
        </div>

        {/* 2. Tạo API Client */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <Webhook size={18} color="var(--secondary)" />
            <span>2. Tạo API Client & Giới Hạn IP/CIDR (Mục 3.6.2 - 3.6.6)</span>
          </h3>
          <p style={authStyles.sectionDesc}>
            Cấp Client ID & Client Secret gắn với phạm vi quyền (`scopes`) và danh sách IP/CIDR
            được phép.
          </p>

          <form
            onSubmit={handleCreateApiClient}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <div>
              <label style={authStyles.label}>Thuộc Service Account</label>
              <select
                value={selectedSaId || (serviceAccounts[0]?.id ? String(serviceAccounts[0].id) : '')}
                onChange={(e) => setSelectedSaId(e.target.value)}
                style={authStyles.input}
              >
                {serviceAccounts.length === 0 ? (
                  <option value="">-- Chưa có Service Account --</option>
                ) : (
                  serviceAccounts.map((sa) => (
                    <option key={sa.id} value={sa.id}>
                      #{sa.id} — {sa.code} ({sa.name})
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label style={authStyles.label}>Tên API Client</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={authStyles.label}>Scopes được phép</label>
                <input
                  type="text"
                  value={clientScopes}
                  onChange={(e) => setClientScopes(e.target.value)}
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>Allowed IPs / CIDR / Wildcard</label>
                <input
                  type="text"
                  value={clientAllowedIps}
                  onChange={(e) => setClientAllowedIps(e.target.value)}
                  style={authStyles.monoInput}
                />
              </div>
            </div>
            <div>
              <button type="submit" style={authStyles.btnTeal}>
                <Webhook size={15} />
                <span>Cấp API Client & Sinh Secret</span>
              </button>
            </div>
          </form>
        </div>

        {/* 3. Cấp M2M Token (/auth/api-clients/token) */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <KeyRound size={18} color="var(--accent)" />
            <span>3. Cấp M2M Access Token (/auth/api-clients/token)</span>
          </h3>
          <p style={authStyles.sectionDesc}>
            Kiểm thử luồng xác thực Client Credentials và ghi nhận nhật ký sử dụng theo IP.
          </p>

          <form
            onSubmit={handleIssueM2mToken}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <div>
              <label style={authStyles.label}>Client ID</label>
              <input
                type="text"
                value={testClientId}
                onChange={(e) => setTestClientId(e.target.value)}
                placeholder="cli_..."
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Client Secret</label>
              <input
                type="text"
                value={testClientSecret}
                onChange={(e) => setTestClientSecret(e.target.value)}
                placeholder="sec_..."
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <button type="submit" style={authStyles.btnAccent}>
                <KeyRound size={15} />
                <span>Phát hành M2M Bearer Token</span>
              </button>
            </div>
          </form>

          {issuedM2mToken && (
            <div style={{ ...authStyles.codeBox, marginTop: '10px' }}>
              <strong>M2M Token:</strong> {issuedM2mToken.slice(0, 52)}...
            </div>
          )}
        </div>
      </div>

      {/* Hàng 2: Danh sách API Clients & Thao tác Xoay vòng Secret / Thu hồi / Xem Usage Logs */}
      <div style={authStyles.card}>
        <h3 style={{ ...authStyles.sectionTitle, marginBottom: '12px' }}>
          <ShieldCheck size={18} color="var(--primary)" />
          <span>Danh Sách API Clients Đã Cấp ({apiClients.length})</span>
        </h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>ID / Client ID</th>
                <th style={authStyles.tableHeaderCell}>Tên Client & SA</th>
                <th style={authStyles.tableHeaderCell}>Scopes</th>
                <th style={authStyles.tableHeaderCell}>Allowed IPs</th>
                <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                <th style={authStyles.tableHeaderCell}>Sử dụng gần nhất</th>
                <th style={authStyles.tableHeaderCell}>Thao tác bảo mật</th>
              </tr>
            </thead>
            <tbody>
              {apiClients.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...authStyles.tableCell, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có API Client nào. Hãy tạo Service Account và API Client ở trên.
                  </td>
                </tr>
              ) : (
                apiClients.map((client) => (
                  <tr key={client.id}>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      <strong>#{client.id}</strong> — {client.clientId}
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        Prefix: {client.secretPrefix}*** (v{client.tokenVersion})
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>{client.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        SA #{client.serviceAccountId}{' '}
                        {client.serviceAccountCode ? `(${client.serviceAccountCode})` : ''}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {client.scopes.map((s) => (
                          <span key={s} style={authStyles.badgePrimary}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {client.allowedIps.length > 0 ? (
                        client.allowedIps.join(', ')
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>* (Mọi IP)</span>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      {client.statusName === 'ACTIVE' ? (
                        <span style={authStyles.badgeSuccess}>ACTIVE</span>
                      ) : (
                        <span style={authStyles.badgeDanger}>REVOKED</span>
                      )}
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                      {client.lastUsedAt ? (
                        <>
                          <div>{new Date(client.lastUsedAt).toLocaleString('vi-VN')}</div>
                          <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            IP: {client.lastUsedIp ?? '—'} ({client.lastUsedResult ?? '—'})
                          </div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Chưa sử dụng</span>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const rotated = await authApi.rotateApiClientSecret(
                                accessToken,
                                client.id,
                                'Manual secret rotation via Auth Console',
                              );
                              setOneTimeSecretInfo({
                                clientId: rotated.clientId,
                                clientSecret: rotated.clientSecret,
                                warning: rotated.secretShownOnceWarning,
                              });
                              setTestClientId(rotated.clientId);
                              setTestClientSecret(rotated.clientSecret);
                              notify('ok', `Đã xoay vòng Secret cho ${rotated.clientId} (v${rotated.tokenVersion}).`);
                              await onRefresh();
                            } catch (err) {
                              notify('err', err instanceof Error ? err.message : 'Lỗi xoay vòng Secret');
                            }
                          }}
                          style={authStyles.btnSecondary}
                          title="Xoay vòng Client Secret (Mục 3.6.4)"
                        >
                          <RotateCcw size={13} /> Rotate Secret
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const logs = await authApi.getApiClientUsageLogs(accessToken, client.id);
                              setUsageData(logs);
                            } catch (err) {
                              notify('err', err instanceof Error ? err.message : 'Lỗi tải Usage Logs');
                            }
                          }}
                          style={authStyles.btnSecondary}
                          title="Xem nhật ký sử dụng (Mục 3.6.7)"
                        >
                          <Activity size={13} /> Usage
                        </button>

                        {client.statusName === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await authApi.revokeApiClient(
                                  accessToken,
                                  client.id,
                                  'Revoked by administrator',
                                );
                                notify('ok', `Đã thu hồi API Client ${client.clientId}`);
                                await onRefresh();
                              } catch (err) {
                                notify('err', err instanceof Error ? err.message : 'Lỗi thu hồi API Client');
                              }
                            }}
                            style={authStyles.btnDanger}
                          >
                            <Ban size={13} /> Thu hồi
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Hiển thị Usage Logs của API Client đang chọn (Mục 3.6.7) */}
        {usageData && (
          <div
            style={{
              marginTop: '16px',
              padding: '14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Globe size={15} color="var(--primary)" />
                <span>
                  Nhật Ký Sử Dụng API Client {usageData.clientId} ({usageData.logs.length} bản ghi)
                </span>
              </strong>
              <button
                type="button"
                onClick={() => setUsageData(null)}
                style={authStyles.btnSecondary}
              >
                Đóng
              </button>
            </div>
            {usageData.logs.length === 0 ? (
              <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                Chưa có bản ghi truy cập nào cho API Client này.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {usageData.logs.slice(0, 10).map((log, idx) => (
                  <div
                    key={`${log.timestamp}-${idx}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      padding: '6px 10px',
                      background: 'var(--bg-surface)',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <span>{new Date(log.timestamp).toLocaleString('vi-VN')}</span>
                    <span>Action: {log.action}</span>
                    <span>IP: {log.ipAddress ?? '—'}</span>
                    <span
                      style={
                        log.status === 'SUCCESS'
                          ? authStyles.badgeSuccess
                          : authStyles.badgeDanger
                      }
                    >
                      {log.result}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
