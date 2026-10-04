import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Sliders, Shield, Terminal, Check, RefreshCw, Search } from 'lucide-react';
import { SectionHeader } from '../../components/common/SectionHeader';
import { StatCard } from '../../components/common/StatCard';
import { EmptyState } from '../../components/common/EmptyState';
import { fetchConfiguration, type ConfigItem } from '../../services/governance.api';

export const ConfigurationSection: React.FC = () => {
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchConfiguration();
      setItems(data);
    } catch (err) {
      console.error('Failed to fetch configuration:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const domains = useMemo(() => {
    const set = new Set(items.map((i) => i.domain));
    return ['all', ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchDomain = selectedDomain === 'all' || item.domain === selectedDomain;
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        item.key.toLowerCase().includes(q) ||
        item.domain.toLowerCase().includes(q) ||
        String(item.value).toLowerCase().includes(q);
      return matchDomain && matchSearch;
    });
  }, [items, selectedDomain, search]);

  const stats = useMemo(() => {
    const total = items.length;
    const fromEnv = items.filter((i) => i.source === 'env').length;
    const fromDefault = total - fromEnv;
    const sensitive = items.filter((i) => i.sensitive).length;
    return { total, fromEnv, fromDefault, sensitive };
  }, [items]);

  const renderValue = (item: ConfigItem) => {
    if (item.sensitive) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--scp-text-muted)' }}>
          <span style={{ fontFamily: 'monospace' }}>••••••••</span>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '1px 6px',
              borderRadius: '4px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--scp-danger, #ef4444)',
              fontWeight: 600,
            }}
          >
            Che
          </span>
        </span>
      );
    }

    if (typeof item.value === 'boolean') {
      return (
        <span
          style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '4px',
            fontWeight: 600,
            backgroundColor: item.value ? 'rgba(34, 197, 94, 0.1)' : 'var(--scp-bg-surface-subtle)',
            color: item.value ? 'var(--scp-success, #22c55e)' : 'var(--scp-text-muted)',
          }}
        >
          {String(item.value)}
        </span>
      );
    }

    if (item.value === null || item.value === undefined) {
      return <span style={{ color: 'var(--scp-text-muted)', fontStyle: 'italic' }}>null</span>;
    }

    return (
      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
        {String(item.value)}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <SectionHeader
          title="Configuration Inspector"
          description="Kiểm tra cấu hình toàn bộ hệ thống theo từng domain (Hạ tầng, Runtime, Nghiệp vụ). Giá trị nhạy cảm được tự động che."
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
          title="Tổng tham số cấu hình"
          value={stats.total}
          icon={<Sliders size={20} color="var(--scp-primary, #6366f1)" />}
        />
        <StatCard
          title="Nguồn Environment (ENV)"
          value={stats.fromEnv}
          icon={<Terminal size={20} color="var(--scp-success, #22c55e)" />}
        />
        <StatCard
          title="Giá trị mặc định"
          value={stats.fromDefault}
          icon={<Check size={20} color="var(--scp-text-muted)" />}
        />
        <StatCard
          title="Dữ liệu nhạy cảm"
          value={stats.sensitive}
          icon={<Shield size={20} color="var(--scp-danger, #ef4444)" />}
        />
      </div>

      {/* Filter Tabs & Search */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {domains.map((dom) => (
            <button
              key={dom}
              onClick={() => setSelectedDomain(dom)}
              className={`scp-btn ${selectedDomain === dom ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
              style={{
                fontSize: '0.8rem',
                padding: '4px 10px',
                borderRadius: '6px',
                textTransform: dom === 'all' ? 'capitalize' : 'lowercase',
              }}
            >
              {dom === 'all' ? 'Tất cả domain' : dom}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: '280px' }}>
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
            placeholder="Tìm theo key hoặc value..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '2.25rem' }}
          />
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--scp-text-muted)' }}>
          Đang tải cấu hình hệ thống...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Không tìm thấy cấu hình phù hợp"
          description="Không có tham số cấu hình nào khớp với bộ lọc hoặc từ khóa tìm kiếm."
        />
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--scp-border-subtle)', borderRadius: '8px' }}>
          <table className="scp-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--scp-bg-surface-subtle)', borderBottom: '1px solid var(--scp-border-subtle)' }}>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Domain</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Key</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Giá trị</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={`${item.domain}.${item.key}`} style={{ borderBottom: '1px solid var(--scp-border-subtle)' }}>
                  <td style={{ padding: '0.75rem 1rem', width: '140px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--scp-bg-surface-subtle)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                    >
                      {item.domain}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontWeight: 600, fontSize: '0.85rem' }}>
                    {item.key}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>{renderValue(item)}</td>
                  <td style={{ padding: '0.75rem 1rem', width: '120px' }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        backgroundColor:
                          item.source === 'env'
                            ? 'rgba(34, 197, 94, 0.1)'
                            : 'var(--scp-bg-surface-subtle)',
                        color:
                          item.source === 'env'
                            ? 'var(--scp-success, #22c55e)'
                            : 'var(--scp-text-muted)',
                      }}
                    >
                      {item.source.toUpperCase()}
                    </span>
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
