import React, { useState } from 'react';
import { Play, Plus } from 'lucide-react';
import type {
  ReconciliationAdapterMetadata,
  ReconciliationJobItem,
  ReconciliationRunItem,
} from '../types/reconciliation.types';

interface Props {
  adapters: readonly ReconciliationAdapterMetadata[];
  jobs: readonly ReconciliationJobItem[];
  runs: readonly ReconciliationRunItem[];
  submitting: boolean;
  onCreateJob: (payload: Record<string, unknown>) => Promise<unknown>;
  onTriggerRun: (jobId: number, payload: Record<string, unknown>) => Promise<unknown>;
}

const SAMPLE_INTERNAL_CSV = [
  'recordKey,status,amount,currency',
  'ORD-1001,SUCCEEDED,500000,VND',
  'ORD-1002,PENDING,1500000,VND',
  'ORD-1003,SUCCEEDED,2000000,VND',
  'ORD-1004,SUCCEEDED,800000,VND',
  'ORD-1005,SUCCEEDED,300000,VND',
  'ORD-1005,SUCCEEDED,300000,VND',
].join('\n');

const SAMPLE_EXTERNAL_CSV = [
  'recordKey,status,amount,currency',
  'ORD-1001,SUCCEEDED,500000,VND',
  'ORD-1002,SUCCEEDED,1500000,VND',
  'ORD-1003,SUCCEEDED,1800000,VND',
  'ORD-1006,SUCCEEDED,1200000,VND',
  'ORD-1005,SUCCEEDED,300000,VND',
].join('\n');

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  marginBottom: 16,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
  color: 'inherit',
  fontSize: 12.5,
  boxSizing: 'border-box',
};

export const ReconciliationJobsPanel: React.FC<Props> = ({
  adapters,
  jobs,
  runs,
  submitting,
  onCreateJob,
  onTriggerRun,
}) => {
  const [name, setName] = useState('Đối soát đơn hàng & sao kê đối tác');
  const [adapterCode, setAdapterCode] = useState('generic-dataset');
  const [scheduleCron, setScheduleCron] = useState('0 2 * * *');
  const [defaultAssigneeUserId, setDefaultAssigneeUserId] = useState('1');

  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [runReason, setRunReason] = useState('Chạy đối soát thủ công kiểm tra dữ liệu kỳ hiện tại');
  const [internalCsv, setInternalCsv] = useState(SAMPLE_INTERNAL_CSV);
  const [externalCsv, setExternalCsv] = useState(SAMPLE_EXTERNAL_CSV);

  const effectiveJobId = selectedJobId || (jobs[0] ? String(jobs[0].id) : '');
  const selectedJob = jobs.find((j) => String(j.id) === effectiveJobId);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreateJob({
      name: name.trim(),
      adapterCode,
      scheduleCron: scheduleCron.trim() || null,
      defaultAssigneeUserId: defaultAssigneeUserId.trim() ? Number(defaultAssigneeUserId) : null,
      isEnabled: true,
    });
  };

  const handleManualRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveJobId) return;
    const payload: Record<string, unknown> = {
      reason: runReason.trim() || 'Manual reconciliation run',
      externalCsv: externalCsv.trim() || undefined,
    };
    if (selectedJob?.adapterCode === 'generic-dataset' && internalCsv.trim()) {
      payload.internalCsv = internalCsv.trim();
    }
    await onTriggerRun(Number(effectiveJobId), payload);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <form onSubmit={(e) => void handleCreateJob(e)} style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>
            Tạo cấu hình Job đối soát
          </h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ fontSize: 12 }}>
              Tên Job
              <input
                style={{ ...inputStyle, marginTop: 4 }}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Source Adapter
              <select
                style={{ ...inputStyle, marginTop: 4 }}
                value={adapterCode}
                onChange={(e) => setAdapterCode(e.target.value)}
              >
                {adapters.length === 0 ? (
                  <>
                    <option value="generic-dataset">generic-dataset — Generic Dataset (JSON/CSV)</option>
                    <option value="payments-bridge">payments-bridge — Payments Module Bridge</option>
                  </>
                ) : (
                  adapters.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ fontSize: 12 }}>
                Lịch Cron (tùy chọn)
                <input
                  style={{ ...inputStyle, marginTop: 4 }}
                  value={scheduleCron}
                  onChange={(e) => setScheduleCron(e.target.value)}
                  placeholder="0 2 * * *"
                />
              </label>
              <label style={{ fontSize: 12 }}>
                User ID phụ trách mặc định
                <input
                  style={{ ...inputStyle, marginTop: 4 }}
                  type="number"
                  min={1}
                  value={defaultAssigneeUserId}
                  onChange={(e) => setDefaultAssigneeUserId(e.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={submitting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 700,
                fontSize: 12.5,
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              <Plus size={14} /> Tạo Job đối soát
            </button>
          </div>
        </form>

        <form onSubmit={(e) => void handleManualRun(e)} style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>
            Chạy đối soát thủ công (có quyền &amp; Audit)
          </h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ fontSize: 12 }}>
              Chọn Job
              <select
                style={{ ...inputStyle, marginTop: 4 }}
                value={effectiveJobId}
                onChange={(e) => setSelectedJobId(e.target.value)}
                disabled={jobs.length === 0}
              >
                {jobs.length === 0 ? (
                  <option value="">— Chưa có Job, hãy tạo Job trước —</option>
                ) : (
                  jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      [{j.jobCode}] {j.name} ({j.adapterCode})
                    </option>
                  ))
                )}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              Lý do chạy đối soát (ghi Audit Log)
              <input
                style={{ ...inputStyle, marginTop: 4 }}
                value={runReason}
                onChange={(e) => setRunReason(e.target.value)}
                required
              />
            </label>
            {selectedJob?.adapterCode !== 'payments-bridge' && (
              <label style={{ fontSize: 12 }}>
                Dữ liệu Nội bộ (CSV mẫu — gồm cả bản ghi trùng để kiểm thử)
                <textarea
                  rows={4}
                  style={{ ...inputStyle, marginTop: 4, fontFamily: 'monospace', fontSize: 11.5 }}
                  value={internalCsv}
                  onChange={(e) => setInternalCsv(e.target.value)}
                />
              </label>
            )}
            <label style={{ fontSize: 12 }}>
              Dữ liệu Nguồn ngoài / Sao kê (CSV)
              <textarea
                rows={4}
                style={{ ...inputStyle, marginTop: 4, fontFamily: 'monospace', fontSize: 11.5 }}
                value={externalCsv}
                onChange={(e) => setExternalCsv(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={submitting || !effectiveJobId}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#059669',
                color: '#fff',
                fontWeight: 700,
                fontSize: 12.5,
                cursor: submitting || !effectiveJobId ? 'not-allowed' : 'pointer',
              }}
            >
              <Play size={14} /> Chạy đối soát ngay
            </button>
          </div>
        </form>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>
          Lịch sử phiên đối soát gần đây ({runs.length})
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '8px 6px' }}>Mã phiên</th>
                <th style={{ padding: '8px 6px' }}>Job / Adapter</th>
                <th style={{ padding: '8px 6px' }}>Chế độ</th>
                <th style={{ padding: '8px 6px' }}>Trạng thái</th>
                <th style={{ padding: '8px 6px' }}>Nội bộ / Ngoài</th>
                <th style={{ padding: '8px 6px' }}>Khớp / Lệch</th>
                <th style={{ padding: '8px 6px' }}>Phân loại (Thiếu/Trùng/TT/Tiền)</th>
                <th style={{ padding: '8px 6px' }}>Lệch tiền</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có phiên đối soát nào.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontWeight: 700 }}>
                      {r.runCode}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <div>{r.jobCode}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.adapterCode}</div>
                    </td>
                    <td style={{ padding: '8px 6px' }}>{r.triggerMode}</td>
                    <td style={{ padding: '8px 6px', fontWeight: 700 }}>{r.statusName}</td>
                    <td style={{ padding: '8px 6px' }}>
                      {r.totalInternalCount} / {r.totalExternalCount}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>{r.matchedCount}</span> /{' '}
                      <span style={{ color: r.discrepancyCount > 0 ? '#dc2626' : 'inherit', fontWeight: 700 }}>
                        {r.discrepancyCount}
                      </span>
                    </td>
                    <td style={{ padding: '8px 6px', fontSize: 11.5 }}>
                      Thiếu: {r.missingInternalCount + r.missingExternalCount} • Trùng:{' '}
                      {r.duplicateCount} • TT: {r.statusMismatchCount} • Tiền:{' '}
                      {r.amountMismatchCount}
                    </td>
                    <td style={{ padding: '8px 6px', fontWeight: 700 }}>
                      {r.amountDiffTotal.toLocaleString('vi-VN')} {r.currency ?? ''}
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
