import React from 'react';
import { ChevronLeft, ChevronRight, Eye, Search } from 'lucide-react';
import type { IdempotencyRecordItem } from '../types/idempotency.types';

interface IdempotencyRecordsTableProps {
  readonly records: readonly IdempotencyRecordItem[];
  readonly total: number;
  readonly page: number;
  readonly scopeFilter: string;
  readonly statusFilter: string;
  readonly onlyDuplicates: boolean;
  readonly onlyConflicts: boolean;
  readonly searchFilter: string;
  readonly loading: boolean;
  readonly selectedRecordId: number | null;
  readonly onPageChange: (nextPage: number) => void;
  readonly onScopeFilterChange: (value: string) => void;
  readonly onStatusFilterChange: (value: string) => void;
  readonly onOnlyDuplicatesChange: (value: boolean) => void;
  readonly onOnlyConflictsChange: (value: boolean) => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSelectRecord: (id: number) => void;
}

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  IN_PROGRESS: { bg: 'rgba(2,132,199,0.12)', fg: '#0284c7' },
  COMPLETED: { bg: 'rgba(22,163,74,0.12)', fg: '#15803d' },
  FAILED: { bg: 'rgba(220,38,38,0.12)', fg: '#dc2626' },
};

export const IdempotencyRecordsTable: React.FC<IdempotencyRecordsTableProps> = ({
  records,
  total,
  page,
  scopeFilter,
  statusFilter,
  onlyDuplicates,
  onlyConflicts,
  searchFilter,
  loading,
  selectedRecordId,
  onPageChange,
  onScopeFilterChange,
  onStatusFilterChange,
  onOnlyDuplicatesChange,
  onOnlyConflictsChange,
  onSearchChange,
  onSelectRecord,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <section
      style={{
        padding: 16,
        borderRadius: 14,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Filters */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-canvas, transparent)',
            flex: '1 1 220px',
          }}
        >
          <Search size={14} color="var(--text-muted)" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm theo key, endpoint/target, client, correlationId..."
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'inherit',
              fontSize: 12.5,
              width: '100%',
            }}
          />
        </div>

        <select
          value={scopeFilter}
          onChange={(e) => onScopeFilterChange(e.target.value)}
          style={{
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            color: 'inherit',
            fontSize: 12.5,
          }}
        >
          <option value="">Tất cả luồng</option>
          <option value="API">HTTP API</option>
          <option value="JOB">Background Job</option>
          <option value="WEBHOOK">Inbound Webhook</option>
          <option value="EVENT">Domain Event</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          style={{
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            color: 'inherit',
            fontSize: 12.5,
          }}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="IN_PROGRESS">IN_PROGRESS</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="FAILED">FAILED</option>
        </select>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={onlyDuplicates}
            onChange={(e) => onOnlyDuplicatesChange(e.target.checked)}
          />
          Chỉ bản ghi có trùng
        </label>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={onlyConflicts}
            onChange={(e) => onOnlyConflictsChange(e.target.checked)}
          />
          Chỉ bản ghi lỗi 409
        </label>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr
              style={{
                textAlign: 'left',
                borderBottom: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
              }}
            >
              <th style={{ padding: '8px' }}>ID</th>
              <th style={{ padding: '8px' }}>Luồng</th>
              <th style={{ padding: '8px' }}>Đích &amp; Khóa chống trùng</th>
              <th style={{ padding: '8px' }}>Client / Nguồn</th>
              <th style={{ padding: '8px' }}>Trạng thái</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Trùng / Lỗi 409</th>
              <th style={{ padding: '8px' }}>Hết hạn (TTL)</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Xem</th>
            </tr>
          </thead>
          <tbody>
            {loading && records.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Đang tải danh sách khóa Idempotency...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Không có bản ghi khóa Idempotency nào khớp điều kiện lọc.
                </td>
              </tr>
            ) : (
              records.map((rec) => {
                const st = STATUS_STYLE[rec.statusName] ?? {
                  bg: 'rgba(100,116,139,0.12)',
                  fg: '#475569',
                };
                const isSelected = selectedRecordId === rec.id;
                return (
                  <tr
                    key={rec.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isSelected ? 'rgba(37,99,235,0.06)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '8px', fontFamily: 'monospace' }}>#{rec.id}</td>
                    <td style={{ padding: '8px', fontWeight: 700 }}>{rec.scope}</td>
                    <td style={{ padding: '8px', maxWidth: 340 }}>
                      <div style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 11.5 }}>
                        {rec.scopeTarget}
                      </div>
                      <div
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          wordBreak: 'break-all',
                        }}
                      >
                        key: {rec.idempotencyKey}
                      </div>
                    </td>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 11.5 }}>
                      {rec.clientIdentifier ?? '—'}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: st.bg,
                          color: st.fg,
                        }}
                      >
                        {rec.statusName}
                      </span>
                      {rec.expired && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10.5,
                            color: '#64748b',
                            fontWeight: 600,
                          }}
                        >
                          (Hết hạn)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
                      <span style={{ color: rec.duplicateHits > 0 ? '#d97706' : 'inherit', fontWeight: 700 }}>
                        {rec.duplicateHits}
                      </span>
                      {' / '}
                      <span style={{ color: rec.conflictHits > 0 ? '#dc2626' : 'inherit', fontWeight: 700 }}>
                        {rec.conflictHits}
                      </span>
                    </td>
                    <td style={{ padding: '8px', fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {new Date(rec.expiresAt).toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => onSelectRecord(rec.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 9px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'transparent',
                          color: 'inherit',
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        <Eye size={13} /> Chi tiết
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          Tổng: <strong>{total}</strong> bản ghi — Trang {page} / {totalPages}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              borderRadius: 7,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'inherit',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
            }}
          >
            <ChevronLeft size={14} /> Trước
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              borderRadius: 7,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'inherit',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
            }}
          >
            Sau <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
};
