import React from 'react';
import { Eye, RotateCcw, Search } from 'lucide-react';
import {
  OUTBOX_STATUS_BADGE_STYLES,
  OUTBOX_STATUS_LABELS,
  type OutboxEventItem,
} from '../types/outbox.types';

interface OutboxEventsTableProps {
  readonly events: readonly OutboxEventItem[];
  readonly total: number;
  readonly page: number;
  readonly statusFilter: string;
  readonly sourceModuleFilter: string;
  readonly searchFilter: string;
  readonly loading: boolean;
  readonly selectedEventId: number | null;
  readonly onPageChange: (page: number) => void;
  readonly onStatusFilterChange: (status: string) => void;
  readonly onSourceModuleChange: (module: string) => void;
  readonly onSearchChange: (search: string) => void;
  readonly onSelectEvent: (id: number) => void;
}

const STATUS_CHIPS = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'DEAD_LETTER', label: 'Dead Letter' },
  { value: 'PUBLISHED', label: 'Published' },
];

export const OutboxEventsTable: React.FC<OutboxEventsTableProps> = ({
  events,
  total,
  page,
  statusFilter,
  sourceModuleFilter,
  searchFilter,
  loading,
  selectedEventId,
  onPageChange,
  onStatusFilterChange,
  onSourceModuleChange,
  onSearchChange,
  onSelectEvent,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <section
      style={{
        borderRadius: 14,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      {/* Filter Toolbar */}
      <div
        style={{
          padding: 14,
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_CHIPS.map((chip) => {
            const active = statusFilter === chip.value;
            return (
              <button
                key={chip.value || 'all'}
                type="button"
                onClick={() => onStatusFilterChange(chip.value)}
                style={{
                  padding: '6px 11px',
                  borderRadius: 8,
                  border: active ? '1px solid #2563eb' : '1px solid var(--border-subtle)',
                  background: active ? 'rgba(37,99,235,0.12)' : 'transparent',
                  color: active ? '#2563eb' : 'inherit',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={sourceModuleFilter}
            onChange={(e) => onSourceModuleChange(e.target.value)}
            placeholder="Module (vd: users)"
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
              width: 145,
            }}
          />
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 9,
                top: '50%',
                transform: 'translateY(-50%)',
                opacity: 0.6,
              }}
            />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm EventType / CorrelationId / Lỗi..."
              style={{
                padding: '6px 10px 6px 28px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                fontSize: 12,
                width: 240,
              }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px' }}>ID / Event</th>
              <th style={{ padding: '10px 12px' }}>Module / Aggregate</th>
              <th style={{ padding: '10px 12px' }}>Trạng thái</th>
              <th style={{ padding: '10px 12px' }}>Thử / Replay</th>
              <th style={{ padding: '10px 12px' }}>Đích / Độ trễ</th>
              <th style={{ padding: '10px 12px' }}>Lỗi gần nhất</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading && events.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Đang tải danh sách Outbox Events...
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Chưa có bản ghi Outbox phù hợp bộ lọc.
                </td>
              </tr>
            ) : (
              events.map((evt) => {
                const badge = OUTBOX_STATUS_BADGE_STYLES[evt.statusName];
                const isSelected = selectedEventId === evt.id;
                const canQuickReplay =
                  evt.statusName === 'FAILED' || evt.statusName === 'DEAD_LETTER';

                return (
                  <tr
                    key={evt.id}
                    onClick={() => onSelectEvent(evt.id)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isSelected ? 'rgba(37,99,235,0.06)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 700 }}>
                        #{evt.id} · {evt.eventType}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {evt.dotName} · v{evt.eventVersion}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600 }}>{evt.sourceModule}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {evt.aggregateType ? `${evt.aggregateType}#${evt.aggregateId ?? '-'}` : '—'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 700,
                          background: badge.bg,
                          color: badge.color,
                          border: `1px solid ${badge.border}`,
                        }}
                      >
                        {OUTBOX_STATUS_LABELS[evt.statusName]}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                      <div>
                        {evt.attemptCount}/{evt.maxRetries}
                      </div>
                      {evt.replayCount > 0 && (
                        <div style={{ fontSize: 11, color: '#2563eb' }}>
                          Replay: {evt.replayCount}x
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontSize: 11.5, fontFamily: 'monospace' }}>
                        {evt.destinationQueue}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {evt.publishLagMs !== null
                          ? `Lag: ${evt.publishLagMs}ms`
                          : new Date(evt.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', maxWidth: 260 }}>
                      {evt.lastErrorCode ? (
                        <div style={{ color: '#dc2626', fontSize: 11.5 }}>
                          <strong>{evt.lastErrorCode}</strong>
                          <div
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={evt.lastErrorMessage ?? undefined}
                          >
                            {evt.lastErrorMessage ?? ''}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEvent(evt.id);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 9px',
                          borderRadius: 7,
                          border: '1px solid var(--border-subtle)',
                          background: canQuickReplay ? 'rgba(37,99,235,0.08)' : 'transparent',
                          color: canQuickReplay ? '#2563eb' : 'inherit',
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {canQuickReplay ? <RotateCcw size={13} /> : <Eye size={13} />}
                        {canQuickReplay ? 'Chi tiết / Replay' : 'Chi tiết'}
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
          padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          Tổng: <strong>{total}</strong> bản ghi · Trang {page}/{totalPages}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
            style={{
              padding: '5px 10px',
              borderRadius: 7,
              border: '1px solid var(--border-subtle)',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Trước
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
            style={{
              padding: '5px 10px',
              borderRadius: 7,
              border: '1px solid var(--border-subtle)',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
            }}
          >
            Sau
          </button>
        </div>
      </div>
    </section>
  );
};
