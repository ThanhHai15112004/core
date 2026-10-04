import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { KeyRound, ShieldAlert, CheckCircle2, XCircle, RefreshCw, Search } from 'lucide-react';
import { SectionHeader } from '../../components/common/SectionHeader';
import { StatCard } from '../../components/common/StatCard';
import { EmptyState } from '../../components/common/EmptyState';
import { fetchSecrets, type SecretItem } from '../../services/governance.api';

export const SecretsSection: React.FC = () => {
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSecrets();
      setSecrets(data);
    } catch (err) {
      console.error('Failed to fetch secrets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return secrets;
    return secrets.filter((s) => s.key.toLowerCase().includes(q));
  }, [secrets, search]);

  const stats = useMemo(() => {
    const total = secrets.length;
    const present = secrets.filter((s) => s.present).length;
    const missing = total - present;
    const driver = secrets[0]?.driver?.toUpperCase() ?? 'ENV';
    return { total, present, missing, driver };
  }, [secrets]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <SectionHeader
          title="Secrets Registry"
          description="Kiểm tra trạng thái cấu hình và độ bảo mật của các Secret Key trong hệ thống. Giá trị bí mật luôn được ẩn 100%."
        />
        <button
          className="scp-btn scp-btn-secondary"
          onClick={() => void loadData()}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}
        >
          <RefreshCw size={14} className={loading ? 'scp-spin' : ''} />
          <span>Làm mới</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard
          label="Tổng Secret Keys"
          value={stats.total}
          icon={<KeyRound size={20} color="var(--scp-primary, #6366f1)" />}
        />
        <StatCard
          label="Đã cấu hình"
          value={stats.present}
          icon={<CheckCircle2 size={20} color="var(--scp-success, #22c55e)" />}
        />
        <StatCard
          label="Còn thiếu"
          value={stats.missing}
          icon={<XCircle size={20} color={stats.missing > 0 ? 'var(--scp-danger, #ef4444)' : 'var(--scp-text-muted)'} />}
        />
        <StatCard
          label="Storage Driver"
          value={stats.driver}
          icon={<ShieldAlert size={20} color="var(--scp-warning, #f59e0b)" />}
        />
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--scp-text-muted)',
            }}
          />
          <input
            type="text"
            className="scp-input"
            placeholder="Tìm theo secret key..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '2.25rem' }}
          />
        </div>
      </div>

      {loading && secrets.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--scp-text-muted)' }}>
          Đang tải danh sách secrets...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Không tìm thấy Secret nào"
          description={search ? 'Không có key nào khớp với từ khóa tìm kiếm.' : 'Hệ thống chưa đăng ký secret key nào.'}
        />
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--scp-border-subtle)', borderRadius: '8px' }}>
          <table className="scp-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--scp-bg-surface-subtle)', borderBottom: '1px solid var(--scp-border-subtle)' }}>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Secret Key</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Trạng thái</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Độ dài</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Driver</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Giá trị</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Thời điểm đọc</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.key} style={{ borderBottom: '1px solid var(--scp-border-subtle)' }}>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontWeight: 600, fontSize: '0.9rem' }}>
                    {item.key}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {item.present ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: 'var(--scp-success, #22c55e)',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                        }}
                      >
                        <CheckCircle2 size={14} /> Có mặt
                      </span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: 'var(--scp-danger, #ef4444)',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                        }}
                      >
                        <XCircle size={14} /> Chưa cấu hình
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--scp-text-muted)' }}>
                    {item.length !== undefined ? `${item.length} ký tự` : '--'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--scp-bg-surface-subtle)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}
                    >
                      {item.driver}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: 'var(--scp-text-muted)', fontSize: '0.85rem' }}>
                    ••••••••••••
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--scp-text-muted)' }}>
                    {item.lastReadAt ? new Date(item.lastReadAt).toLocaleTimeString() : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
