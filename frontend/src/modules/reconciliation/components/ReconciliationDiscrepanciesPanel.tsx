import React, { useState } from 'react';
import { Download, UserCheck, Wrench } from 'lucide-react';
import type {
  ReconciliationDiscrepancyItem,
  ReconciliationDiscrepancyReport,
} from '../types/reconciliation.types';

interface Props {
  report: ReconciliationDiscrepancyReport | null;
  discrepancies: readonly ReconciliationDiscrepancyItem[];
  typeFilter: string;
  severityFilter: string;
  statusFilter: string;
  searchFilter: string;
  submitting: boolean;
  onTypeFilterChange: (v: string) => void;
  onSeverityFilterChange: (v: string) => void;
  onStatusFilterChange: (v: string) => void;
  onSearchFilterChange: (v: string) => void;
  onExportCsv: () => Promise<void>;
  onAssign: (id: number, assigneeUserId: number, note?: string) => Promise<unknown>;
  onUpdateStatus: (id: number, status: string, note: string) => Promise<unknown>;
  onStartRepair: (disc: ReconciliationDiscrepancyItem) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#2563eb',
  LOW: '#64748b',
};

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  marginBottom: 16,
};

export const ReconciliationDiscrepanciesPanel: React.FC<Props> = ({
  report,
  discrepancies,
  typeFilter,
  severityFilter,
  statusFilter,
  searchFilter,
  submitting,
  onTypeFilterChange,
  onSeverityFilterChange,
  onStatusFilterChange,
  onSearchFilterChange,
  onExportCsv,
  onAssign,
  onUpdateStatus,
  onStartRepair,
}) => {
  const [assigneeInputs, setAssigneeInputs] = useState<Record<number, string>>({});

  return (
    <div>
      {report && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div style={cardStyle}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Tổng sai lệch</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{report.totalDiscrepancies}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Mở/Đã giao: {report.openCount + report.assignedCount} • Đang sửa:{' '}
              {report.inRepairCount}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Mức độ Cao / Nghiêm trọng</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#dc2626' }}>
              {(report.bySeverity.HIGH ?? 0) + (report.bySeverity.CRITICAL ?? 0)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              CRITICAL: {report.bySeverity.CRITICAL ?? 0} • HIGH: {report.bySeverity.HIGH ?? 0}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Tổng chênh lệch tuyệt đối</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {report.totalAbsAmountDiff.toLocaleString('vi-VN')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Sai tiền: {report.byType.AMOUNT_MISMATCH ?? 0} • Sai TT:{' '}
              {report.byType.STATUS_MISMATCH ?? 0}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Đã xử lý / Đã bù</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#16a34a' }}>
              {report.resolvedCount + report.compensatedCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Resolved: {report.resolvedCount} • Compensated: {report.compensatedCount}
            </div>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <select
              value={typeFilter}
              onChange={(e) => onTypeFilterChange(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'inherit', fontSize: 12 }}
            >
              <option value="">Tất cả loại sai lệch</option>
              <option value="MISSING_INTERNAL">Thiếu nội bộ</option>
              <option value="MISSING_EXTERNAL">Thiếu nguồn ngoài</option>
              <option value="DUPLICATE_INTERNAL">Trùng nội bộ</option>
              <option value="DUPLICATE_EXTERNAL">Trùng nguồn ngoài</option>
              <option value="STATUS_MISMATCH">Sai trạng thái</option>
              <option value="AMOUNT_MISMATCH">Sai số tiền</option>
              <option value="DATA_MISMATCH">Sai dữ liệu khác</option>
            </select>
            <select
              value={severityFilter}
              onChange={(e) => onSeverityFilterChange(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'inherit', fontSize: 12 }}
            >
              <option value="">Tất cả mức độ</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'inherit', fontSize: 12 }}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="OPEN">OPEN</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="IN_REPAIR">IN_REPAIR</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="COMPENSATED">COMPENSATED</option>
              <option value="IGNORED">IGNORED</option>
            </select>
            <input
              value={searchFilter}
              onChange={(e) => onSearchFilterChange(e.target.value)}
              placeholder="Tìm mã sai lệch / recordKey..."
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'inherit', fontSize: 12, minWidth: 200 }}
            />
          </div>

          <button
            type="button"
            onClick={() => void onExportCsv()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'inherit',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <Download size={14} /> Xuất báo cáo CSV
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '8px 6px' }}>Mã / Khóa bản ghi</th>
                <th style={{ padding: '8px 6px' }}>Loại sai lệch</th>
                <th style={{ padding: '8px 6px' }}>Mức độ</th>
                <th style={{ padding: '8px 6px' }}>Trạng thái Nội bộ / Ngoài</th>
                <th style={{ padding: '8px 6px' }}>Số tiền Nội bộ / Ngoài (Lệch)</th>
                <th style={{ padding: '8px 6px' }}>Phụ trách</th>
                <th style={{ padding: '8px 6px' }}>Xử lý</th>
              </tr>
            </thead>
            <tbody>
              {discrepancies.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Không có sai lệch phù hợp bộ lọc.
                  </td>
                </tr>
              ) : (
                discrepancies.map((d) => {
                  const assigneeVal =
                    assigneeInputs[d.id] ?? (d.assigneeUserId ? String(d.assigneeUserId) : '');
                  return (
                    <tr key={d.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 6px' }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{d.discrepancyCode}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          Key: <strong>{d.recordKey}</strong> ({d.targetModule})
                        </div>
                      </td>
                      <td style={{ padding: '8px 6px', fontWeight: 600 }}>{d.discrepancyTypeName}</td>
                      <td style={{ padding: '8px 6px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 99,
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#fff',
                            background: SEVERITY_COLORS[d.severityName] ?? '#64748b',
                          }}
                        >
                          {d.severityName}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px', fontSize: 11.5 }}>
                        {d.internalStatus ?? '—'} / {d.externalStatus ?? '—'}
                        <div style={{ color: 'var(--text-muted)' }}>Trạng thái: {d.statusName}</div>
                      </td>
                      <td style={{ padding: '8px 6px', fontSize: 11.5 }}>
                        {d.internalAmount !== null ? d.internalAmount.toLocaleString('vi-VN') : '—'} /{' '}
                        {d.externalAmount !== null ? d.externalAmount.toLocaleString('vi-VN') : '—'}
                        {d.amountDiff !== null && d.amountDiff !== 0 && (
                          <div style={{ color: '#dc2626', fontWeight: 700 }}>
                            Δ {d.amountDiff.toLocaleString('vi-VN')} {d.currency ?? ''}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            type="number"
                            min={1}
                            placeholder="User ID"
                            value={assigneeVal}
                            onChange={(e) =>
                              setAssigneeInputs((prev) => ({ ...prev, [d.id]: e.target.value }))
                            }
                            style={{
                              width: 72,
                              padding: '4px 6px',
                              borderRadius: 6,
                              border: '1px solid var(--border-subtle)',
                              background: 'var(--bg-surface)',
                              color: 'inherit',
                              fontSize: 11.5,
                            }}
                          />
                          <button
                            type="button"
                            disabled={submitting || !assigneeVal}
                            onClick={() => void onAssign(d.id, Number(assigneeVal))}
                            title="Giao người phụ trách"
                            style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              border: '1px solid var(--border-subtle)',
                              background: 'var(--bg-surface)',
                              color: 'inherit',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            <UserCheck size={13} />
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => onStartRepair(d)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '5px 8px',
                              borderRadius: 6,
                              border: 'none',
                              background: '#2563eb',
                              color: '#fff',
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <Wrench size={12} /> Sửa / Bù
                          </button>
                          {d.statusName !== 'IGNORED' && d.statusName !== 'RESOLVED' && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() =>
                                void onUpdateStatus(d.id, 'IGNORED', 'Ignored after verification')
                              }
                              style={{
                                padding: '5px 8px',
                                borderRadius: 6,
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--bg-surface)',
                                color: 'inherit',
                                fontSize: 11.5,
                                cursor: 'pointer',
                              }}
                            >
                              Bỏ qua
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
