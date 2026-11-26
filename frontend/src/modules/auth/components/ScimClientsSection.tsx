import React, { useState } from 'react';
import { Copy, KeyRound, Plus, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { authStyles } from './auth-ui.styles';
import type { UpsertScimClientPayload } from '../services/scim-provisioning.api';
import type { ScimClientItem, ScimDeprovisionMode } from '../types/scim-provisioning.types';

interface ScimClientsSectionProps {
  readonly busy: boolean;
  readonly clients: readonly ScimClientItem[];
  readonly issuedTokenBanner: { readonly clientCode: string; readonly plainToken: string } | null;
  readonly onClearIssuedToken: () => void;
  readonly onCreateClient: (payload: UpsertScimClientPayload) => Promise<void>;
  readonly onUpdateClient: (clientId: number, payload: UpsertScimClientPayload) => Promise<void>;
  readonly onRotateToken: (clientId: number) => Promise<void>;
  readonly onDeleteClient: (clientId: number) => Promise<void>;
}

export const ScimClientsSection: React.FC<ScimClientsSectionProps> = ({
  busy,
  clients,
  issuedTokenBanner,
  onClearIssuedToken,
  onCreateClient,
  onUpdateClient,
  onRotateToken,
  onDeleteClient,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [allowedIpsText, setAllowedIpsText] = useState('');
  const [deprovisionMode, setDeprovisionMode] =
    useState<ScimDeprovisionMode>('LOCK_AND_REVOKE');
  const [allowedRoleCodesText, setAllowedRoleCodesText] = useState('USER, STAFF');
  const [groupMappingsJson, setGroupMappingsJson] = useState('{\n  "Engineering": ["STAFF"]\n}');
  const [requireIfMatch, setRequireIfMatch] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setCode('');
    setName('');
    setAllowedIpsText('');
    setDeprovisionMode('LOCK_AND_REVOKE');
    setAllowedRoleCodesText('USER, STAFF');
    setGroupMappingsJson('{\n  "Engineering": ["STAFF"]\n}');
    setRequireIfMatch(false);
  };

  const startEdit = (client: ScimClientItem) => {
    setEditingId(client.id);
    setCode(client.code);
    setName(client.name);
    setAllowedIpsText(client.allowedIps.join(', '));
    setDeprovisionMode(client.deprovisionMode);
    setAllowedRoleCodesText(client.allowedRoleCodes.join(', '));
    setGroupMappingsJson(JSON.stringify(client.groupRoleMappings, null, 2));
    setRequireIfMatch(client.requireIfMatch);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let parsedMappings: Record<string, string[]> = {};
    try {
      const raw = JSON.parse(groupMappingsJson || '{}');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        parsedMappings = raw as Record<string, string[]>;
      }
    } catch {
      parsedMappings = {};
    }

    const allowedIps = allowedIpsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedRoleCodes = allowedRoleCodesText
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (editingId) {
      await onUpdateClient(editingId, {
        name,
        allowedIps,
        deprovisionMode,
        allowedRoleCodes,
        groupRoleMappings: parsedMappings,
        requireIfMatch,
      });
      resetForm();
      return;
    }

    await onCreateClient({
      code: code.trim().toLowerCase(),
      name: name.trim(),
      allowedIps,
      deprovisionMode,
      allowedRoleCodes,
      groupRoleMappings: parsedMappings,
      requireIfMatch,
    });
    resetForm();
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {issuedTokenBanner && (
        <div
          style={{
            ...authStyles.cardHighlighted,
            borderColor: 'var(--status-success)',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ color: 'var(--status-success)', fontSize: '14px' }}>
              Bearer Token mới cho SCIM Client &quot;{issuedTokenBanner.clientCode}&quot; (chỉ hiển
              thị 1 lần)
            </strong>
            <button type="button" onClick={onClearIssuedToken} style={authStyles.btnSecondary}>
              Đóng
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <code style={{ ...authStyles.codeBox, flex: 1 }}>{issuedTokenBanner.plainToken}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(issuedTokenBanner.plainToken)}
              style={authStyles.btnPrimary}
            >
              <Copy size={14} /> Sao chép
            </button>
          </div>
        </div>
      )}

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          <KeyRound size={17} />
          <span>{editingId ? `Cập nhật SCIM Client #${editingId}` : 'Tạo SCIM Client mới'}</span>
        </h3>
        <p style={authStyles.sectionDesc}>
          Endpoint SCIM 2.0 cho IdP: <code>/api/v1/scim/v2</code> (hỗ trợ Okta, Microsoft Entra
          ID, Keycloak).
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'grid', gap: '14px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
            }}
          >
            <div>
              <label style={authStyles.label}>Mã Client (kebab-case)</label>
              <input
                style={authStyles.monoInput}
                value={code}
                disabled={Boolean(editingId)}
                required={!editingId}
                placeholder="okta-prod"
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div>
              <label style={authStyles.label}>Tên hiển thị</label>
              <input
                style={authStyles.input}
                value={name}
                required
                placeholder="Okta Workforce SCIM"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label style={authStyles.label}>Chế độ Deprovision khi ngừng cung cấp</label>
              <select
                style={authStyles.input}
                value={deprovisionMode}
                onChange={(e) => setDeprovisionMode(e.target.value as ScimDeprovisionMode)}
              >
                <option value="LOCK_AND_REVOKE">LOCK_AND_REVOKE (Khóa + thu hồi session)</option>
                <option value="DEACTIVATE_AND_REVOKE">
                  DEACTIVATE_AND_REVOKE (Ngưng kích hoạt + thu hồi session)
                </option>
              </select>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '12px',
            }}
          >
            <div>
              <label style={authStyles.label}>
                IP Allowlist / CIDR (để trống = cho phép tất cả)
              </label>
              <input
                style={authStyles.monoInput}
                value={allowedIpsText}
                placeholder="10.0.0.0/24, 203.0.113.10"
                onChange={(e) => setAllowedIpsText(e.target.value)}
              />
            </div>
            <div>
              <label style={authStyles.label}>Allowed Role Codes (chặn SUPER_ADMIN)</label>
              <input
                style={authStyles.monoInput}
                value={allowedRoleCodesText}
                placeholder="USER, STAFF, MANAGER"
                onChange={(e) => setAllowedRoleCodesText(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={authStyles.label}>Group → Role Mappings (JSON)</label>
            <textarea
              style={{ ...authStyles.monoInput, minHeight: '76px' }}
              value={groupMappingsJson}
              onChange={(e) => setGroupMappingsJson(e.target.value)}
            />
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={requireIfMatch}
              onChange={(e) => setRequireIfMatch(e.target.checked)}
            />
            <span>Bắt buộc header If-Match (ETag) cho thao tác PUT / PATCH / DELETE</span>
          </label>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="submit" disabled={busy} style={authStyles.btnPrimary}>
              <Plus size={14} />
              <span>{editingId ? 'Lưu cập nhật' : 'Tạo SCIM Client & Sinh Token'}</span>
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} style={authStyles.btnSecondary}>
                Hủy chỉnh sửa
              </button>
            )}
          </div>
        </form>
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          <Shield size={17} />
          <span>Danh sách SCIM Clients ({clients.length})</span>
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Client</th>
                <th style={authStyles.tableHeaderCell}>Token Prefix</th>
                <th style={authStyles.tableHeaderCell}>IP Allowlist</th>
                <th style={authStyles.tableHeaderCell}>Deprovision</th>
                <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                <th style={authStyles.tableHeaderCell}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center' }}>
                    Chưa có SCIM Client nào.
                  </td>
                </tr>
              ) : (
                clients.map((c) => (
                  <tr key={c.id}>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>{c.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{c.code}</div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <code>{c.tokenPrefix}</code>
                    </td>
                    <td style={authStyles.tableCell}>
                      {c.allowedIps.length > 0 ? c.allowedIps.join(', ') : 'Mọi IP'}
                    </td>
                    <td style={authStyles.tableCell}>
                      <code>{c.deprovisionMode}</code>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          c.statusName === 'ACTIVE'
                            ? authStyles.badgeSuccess
                            : authStyles.badgeWarning
                        }
                      >
                        {c.statusName}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          style={authStyles.btnSecondary}
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onRotateToken(c.id)}
                          style={authStyles.btnAccent}
                        >
                          <RefreshCw size={13} /> Rotate Token
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onDeleteClient(c.id)}
                          style={authStyles.btnDanger}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
