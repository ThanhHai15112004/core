import React, { useState } from 'react';
import { History } from 'lucide-react';
import type { ProviderConfigHistoryItem } from '../types/provider-registry.types';

interface ProviderHistoryPanelProps {
  histories: readonly ProviderConfigHistoryItem[];
  actionFilter: string;
  onActionFilterChange: (action: string) => void;
}

export const ProviderHistoryPanel: React.FC<ProviderHistoryPanelProps> = ({
  histories,
  actionFilter,
  onActionFilterChange,
}) => {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        display: 'grid',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
          <History size={16} /> Lịch sử Audit thay đổi cấu hình Provider ({histories.length})
        </div>
        <select
          value={actionFilter}
          onChange={(e) => onActionFilterChange(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
        >
          <option value="">Tất cả thao tác</option>
          <option value="CREATE">CREATE</option>
          <option value="UPDATE">UPDATE</option>
          <option value="SET_PRIMARY">SET_PRIMARY</option>
          <option value="PAUSE">PAUSE</option>
          <option value="RESUME">RESUME</option>
          <option value="UNIT_ASSIGN">UNIT_ASSIGN</option>
          <option value="UNIT_UNASSIGN">UNIT_UNASSIGN</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>

      {histories.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Chưa có lịch sử thay đổi.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '8px 6px' }}>Thời gian</th>
                <th style={{ padding: '8px 6px' }}>Thao tác</th>
                <th style={{ padding: '8px 6px' }}>Provider</th>
                <th style={{ padding: '8px 6px' }}>Trường thay đổi</th>
                <th style={{ padding: '8px 6px' }}>Lý do</th>
                <th style={{ padding: '8px 6px' }}>Người thao tác</th>
                <th style={{ padding: '8px 6px' }}>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {histories.map((h) => {
                const isExpanded = expandedId === h.id;
                return (
                  <React.Fragment key={h.id}>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                        {new Date(h.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px 6px', fontWeight: 700 }}>{h.action}</td>
                      <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>
                        {h.providerType}:{h.providerCode}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        {h.changedFields.length > 0 ? h.changedFields.join(', ') : '—'}
                      </td>
                      <td style={{ padding: '8px 6px' }}>{h.reason ?? '—'}</td>
                      <td style={{ padding: '8px 6px' }}>{h.actorIdentifier ?? 'system'}</td>
                      <td style={{ padding: '8px 6px' }}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : h.id)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--border-subtle)',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          {isExpanded ? 'Ẩn' : 'Before/After'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} style={{ padding: 10, background: 'rgba(148,163,184,0.06)' }}>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: 10,
                              fontSize: 11,
                            }}
                          >
                            <div>
                              <strong>Before (Redacted):</strong>
                              <pre style={{ margin: '4px 0 0', overflow: 'auto', maxHeight: 180 }}>
                                {JSON.stringify(h.beforeState, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <strong>After (Redacted):</strong>
                              <pre style={{ margin: '4px 0 0', overflow: 'auto', maxHeight: 180 }}>
                                {JSON.stringify(h.afterState, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
