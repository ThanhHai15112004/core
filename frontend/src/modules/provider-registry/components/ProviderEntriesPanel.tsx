import React, { useState } from 'react';
import { HeartPulse, Pause, Play, Plus, Star, Trash2 } from 'lucide-react';
import { providerRegistryApi } from '../services/provider-registry.api';
import {
  ALL_PROVIDER_TYPES,
  PROVIDER_TYPE_LABELS,
  type ProviderCatalogView,
  type ProviderRegistryEntryItem,
  type ProviderTypeName,
} from '../types/provider-registry.types';

interface ProviderEntriesPanelProps {
  catalog: ProviderCatalogView | null;
  providers: readonly ProviderRegistryEntryItem[];
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const ProviderEntriesPanel: React.FC<ProviderEntriesPanelProps> = ({
  catalog,
  providers,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [providerType, setProviderType] = useState<ProviderTypeName>('EMAIL');
  const [providerCode, setProviderCode] = useState('');
  const [driverCode, setDriverCode] = useState('smtp');
  const [displayName, setDisplayName] = useState('');
  const [domainRefCode, setDomainRefCode] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [healthCheckUrl, setHealthCheckUrl] = useState('');
  const [priority, setPriority] = useState(100);
  const [isPrimary, setIsPrimary] = useState(true);
  const [fallbackAllowed, setFallbackAllowed] = useState(false);
  const [saving, setSaving] = useState(false);

  const driverOptions = catalog?.driversByType[providerType] ?? [];

  const handleTypeChange = (nextType: ProviderTypeName) => {
    setProviderType(nextType);
    const first = catalog?.driversByType[nextType]?.[0];
    if (first) {
      setDriverCode(first.driverCode);
      setDomainRefCode(first.defaultDomainRefCode ?? '');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    onError(null);
    onFeedback(null);
    try {
      const config: Record<string, unknown> = {};
      if (healthCheckUrl.trim()) {
        config.healthCheckUrl = healthCheckUrl.trim();
      }
      await providerRegistryApi.createProvider({
        providerType,
        providerCode: providerCode.trim().toLowerCase(),
        driverCode: driverCode.trim().toLowerCase(),
        displayName: displayName.trim(),
        domainRefCode: domainRefCode.trim() || null,
        secretRef: secretRef.trim() || null,
        priority: Number(priority) || 100,
        isPrimary,
        fallbackAllowed,
        config,
      });
      onFeedback(`Đã đăng ký provider "${providerCode.trim().toLowerCase()}" (${providerType}).`);
      setProviderCode('');
      setDisplayName('');
      setHealthCheckUrl('');
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể đăng ký nhà cung cấp');
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async (item: ProviderRegistryEntryItem) => {
    onError(null);
    try {
      await providerRegistryApi.setPrimary(item.id, 'Đặt làm nhà cung cấp chính từ UI');
      onFeedback(`Đã đặt "${item.providerCode}" làm Primary cho ${item.providerType}.`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể đặt làm Primary');
    }
  };

  const handlePause = async (item: ProviderRegistryEntryItem) => {
    const reason = window.prompt(
      `Nhập lý do tạm dừng provider "${item.providerCode}":`,
      'Bảo trì định kỳ',
    );
    if (reason === null) return;
    onError(null);
    try {
      await providerRegistryApi.pauseProvider(item.id, reason || 'Tạm dừng từ UI');
      onFeedback(`Đã tạm dừng "${item.providerCode}" (không cần sửa code).`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể tạm dừng provider');
    }
  };

  const handleResume = async (item: ProviderRegistryEntryItem) => {
    onError(null);
    try {
      await providerRegistryApi.resumeProvider(item.id, 'Khôi phục hoạt động từ UI');
      onFeedback(`Đã khôi phục "${item.providerCode}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể khôi phục provider');
    }
  };

  const handleHealthCheck = async (item: ProviderRegistryEntryItem) => {
    onError(null);
    try {
      const hc = await providerRegistryApi.checkProviderHealth(item.id);
      onFeedback(
        `Health Check "${item.providerCode}": ${hc.healthStatusName} (${hc.latencyMs ?? 0}ms).`,
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể kiểm tra sức khỏe');
    }
  };

  const handleDelete = async (item: ProviderRegistryEntryItem) => {
    onError(null);
    try {
      await providerRegistryApi.deleteProvider(item.id);
      onFeedback(`Đã xóa mềm "${item.providerCode}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xóa provider');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Create Form */}
      <form
        onSubmit={(e) => void handleCreate(e)}
        style={{
          padding: 16,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
          <Plus size={16} /> Đăng ký Nhà cung cấp mới
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Loại Provider</span>
            <select
              value={providerType}
              onChange={(e) => handleTypeChange(e.target.value as ProviderTypeName)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            >
              {ALL_PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROVIDER_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Mã Provider (code)</span>
            <input
              required
              placeholder="vd: sendgrid-main"
              value={providerCode}
              onChange={(e) => setProviderCode(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Driver</span>
            {driverOptions.length > 0 ? (
              <select
                value={driverCode}
                onChange={(e) => setDriverCode(e.target.value)}
                style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              >
                {driverOptions.map((d) => (
                  <option key={d.driverCode} value={d.driverCode}>
                    {d.driverCode} — {d.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                value={driverCode}
                onChange={(e) => setDriverCode(e.target.value)}
                style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            )}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Tên hiển thị</span>
            <input
              required
              placeholder="SendGrid Chính"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Domain Ref Code (tùy chọn)</span>
            <input
              placeholder="vd: vnpay-main / SENDGRID"
              value={domainRefCode}
              onChange={(e) => setDomainRefCode(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Secret Ref (không lưu plaintext)</span>
            <input
              placeholder="vd: EMAIL_SENDGRID_KEY"
              value={secretRef}
              onChange={(e) => setSecretRef(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Health Check URL (tùy chọn)</span>
            <input
              placeholder="https://status.example.com/health"
              value={healthCheckUrl}
              onChange={(e) => setHealthCheckUrl(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Độ ưu tiên (Priority)</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            Đặt làm nhà cung cấp chính (Primary)
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={fallbackAllowed}
              onChange={(e) => setFallbackAllowed(e.target.checked)}
            />
            Cho phép làm dự phòng (Fallback)
          </label>
          <button
            type="submit"
            disabled={saving}
            style={{
              marginLeft: 'auto',
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {saving ? 'Đang lưu...' : 'Đăng ký Provider'}
          </button>
        </div>
      </form>

      {/* Providers List */}
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          overflowX: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>
          Danh sách Nhà cung cấp đã đăng ký ({providers.length})
        </h3>
        {providers.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Chưa có dữ liệu.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '8px 6px' }}>Loại</th>
                <th style={{ padding: '8px 6px' }}>Mã / Driver</th>
                <th style={{ padding: '8px 6px' }}>Vai trò</th>
                <th style={{ padding: '8px 6px' }}>Trạng thái</th>
                <th style={{ padding: '8px 6px' }}>Sức khỏe</th>
                <th style={{ padding: '8px 6px' }}>Secret Ref</th>
                <th style={{ padding: '8px 6px' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px 6px', fontWeight: 700 }}>{p.providerType}</td>
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ fontWeight: 600 }}>{p.displayName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {p.providerCode} • {p.driverCode}
                    </div>
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    {p.isPrimary ? 'PRIMARY' : p.fallbackAllowed ? `FALLBACK (#${p.priority})` : `STANDBY (#${p.priority})`}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <strong>{p.statusName}</strong>
                    {p.pausedReason && (
                      <div style={{ fontSize: 11, color: '#b45309' }}>{p.pausedReason}</div>
                    )}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    {p.healthStatusName}
                    {p.lastHealthLatencyMs !== null ? ` (${p.lastHealthLatencyMs}ms)` : ''}
                  </td>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 11 }}>
                    {p.secretRef ?? (p.secretHint ? `enc:${p.secretHint}` : '—')}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!p.isPrimary && p.statusName === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={() => void handleSetPrimary(p)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--border-subtle)',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          <Star size={12} /> Primary
                        </button>
                      )}
                      {p.statusName === 'PAUSED' ? (
                        <button
                          type="button"
                          onClick={() => void handleResume(p)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid rgba(22,163,74,0.4)',
                            color: '#15803d',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          <Play size={12} /> Tiếp tục
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handlePause(p)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid rgba(217,119,6,0.4)',
                            color: '#b45309',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          <Pause size={12} /> Tạm dừng
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleHealthCheck(p)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        <HeartPulse size={12} /> Check
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(p)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1px solid rgba(220,38,38,0.35)',
                          color: '#dc2626',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
