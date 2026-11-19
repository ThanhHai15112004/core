import React, { useState } from 'react';
import { GitBranch, PlayCircle, Trash2 } from 'lucide-react';
import { providerRegistryApi } from '../services/provider-registry.api';
import {
  ALL_PROVIDER_TYPES,
  PROVIDER_TYPE_LABELS,
  type ProviderRegistryEntryItem,
  type ProviderResolvePreviewResult,
  type ProviderTypeName,
  type ProviderUnitAssignmentItem,
} from '../types/provider-registry.types';

interface ProviderUnitRoutingPanelProps {
  providers: readonly ProviderRegistryEntryItem[];
  unitAssignments: readonly ProviderUnitAssignmentItem[];
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const ProviderUnitRoutingPanel: React.FC<ProviderUnitRoutingPanelProps> = ({
  providers,
  unitAssignments,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [providerType, setProviderType] = useState<ProviderTypeName>('PAYMENT');
  const [organizationUnitId, setOrganizationUnitId] = useState('1');
  const [primaryProviderId, setPrimaryProviderId] = useState('');
  const [fallbackProviderId, setFallbackProviderId] = useState('');
  const [allowFallbackOverride, setAllowFallbackOverride] = useState<'default' | 'true' | 'false'>(
    'default',
  );
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [previewType, setPreviewType] = useState<ProviderTypeName>('PAYMENT');
  const [previewUnitId, setPreviewUnitId] = useState('');
  const [previewResult, setPreviewResult] = useState<ProviderResolvePreviewResult | null>(null);

  const providersForType = providers.filter((p) => p.providerType === providerType);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    onError(null);
    onFeedback(null);
    try {
      await providerRegistryApi.upsertUnitAssignment({
        providerType,
        organizationUnitId: Number(organizationUnitId),
        primaryProviderId: Number(primaryProviderId),
        fallbackProviderId: fallbackProviderId ? Number(fallbackProviderId) : null,
        allowFallbackOverride:
          allowFallbackOverride === 'default' ? null : allowFallbackOverride === 'true',
        isEnabled: true,
        notes: notes.trim() || null,
      });
      onFeedback(`Đã lưu định tuyến ${providerType} cho Đơn vị #${organizationUnitId}.`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể lưu phân công theo đơn vị');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAssignment = async (id: number) => {
    onError(null);
    try {
      await providerRegistryApi.deleteUnitAssignment(id);
      onFeedback(`Đã gỡ cấu hình đơn vị #${id}.`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể gỡ cấu hình đơn vị');
    }
  };

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    try {
      const result = await providerRegistryApi.resolvePreview({
        providerType: previewType,
        organizationUnitId: previewUnitId.trim() ? Number(previewUnitId) : null,
      });
      setPreviewResult(result);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể kiểm thử phân giải');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Unit Assignment Form */}
      <form
        onSubmit={(e) => void handleAssign(e)}
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
          <GitBranch size={16} /> Chọn Nhà cung cấp theo Đơn vị
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
              onChange={(e) => {
                setProviderType(e.target.value as ProviderTypeName);
                setPrimaryProviderId('');
                setFallbackProviderId('');
              }}
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
            <span>ID Đơn vị (organizationUnitId)</span>
            <input
              type="number"
              min={1}
              required
              value={organizationUnitId}
              onChange={(e) => setOrganizationUnitId(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Provider chính cho đơn vị</span>
            <select
              required
              value={primaryProviderId}
              onChange={(e) => setPrimaryProviderId(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            >
              <option value="">-- Chọn Primary --</option>
              {providersForType.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.providerCode} ({p.displayName})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Provider dự phòng (tùy chọn)</span>
            <select
              value={fallbackProviderId}
              onChange={(e) => setFallbackProviderId(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            >
              <option value="">-- Dùng policy hệ thống --</option>
              {providersForType.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.providerCode} ({p.displayName})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Chính sách Fallback cho đơn vị</span>
            <select
              value={allowFallbackOverride}
              onChange={(e) =>
                setAllowFallbackOverride(e.target.value as 'default' | 'true' | 'false')
              }
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            >
              <option value="default">Theo chính sách toàn cục</option>
              <option value="true">Cho phép Fallback riêng</option>
              <option value="false">Cấm Fallback riêng</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Ghi chú</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú đơn vị..."
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {saving ? 'Đang lưu...' : 'Lưu phân công đơn vị'}
          </button>
        </div>
      </form>

      {/* Resolve Preview Tester */}
      <form
        onSubmit={(e) => void handlePreview(e)}
        style={{
          padding: 16,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
          <PlayCircle size={16} /> Kiểm thử phân giải Provider (Resolve Preview)
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Loại Provider</span>
            <select
              value={previewType}
              onChange={(e) => setPreviewType(e.target.value as ProviderTypeName)}
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
            <span>Organization Unit ID (bỏ trống = Global)</span>
            <input
              type="number"
              min={1}
              value={previewUnitId}
              onChange={(e) => setPreviewUnitId(e.target.value)}
              placeholder="Global"
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
          <button
            type="submit"
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Chạy Resolve
          </button>
        </div>
        {previewResult && (
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              background: previewResult.resolved
                ? 'rgba(22,163,74,0.09)'
                : 'rgba(220,38,38,0.09)',
              fontSize: 12,
            }}
          >
            <strong>{previewResult.resolved ? 'ĐÃ CHỌN:' : 'BỊ CHẶN / KHÔNG CHỌN ĐƯỢC:'}</strong>{' '}
            {previewResult.provider
              ? `${previewResult.provider.providerCode} (${previewResult.provider.driverCode})`
              : '—'}{' '}
            • Nguồn: <code>{previewResult.resolutionSource}</code> • Lý do:{' '}
            <code>{previewResult.reason}</code> • Dùng Fallback:{' '}
            {previewResult.usedFallback ? 'Có' : 'Không'}
          </div>
        )}
      </form>

      {/* Assignments Table */}
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
          Danh sách cấu hình theo Đơn vị ({unitAssignments.length})
        </h3>
        {unitAssignments.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Chưa có cấu hình riêng theo đơn vị.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '8px 6px' }}>Loại</th>
                <th style={{ padding: '8px 6px' }}>Đơn vị</th>
                <th style={{ padding: '8px 6px' }}>Primary</th>
                <th style={{ padding: '8px 6px' }}>Fallback</th>
                <th style={{ padding: '8px 6px' }}>Policy Fallback</th>
                <th style={{ padding: '8px 6px' }}>Xóa</th>
              </tr>
            </thead>
            <tbody>
              {unitAssignments.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px 6px', fontWeight: 700 }}>{a.providerType}</td>
                  <td style={{ padding: '8px 6px' }}>Unit #{a.organizationUnitId}</td>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>
                    {a.primaryProviderCode ?? `#${a.primaryProviderId}`}
                  </td>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>
                    {a.fallbackProviderCode ?? (a.fallbackProviderId ? `#${a.fallbackProviderId}` : '—')}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    {a.allowFallbackOverride === null
                      ? 'Mặc định hệ thống'
                      : a.allowFallbackOverride
                        ? 'Cho phép'
                        : 'Cấm'}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <button
                      type="button"
                      onClick={() => void handleDeleteAssignment(a.id)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid rgba(220,38,38,0.35)',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
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
