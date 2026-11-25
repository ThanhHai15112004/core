import React, { useEffect, useState } from 'react';
import { Check, Eye, Play, RotateCcw, Send, ShieldAlert, X } from 'lucide-react';
import type {
  DataRepairHandlerMetadata,
  DataRepairPreviewOutcome,
  DataRepairRequestItem,
  ReconciliationDiscrepancyItem,
} from '../types/reconciliation.types';

interface Props {
  handlers: readonly DataRepairHandlerMetadata[];
  repairs: readonly DataRepairRequestItem[];
  selectedRepair: DataRepairRequestItem | null;
  selectedDiscrepancy: ReconciliationDiscrepancyItem | null;
  lastPreview: DataRepairPreviewOutcome | null;
  submitting: boolean;
  onClearDiscrepancy: () => void;
  onPreview: (payload: Record<string, unknown>) => Promise<unknown>;
  onPropose: (payload: Record<string, unknown>) => Promise<unknown>;
  onSelectRepair: (id: number) => Promise<void>;
  onApprove: (id: number, note?: string) => Promise<unknown>;
  onReject: (id: number, note?: string) => Promise<unknown>;
  onApply: (id: number) => Promise<unknown>;
  onProposeCompensation: (parentId: number, payload: Record<string, unknown>) => Promise<unknown>;
}

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

export const DataRepairPanel: React.FC<Props> = ({
  handlers,
  repairs,
  selectedRepair,
  selectedDiscrepancy,
  lastPreview,
  submitting,
  onClearDiscrepancy,
  onPreview,
  onPropose,
  onSelectRepair,
  onApprove,
  onReject,
  onApply,
  onProposeCompensation,
}) => {
  const [handlerCode, setHandlerCode] = useState('generic-dataset-repair');
  const [actionMode, setActionMode] = useState<'DIRECT_REPAIR' | 'COMPENSATING_ACTION'>(
    'DIRECT_REPAIR',
  );
  const [targetEntityId, setTargetEntityId] = useState('ORD-1002');
  const [compensationType, setCompensationType] = useState('ADJUSTMENT_ENTRY');
  const [payloadText, setPayloadText] = useState(
    JSON.stringify({ syncFromExternal: true, status: 'SUCCEEDED' }, null, 2),
  );
  const [reason, setReason] = useState('Đồng bộ dữ liệu sau khi đối soát với nguồn ngoài');
  const [approvalNote, setApprovalNote] = useState('');
  const [compReason, setCompReason] = useState('Tạo bút toán bù do giao dịch gốc không thể rollback');

  useEffect(() => {
    if (selectedDiscrepancy) {
      setTargetEntityId(selectedDiscrepancy.entityId || selectedDiscrepancy.recordKey);
      setHandlerCode(
        selectedDiscrepancy.targetModule === 'payments'
          ? 'payments-bridge-repair'
          : 'generic-dataset-repair',
      );
      setActionMode(
        selectedDiscrepancy.discrepancyTypeName === 'AMOUNT_MISMATCH' ||
          selectedDiscrepancy.targetModule === 'payments'
          ? 'COMPENSATING_ACTION'
          : 'DIRECT_REPAIR',
      );
      setPayloadText(
        JSON.stringify(
          {
            syncFromExternal: true,
            ...(selectedDiscrepancy.externalStatus
              ? { status: selectedDiscrepancy.externalStatus }
              : {}),
            ...(selectedDiscrepancy.amountDiff
              ? { adjustmentAmount: -selectedDiscrepancy.amountDiff }
              : {}),
          },
          null,
          2,
        ),
      );
      setReason(`Xử lý sai lệch ${selectedDiscrepancy.discrepancyCode} (${selectedDiscrepancy.recordKey})`);
    }
  }, [selectedDiscrepancy]);

  const buildRepairPayload = (): Record<string, unknown> | null => {
    try {
      const parsedPayload = payloadText.trim() ? JSON.parse(payloadText) : {};
      return {
        ...(selectedDiscrepancy ? { discrepancyId: selectedDiscrepancy.id } : {}),
        actionMode,
        handlerCode,
        targetEntityId: targetEntityId.trim(),
        ...(actionMode === 'COMPENSATING_ACTION' ? { compensationType } : {}),
        payload: parsedPayload,
        reason: reason.trim(),
      };
    } catch {
      return null;
    }
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Công cụ Sửa dữ liệu (Dry-Run trước khi ghi)
            </h3>
            {selectedDiscrepancy && (
              <button
                type="button"
                onClick={onClearDiscrepancy}
                style={{ fontSize: 11.5, background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer' }}
              >
                Gắn sai lệch: {selectedDiscrepancy.discrepancyCode} ✕
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ fontSize: 12 }}>
                Repair Handler
                <select
                  style={{ ...inputStyle, marginTop: 4 }}
                  value={handlerCode}
                  onChange={(e) => setHandlerCode(e.target.value)}
                >
                  {handlers.length === 0 ? (
                    <>
                      <option value="generic-dataset-repair">generic-dataset-repair</option>
                      <option value="payments-bridge-repair">payments-bridge-repair</option>
                    </>
                  ) : (
                    handlers.map((h) => (
                      <option key={h.code} value={h.code}>
                        {h.code} {h.alwaysSensitive ? '(Nhạy cảm)' : ''}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Chế độ xử lý
                <select
                  style={{ ...inputStyle, marginTop: 4 }}
                  value={actionMode}
                  onChange={(e) =>
                    setActionMode(e.target.value as 'DIRECT_REPAIR' | 'COMPENSATING_ACTION')
                  }
                >
                  <option value="DIRECT_REPAIR">DIRECT_REPAIR (Sửa trực tiếp)</option>
                  <option value="COMPENSATING_ACTION">COMPENSATING_ACTION (Hành động bù)</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ fontSize: 12 }}>
                Đối tượng đích (Entity ID / Record Key)
                <input
                  style={{ ...inputStyle, marginTop: 4 }}
                  value={targetEntityId}
                  onChange={(e) => setTargetEntityId(e.target.value)}
                />
              </label>
              {actionMode === 'COMPENSATING_ACTION' && (
                <label style={{ fontSize: 12 }}>
                  Loại hành động bù
                  <select
                    style={{ ...inputStyle, marginTop: 4 }}
                    value={compensationType}
                    onChange={(e) => setCompensationType(e.target.value)}
                  >
                    <option value="ADJUSTMENT_ENTRY">ADJUSTMENT_ENTRY (Bút toán điều chỉnh)</option>
                    <option value="CREDIT_NOTE">CREDIT_NOTE</option>
                    <option value="DEBIT_NOTE">DEBIT_NOTE</option>
                    <option value="REFUND_COMPENSATION">REFUND_COMPENSATION (Hoàn tiền bù)</option>
                    <option value="MANUAL_REBOOK">MANUAL_REBOOK</option>
                  </select>
                </label>
              )}
            </div>

            <label style={{ fontSize: 12 }}>
              Payload sửa / bù (JSON)
              <textarea
                rows={4}
                style={{ ...inputStyle, marginTop: 4, fontFamily: 'monospace', fontSize: 11.5 }}
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
              />
            </label>

            <label style={{ fontSize: 12 }}>
              Lý do (lưu Audit Log)
              <input
                style={{ ...inputStyle, marginTop: 4 }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  const p = buildRepairPayload();
                  if (p) void onPreview(p);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  color: 'inherit',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <Eye size={14} /> Chạy thử Dry-Run
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  const p = buildRepairPayload();
                  if (p) void onPropose(p);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <Send size={14} /> Tạo đề xuất sửa (kèm Dry-Run)
              </button>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>
            Kết quả xem trước Dry-Run (Trước / Sau)
          </h3>
          {!lastPreview ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Nhấn <strong>Chạy thử Dry-Run</strong> để xem trước bản ghi Trước/Sau, danh sách trường
              thay đổi và kiểm tra có cần duyệt Maker-Checker hay không.
            </p>
          ) : (
            <div style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 8, fontWeight: 700 }}>{lastPreview.summary}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 99,
                    fontWeight: 700,
                    background: lastPreview.isSensitive ? 'rgba(220,38,38,0.12)' : 'rgba(22,163,74,0.12)',
                    color: lastPreview.isSensitive ? '#dc2626' : '#15803d',
                  }}
                >
                  {lastPreview.isSensitive ? 'Nhạy cảm — Cần duyệt 2 lớp' : 'Thông thường'}
                </span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 99,
                    background: 'rgba(100,116,139,0.12)',
                  }}
                >
                  Rollback: {lastPreview.canRollback ? 'Hỗ trợ' : 'Không — Dùng hành động bù'}
                </span>
              </div>
              {lastPreview.sensitivityReasons.length > 0 && (
                <div style={{ marginBottom: 10, color: '#b45309' }}>
                  <ShieldAlert size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {lastPreview.sensitivityReasons.join(' • ')}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Trước (Before)</div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      borderRadius: 8,
                      background: 'rgba(148,163,184,0.1)',
                      overflow: 'auto',
                      maxHeight: 170,
                      fontSize: 11,
                    }}
                  >
                    {JSON.stringify(lastPreview.beforeSnapshot, null, 2)}
                  </pre>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Dự kiến Sau (Predicted After)</div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      borderRadius: 8,
                      background: 'rgba(22,163,74,0.08)',
                      overflow: 'auto',
                      maxHeight: 170,
                      fontSize: 11,
                    }}
                  >
                    {JSON.stringify(lastPreview.predictedAfterSnapshot, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>
          Danh sách yêu cầu sửa dữ liệu &amp; phê duyệt Maker-Checker ({repairs.length})
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '8px 6px' }}>Mã lệnh</th>
                <th style={{ padding: '8px 6px' }}>Chế độ / Đích</th>
                <th style={{ padding: '8px 6px' }}>Nhạy cảm</th>
                <th style={{ padding: '8px 6px' }}>Trạng thái</th>
                <th style={{ padding: '8px 6px' }}>Đề xuất / Duyệt / Thực thi</th>
                <th style={{ padding: '8px 6px' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {repairs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có yêu cầu sửa dữ liệu nào.
                  </td>
                </tr>
              ) : (
                repairs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => void onSelectRepair(r.id)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      background: selectedRepair?.id === r.id ? 'rgba(37,99,235,0.06)' : undefined,
                    }}
                  >
                    <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontWeight: 700 }}>
                      {r.repairCode}
                      {r.parentRepairId && (
                        <div style={{ fontSize: 11, color: '#7c3aed' }}>
                          Bù cho lệnh #{r.parentRepairId}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <div style={{ fontWeight: 600 }}>{r.actionMode}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        {r.targetEntityType}: {r.targetEntityId}
                      </div>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      {r.isSensitive ? (
                        <span style={{ color: '#dc2626', fontWeight: 700 }}>Nhạy cảm</span>
                      ) : (
                        'Thường'
                      )}
                    </td>
                    <td style={{ padding: '8px 6px', fontWeight: 700 }}>{r.statusName}</td>
                    <td style={{ padding: '8px 6px', fontSize: 11.5 }}>
                      Maker: #{r.requestedBy ?? '—'} • Checker: #{r.approvedBy ?? r.rejectedBy ?? '—'} •
                      Apply: #{r.executedBy ?? '—'}
                    </td>
                    <td style={{ padding: '8px 6px' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.statusName === 'PENDING_APPROVAL' && (
                          <>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void onApprove(r.id, approvalNote || undefined)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 8px',
                                borderRadius: 6,
                                border: 'none',
                                background: '#16a34a',
                                color: '#fff',
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              <Check size={12} /> Duyệt
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void onReject(r.id, approvalNote || undefined)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 8px',
                                borderRadius: 6,
                                border: 'none',
                                background: '#dc2626',
                                color: '#fff',
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              <X size={12} /> Từ chối
                            </button>
                          </>
                        )}
                        {(r.statusName === 'APPROVED' ||
                          (!r.isSensitive && r.statusName === 'DRAFT_PREVIEW')) && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => void onApply(r.id)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '4px 8px',
                              borderRadius: 6,
                              border: 'none',
                              background: '#2563eb',
                              color: '#fff',
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <Play size={12} /> Thực thi (Apply)
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRepair && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Chi tiết &amp; Dữ liệu Trước/Sau — {selectedRepair.repairCode} ({selectedRepair.statusName})
            </h3>
            {selectedRepair.statusName === 'PENDING_APPROVAL' && (
              <input
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                placeholder="Ghi chú duyệt / từ chối..."
                style={{ ...inputStyle, width: 260 }}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Snapshot Trước khi sửa</div>
              <pre style={{ margin: 0, padding: 10, borderRadius: 8, background: 'rgba(148,163,184,0.1)', fontSize: 11, overflow: 'auto', maxHeight: 180 }}>
                {JSON.stringify(selectedRepair.beforeSnapshot, null, 2)}
              </pre>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Snapshot Sau khi sửa</div>
              <pre style={{ margin: 0, padding: 10, borderRadius: 8, background: 'rgba(22,163,74,0.08)', fontSize: 11, overflow: 'auto', maxHeight: 180 }}>
                {JSON.stringify(selectedRepair.afterSnapshot, null, 2)}
              </pre>
            </div>
          </div>

          {(selectedRepair.statusName === 'EXECUTED' || !selectedRepair.canRollback) && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: 'rgba(124,58,237,0.06)',
                border: '1px solid rgba(124,58,237,0.25)',
                marginBottom: 12,
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <strong style={{ fontSize: 12 }}>Hành động bù (không rollback / giữ lịch sử):</strong>
              <input
                value={compReason}
                onChange={(e) => setCompReason(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 220 }}
              />
              <button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void onProposeCompensation(selectedRepair.id, {
                    compensationType: 'ADJUSTMENT_ENTRY',
                    reason: compReason.trim() || 'Compensating adjustment entry',
                    payload: { adjustmentAmount: 0 },
                  })
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#7c3aed',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={13} /> Tạo hành động bù mới
              </button>
            </div>
          )}

          {selectedRepair.executions && selectedRepair.executions.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Nhật ký thực thi bất biến ({selectedRepair.executions.length})
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {selectedRepair.executions.map((ex) => (
                  <div
                    key={ex.id}
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 11.5,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong>{ex.executionMode}</strong> • {ex.executionStatus} • {ex.summary}
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      Actor #{ex.actorUserId ?? 'system'} • {ex.durationMs}ms •{' '}
                      {new Date(ex.executedAt).toLocaleString('vi-VN')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
