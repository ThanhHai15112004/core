import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Compass, KeyRound, Plus, Trash2 } from 'lucide-react';
import { authStyles } from './auth-ui.styles';
import type {
  FederatedDriverMetadata,
  FederatedProviderItem,
  FederatedRoleSyncMode,
} from '../types/federated-identity.types';
import type { federatedIdentityApi } from '../services/federated-identity.api';

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

function parseCsvList(raw: string): string[] {
  return raw
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatGroupRoleMappings(mappings: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(mappings)
    .map(([group, roles]) => `${group}=${roles.join(',')}`)
    .join('\n');
}

function parseGroupRoleMappingsText(raw: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || !clean.includes('=')) continue;
    const eqIndex = clean.indexOf('=');
    const groupName = clean.slice(0, eqIndex).trim();
    const rolesPart = clean.slice(eqIndex + 1).trim();
    if (!groupName || !rolesPart) continue;
    const roles = rolesPart
      .split(',')
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    if (roles.length > 0) {
      out[groupName] = roles;
    }
  }
  return out;
}

export type SaveProviderPayload = Parameters<typeof federatedIdentityApi.upsertProvider>[2];

interface FederatedProviderEditorProps {
  busy: boolean;
  drivers: FederatedDriverMetadata[];
  adminProviders: FederatedProviderItem[];
  onSaveProvider: (providerCode: string, payload: SaveProviderPayload) => Promise<void>;
  onTestProvider: (providerCode: string) => Promise<unknown>;
  onDiscoverProvider: (providerCode: string) => Promise<unknown>;
  onDeleteProvider: (providerCode: string) => Promise<void>;
}

export const FederatedProviderEditor: React.FC<FederatedProviderEditorProps> = ({
  busy,
  drivers,
  adminProviders,
  onSaveProvider,
  onTestProvider,
  onDiscoverProvider,
  onDeleteProvider,
}) => {
  const [selectedCode, setSelectedCode] = useState<string>('google');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProviderCode, setNewProviderCode] = useState('');
  const [newDriverCode, setNewDriverCode] = useState('oidc');

  const [driverCode, setDriverCode] = useState<string>('google');
  const [displayName, setDisplayName] = useState<string>('Google');
  const [isEnabled, setIsEnabled] = useState<boolean>(false);
  const [clientId, setClientId] = useState<string>('');
  const [clientSecret, setClientSecret] = useState<string>('');
  const [tenantId, setTenantId] = useState<string>('common');
  const [issuerUrl, setIssuerUrl] = useState<string>('');
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState<string>('');
  const [tokenEndpoint, setTokenEndpoint] = useState<string>('');
  const [jwksUri, setJwksUri] = useState<string>('');
  const [userinfoEndpoint, setUserinfoEndpoint] = useState<string>('');
  const [scopesText, setScopesText] = useState<string>('');
  const [providerRedirectUrisText, setProviderRedirectUrisText] = useState<string>('');
  const [autoRegisterOverride, setAutoRegisterOverride] = useState<OverrideChoice>('inherit');
  const [autoLinkOverride, setAutoLinkOverride] = useState<OverrideChoice>('inherit');

  // Enterprise OIDC & Mapping state
  const [discoveryEnabled, setDiscoveryEnabled] = useState<boolean>(true);
  const [fetchUserInfo, setFetchUserInfo] = useState<boolean>(false);
  const [allowedEmailDomainsText, setAllowedEmailDomainsText] = useState<string>('');
  const [emailClaim, setEmailClaim] = useState<string>('email');
  const [nameClaim, setNameClaim] = useState<string>('name');
  const [groupsClaim, setGroupsClaim] = useState<string>('groups');

  const [roleSyncEnabled, setRoleSyncEnabled] = useState<boolean>(false);
  const [roleSyncMode, setRoleSyncMode] = useState<FederatedRoleSyncMode>('ADDITIVE');
  const [requireMatchedGroup, setRequireMatchedGroup] = useState<boolean>(false);
  const [allowedRoleCodesText, setAllowedRoleCodesText] = useState<string>('');
  const [defaultRoleCodesText, setDefaultRoleCodesText] = useState<string>('');
  const [groupRoleMappingsText, setGroupRoleMappingsText] = useState<string>('');

  const selectableCodes = useMemo(() => {
    const codes = new Set<string>(['google', 'microsoft']);
    for (const p of adminProviders) {
      codes.add(p.providerCode);
    }
    if (selectedCode) codes.add(selectedCode);
    return Array.from(codes);
  }, [adminProviders, selectedCode]);

  useEffect(() => {
    const existing = adminProviders.find((p) => p.providerCode === selectedCode);
    const resolvedDriver =
      existing?.driverCode ??
      (selectedCode === 'microsoft'
        ? 'microsoft'
        : selectedCode === 'google'
          ? 'google'
          : newDriverCode || 'oidc');
    const meta = drivers.find((d) => d.driverCode === resolvedDriver);

    if (existing) {
      setDriverCode(existing.driverCode);
      setDisplayName(existing.displayName);
      setIsEnabled(existing.isEnabled);
      setClientId(existing.clientId ?? '');
      setClientSecret('');
      setTenantId(existing.tenantId ?? meta?.defaultTenantId ?? '');
      setIssuerUrl(existing.issuerUrl ?? '');
      setAuthorizationEndpoint(existing.authorizationEndpoint ?? '');
      setTokenEndpoint(existing.tokenEndpoint ?? '');
      setJwksUri(existing.jwksUri ?? '');
      setUserinfoEndpoint(existing.userinfoEndpoint ?? '');
      setScopesText(existing.scopes.join(', '));
      setProviderRedirectUrisText(existing.allowedRedirectUris.join('\n'));
      setAutoRegisterOverride(toOverrideChoice(existing.allowAutoRegisterOverride));
      setAutoLinkOverride(toOverrideChoice(existing.autoLinkVerifiedEmailOverride));

      setDiscoveryEnabled(existing.oidcOptions?.discoveryEnabled ?? existing.driverCode === 'oidc');
      setFetchUserInfo(existing.oidcOptions?.fetchUserInfo ?? false);
      setAllowedEmailDomainsText((existing.oidcOptions?.allowedEmailDomains ?? []).join(', '));
      setEmailClaim(existing.claimMapping?.emailClaim ?? 'email');
      setNameClaim(existing.claimMapping?.nameClaim ?? 'name');
      setGroupsClaim(existing.claimMapping?.groupsClaim ?? 'groups');

      setRoleSyncEnabled(existing.roleSyncPolicy?.enabled ?? false);
      setRoleSyncMode(existing.roleSyncPolicy?.mode ?? 'ADDITIVE');
      setRequireMatchedGroup(existing.roleSyncPolicy?.requireMatchedGroup ?? false);
      setAllowedRoleCodesText((existing.roleSyncPolicy?.allowedRoleCodes ?? []).join(', '));
      setDefaultRoleCodesText((existing.roleSyncPolicy?.defaultRoleCodes ?? []).join(', '));
      setGroupRoleMappingsText(
        formatGroupRoleMappings(existing.roleSyncPolicy?.groupRoleMappings ?? {}),
      );
    } else {
      setDriverCode(resolvedDriver);
      setDisplayName(meta?.displayName ?? selectedCode);
      setIsEnabled(false);
      setClientId('');
      setClientSecret('');
      setTenantId(meta?.defaultTenantId ?? '');
      setIssuerUrl('');
      setAuthorizationEndpoint('');
      setTokenEndpoint('');
      setJwksUri('');
      setUserinfoEndpoint('');
      setScopesText((meta?.defaultScopes ?? ['openid', 'profile', 'email']).join(', '));
      setProviderRedirectUrisText('');
      setAutoRegisterOverride('inherit');
      setAutoLinkOverride('inherit');

      setDiscoveryEnabled(resolvedDriver === 'oidc');
      setFetchUserInfo(false);
      setAllowedEmailDomainsText('');
      setEmailClaim('email');
      setNameClaim('name');
      setGroupsClaim('groups');

      setRoleSyncEnabled(false);
      setRoleSyncMode('ADDITIVE');
      setRequireMatchedGroup(false);
      setAllowedRoleCodesText('');
      setDefaultRoleCodesText('');
      setGroupRoleMappingsText('');
    }
  }, [selectedCode, adminProviders, drivers, newDriverCode]);

  const activeProviderRecord = adminProviders.find((p) => p.providerCode === selectedCode);

  const handleCreateSelect = () => {
    const clean = newProviderCode.trim().toLowerCase();
    if (!clean) return;
    setSelectedCode(clean);
    setDriverCode(newDriverCode || 'oidc');
    setShowCreateForm(false);
    setNewProviderCode('');
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    const redirectUris = providerRedirectUrisText
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    const scopes = parseCsvList(scopesText);

    await onSaveProvider(selectedCode, {
      driverCode,
      displayName: displayName.trim() || selectedCode,
      isEnabled,
      clientId: clientId.trim() || null,
      ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
      ...(driverCode === 'microsoft'
        ? { tenantId: tenantId.trim() || 'common' }
        : { tenantId: tenantId.trim() || null }),
      issuerUrl: issuerUrl.trim() || null,
      authorizationEndpoint: authorizationEndpoint.trim() || null,
      tokenEndpoint: tokenEndpoint.trim() || null,
      jwksUri: jwksUri.trim() || null,
      userinfoEndpoint: userinfoEndpoint.trim() || null,
      ...(scopes.length > 0 ? { scopes } : {}),
      allowedRedirectUris: redirectUris,
      allowAutoRegisterOverride: fromOverrideChoice(autoRegisterOverride),
      autoLinkVerifiedEmailOverride: fromOverrideChoice(autoLinkOverride),
      oidcOptions: {
        discoveryEnabled,
        fetchUserInfo,
        allowedEmailDomains: parseCsvList(allowedEmailDomainsText),
      },
      claimMapping: {
        emailClaim: emailClaim.trim() || 'email',
        nameClaim: nameClaim.trim() || 'name',
        groupsClaim: groupsClaim.trim() || 'groups',
      },
      roleSyncPolicy: {
        enabled: roleSyncEnabled,
        mode: roleSyncMode,
        requireMatchedGroup,
        allowedRoleCodes: parseCsvList(allowedRoleCodesText).map((r) => r.toUpperCase()),
        defaultRoleCodes: parseCsvList(defaultRoleCodesText).map((r) => r.toUpperCase()),
        groupRoleMappings: parseGroupRoleMappingsText(groupRoleMappingsText),
      },
    });
    setClientSecret('');
  };

  return (
    <form onSubmit={handleSaveProvider} style={authStyles.card}>
      <h3 style={authStyles.sectionTitle}>
        <KeyRound size={18} color="var(--primary)" />
        <span>Cấu Hình Nhà Cung Cấp SSO / OIDC</span>
      </h3>
      <p style={authStyles.sectionDesc}>
        Hỗ trợ nhiều Identity Provider (Google, Microsoft, Enterprise OIDC: Keycloak/Okta...),
        OIDC Discovery, ánh xạ Claim và phân quyền Group → Role theo allowlist.
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {selectableCodes.map((code) => {
          const active = selectedCode === code;
          const rec = adminProviders.find((p) => p.providerCode === code);
          return (
            <button
              key={code}
              type="button"
              onClick={() => setSelectedCode(code)}
              style={active ? authStyles.btnPrimary : authStyles.btnSecondary}
            >
              <span>{rec?.displayName || code}</span>
              {rec?.isEnabled && <span style={authStyles.badgeSuccess}>ON</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowCreateForm((prev) => !prev)}
          style={authStyles.btnSecondary}
        >
          <Plus size={14} />
          <span>Thêm IdP OIDC mới</span>
        </button>
      </div>

      {showCreateForm && (
        <div
          style={{
            padding: '10px',
            marginBottom: '12px',
            borderRadius: '8px',
            border: '1px dashed var(--border)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr auto',
            gap: '8px',
            alignItems: 'end',
          }}
        >
          <div>
            <label style={authStyles.label}>Mã Provider (vd: keycloak-vn, okta-corp)</label>
            <input
              type="text"
              value={newProviderCode}
              onChange={(e) => setNewProviderCode(e.target.value)}
              placeholder="keycloak-vn"
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Adapter Driver</label>
            <select
              value={newDriverCode}
              onChange={(e) => setNewDriverCode(e.target.value)}
              style={authStyles.input}
            >
              {(drivers.length > 0
                ? drivers
                : [
                    { driverCode: 'oidc', displayName: 'Enterprise OIDC' },
                    { driverCode: 'google', displayName: 'Google' },
                    { driverCode: 'microsoft', displayName: 'Microsoft' },
                  ]
              ).map((d) => (
                <option key={d.driverCode} value={d.driverCode}>
                  {d.displayName} ({d.driverCode})
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={handleCreateSelect} style={authStyles.btnTeal}>
            Tạo / Chọn
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={authStyles.label}>
              Tên hiển thị (<code>{selectedCode}</code> · driver: <code>{driverCode}</code>)
            </label>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={authStyles.label}>Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Nhập OAuth/OIDC Client ID..."
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>
              Client Secret{' '}
              {activeProviderRecord?.hasClientSecret
                ? `(đã lưu: ${activeProviderRecord.clientSecretHint ?? '****'})`
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

        {driverCode === 'oidc' && (
          <>
            <div>
              <label style={authStyles.label}>Issuer URL (OIDC Discovery)</label>
              <input
                type="text"
                value={issuerUrl}
                onChange={(e) => setIssuerUrl(e.target.value)}
                placeholder="https://sso.company.com/realms/corp"
                style={authStyles.monoInput}
              />
            </div>

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px' }}>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={discoveryEnabled}
                  onChange={(e) => setDiscoveryEnabled(e.target.checked)}
                />
                <span>Tự động OIDC Discovery</span>
              </label>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={fetchUserInfo}
                  onChange={(e) => setFetchUserInfo(e.target.checked)}
                />
                <span>Gọi UserInfo endpoint bổ sung claim</span>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={authStyles.label}>Authorization Endpoint (tùy chọn)</label>
                <input
                  type="text"
                  value={authorizationEndpoint}
                  onChange={(e) => setAuthorizationEndpoint(e.target.value)}
                  placeholder="Để trống nếu dùng Discovery"
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>Token Endpoint (tùy chọn)</label>
                <input
                  type="text"
                  value={tokenEndpoint}
                  onChange={(e) => setTokenEndpoint(e.target.value)}
                  placeholder="Để trống nếu dùng Discovery"
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>JWKS URI (tùy chọn)</label>
                <input
                  type="text"
                  value={jwksUri}
                  onChange={(e) => setJwksUri(e.target.value)}
                  placeholder="Để trống nếu dùng Discovery"
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>UserInfo Endpoint (tùy chọn)</label>
                <input
                  type="text"
                  value={userinfoEndpoint}
                  onChange={(e) => setUserinfoEndpoint(e.target.value)}
                  placeholder="Để trống nếu dùng Discovery"
                  style={authStyles.monoInput}
                />
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={authStyles.label}>Scopes (phân cách bằng dấu phẩy)</label>
            <input
              type="text"
              value={scopesText}
              onChange={(e) => setScopesText(e.target.value)}
              placeholder="openid, profile, email"
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Allowed Email Domains (để trống = cho phép tất cả)</label>
            <input
              type="text"
              value={allowedEmailDomainsText}
              onChange={(e) => setAllowedEmailDomainsText(e.target.value)}
              placeholder="corp.vn, subsidiary.com"
              style={authStyles.monoInput}
            />
          </div>
        </div>

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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
          <div>
            <label style={authStyles.label}>Claim Email</label>
            <input
              type="text"
              value={emailClaim}
              onChange={(e) => setEmailClaim(e.target.value)}
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Claim Họ tên</label>
            <input
              type="text"
              value={nameClaim}
              onChange={(e) => setNameClaim(e.target.value)}
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Claim Nhóm (vd: groups, realm_access.roles)</label>
            <input
              type="text"
              value={groupsClaim}
              onChange={(e) => setGroupsClaim(e.target.value)}
              style={authStyles.monoInput}
            />
          </div>
        </div>

        <div
          style={{
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={roleSyncEnabled}
                onChange={(e) => setRoleSyncEnabled(e.target.checked)}
              />
              <span>Bật ánh xạ Group → Role (luôn chặn SUPER_ADMIN)</span>
            </label>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12.5px' }}>
              <input
                type="checkbox"
                checked={requireMatchedGroup}
                onChange={(e) => setRequireMatchedGroup(e.target.checked)}
              />
              <span>Yêu cầu khớp ít nhất 1 group</span>
            </label>
          </div>

          {roleSyncEnabled && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={authStyles.label}>Chế độ đồng bộ Role</label>
                  <select
                    value={roleSyncMode}
                    onChange={(e) => setRoleSyncMode(e.target.value as FederatedRoleSyncMode)}
                    style={authStyles.input}
                  >
                    <option value="ASSIGN_ON_CREATE">ASSIGN_ON_CREATE (chỉ khi tạo mới)</option>
                    <option value="ADDITIVE">ADDITIVE (chỉ cộng thêm)</option>
                    <option value="SYNC_MANAGED">SYNC_MANAGED (đồng bộ theo allowlist)</option>
                  </select>
                </div>
                <div>
                  <label style={authStyles.label}>Allowlist Role Codes</label>
                  <input
                    type="text"
                    value={allowedRoleCodesText}
                    onChange={(e) => setAllowedRoleCodesText(e.target.value)}
                    placeholder="ADMIN, MANAGER, VIEWER"
                    style={authStyles.monoInput}
                  />
                </div>
                <div>
                  <label style={authStyles.label}>Default Role Codes</label>
                  <input
                    type="text"
                    value={defaultRoleCodesText}
                    onChange={(e) => setDefaultRoleCodesText(e.target.value)}
                    placeholder="VIEWER"
                    style={authStyles.monoInput}
                  />
                </div>
              </div>
              <div>
                <label style={authStyles.label}>
                  Ánh xạ Group → Role (mỗi dòng 1 cặp: <code>idp-group=ROLE_A,ROLE_B</code>)
                </label>
                <textarea
                  rows={2}
                  value={groupRoleMappingsText}
                  onChange={(e) => setGroupRoleMappingsText(e.target.value)}
                  placeholder="corp-managers=MANAGER&#10;corp-staff=VIEWER"
                  style={authStyles.monoInput}
                />
              </div>
            </>
          )}
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
          {driverCode === 'oidc' && (
            <button
              type="button"
              disabled={busy || !activeProviderRecord}
              onClick={() => void onDiscoverProvider(selectedCode)}
              style={authStyles.btnSecondary}
            >
              <Compass size={14} />
              <span>OIDC Discovery</span>
            </button>
          )}
          {activeProviderRecord && selectedCode !== 'google' && selectedCode !== 'microsoft' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDeleteProvider(selectedCode)}
              style={authStyles.btnDanger}
            >
              <Trash2 size={14} />
              <span>Xóa IdP</span>
            </button>
          )}
        </div>
      </div>
    </form>
  );
};
