import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import type {
  StartWorkflowInstancePayload,
  WorkflowDefinitionItem,
  WorkflowInstanceDetail,
  WorkflowInstanceItem,
  WorkflowSlaScanResult,
} from '../types/workflows.types';

interface WorkflowInstancesTabProps {
  readonly definitions: readonly WorkflowDefinitionItem[];
  readonly instances: readonly WorkflowInstanceItem[];
  readonly selectedInstance: WorkflowInstanceDetail | null;
  readonly lastSlaScanResult: WorkflowSlaScanResult | null;
  readonly submitting: boolean;
  readonly onSelectInstance: (id: number) => Promise<void>;
  readonly onStartInstance: (payload: StartWorkflowInstancePayload) => Promise<boolean>;
  readonly onExecuteTransition: (
    instanceId: number,
    transitionCode: string,
    reason?: string | null,
    contextDataPatch?: Record<string, unknown>,
  ) => Promise<void>;
  readonly onDecideApproval: (
    instanceId: number,
    decision: 'APPROVED' | 'REJECTED' | 'RETURNED',
    comment?: string | null,
  ) => Promise<void>;
  readonly onCancelInstance: (
    instanceId: number,
    reason: string,
    action?: 'CANCEL' | 'TERMINATE',
  ) => Promise<void>;
  readonly onScanSlaOverdue: () => Promise<void>;
}

export const WorkflowInstancesTab: React.FC<WorkflowInstancesTabProps> = ({
  definitions,
  instances,
  selectedInstance,
  lastSlaScanResult,
  submitting,
  onSelectInstance,
  onStartInstance,
  onExecuteTransition,
  onDecideApproval,
  onCancelInstance,
  onScanSlaOverdue,
}) => {
  const [workflowCode, setWorkflowCode] = useState(
    definitions[0]?.code ?? 'LEAVE_APPROVAL',
  );
  const [entityType, setEntityType] = useState('leave_request');
  const [entityId, setEntityId] = useState('LR-2026-001');
  const [title, setTitle] = useState('Đơn xin nghỉ phép 3 ngày — Nguyễn Văn Hải');
  const [contextFieldKey, setContextFieldKey] = useState('days');
  const [contextFieldValue, setContextFieldValue] = useState('3');
  const [dueHoursOverride, setDueHoursOverride] = useState('');

  const [transitionReason, setTransitionReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericVal = Number(contextFieldValue);
    const contextData = contextFieldKey.trim()
      ? {
          [contextFieldKey.trim()]:
            contextFieldValue.trim() !== '' && !Number.isNaN(numericVal)
              ? numericVal
              : contextFieldValue.trim(),
        }
      : {};

    const ok = await onStartInstance({
      workflowCode,
      entityType: entityType.trim(),
      entityId: entityId.trim(),
      title: title.trim(),
      contextData,
      dueHoursOverride: dueHoursOverride ? Number(dueHoursOverride) : null,
    });
    if (ok) {
      setEntityId(`LR-2026-${Math.floor(100 + Math.random() * 900)}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Section 9.3.5 & 9.3.8: Start Workflow for Business Record + SLA Scanner */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: '16px',
        }}
      >
        <form onSubmit={(e) => void handleStart(e)} style={authStyles.cardHighlighted}>
          <h3 style={authStyles.sectionTitle}>
            <Play size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Mục 9.3.5 — Khởi tạo Quy trình cho một Bản ghi Nghiệp vụ
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: '10px',
              alignItems: 'end',
            }}
          >
            <div>
              <label style={authStyles.label}>Chọn Quy trình *</label>
              <select
                value={workflowCode}
                onChange={(e) => {
                  setWorkflowCode(e.target.value);
                  const found = definitions.find((d) => d.code === e.target.value);
                  if (found) setEntityType(found.targetEntityType);
                }}
                style={authStyles.input}
              >
                {definitions.map((d) => (
                  <option key={d.id} value={d.code}>
                    {d.name} ({d.code} v{d.version})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={authStyles.label}>Loại đối tượng (Entity Type) *</label>
              <input
                type="text"
                required
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Mã bản ghi (Entity ID) *</label>
              <input
                type="text"
                required
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Tiêu đề hồ sơ *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Dữ liệu xét điều kiện (Key = Value)</label>
              <div style={{ display: 'flex', gap: '4px' }}>
                <input
                  type="text"
                  value={contextFieldKey}
                  onChange={(e) => setContextFieldKey(e.target.value)}
                  placeholder="days"
                  style={{ ...authStyles.monoInput, width: '50%' }}
                />
                <input
                  type="text"
                  value={contextFieldValue}
                  onChange={(e) => setContextFieldValue(e.target.value)}
                  placeholder="3"
                  style={{ ...authStyles.monoInput, width: '50%' }}
                />
              </div>
            </div>
            <div>
              <label style={authStyles.label}>Thời hạn SLA (Giờ — Tùy chọn)</label>
              <input
                type="number"
                min={1}
                max={720}
                value={dueHoursOverride}
                onChange={(e) => setDueHoursOverride(e.target.value)}
                placeholder="Mặc định theo quy trình"
                style={authStyles.input}
              />
            </div>
          </div>
          <div style={{ marginTop: '12px' }}>
            <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
              <Play size={15} /> Khởi tạo Quy trình cho Bản ghi
            </button>
          </div>
        </form>

        {/* Section 9.3.8: SLA & Overdue Scheduler Monitor */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <Clock size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Mục 9.3.8 — Thời hạn SLA & Quét Quá hạn (Scheduler)
          </h3>
          <p style={authStyles.sectionDesc}>
            Tác vụ định kỳ <code>workflows.sla.scan</code> tự động quét các quy trình đang chạy và
            gửi thông báo cảnh báo sắp quá hạn / quá hạn.
          </p>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void onScanSlaOverdue()}
            style={authStyles.btnTeal}
          >
            <Clock size={14} /> Quét Thời hạn & Cảnh báo Quá hạn ngay
          </button>

          {lastSlaScanResult && (
            <div
              style={{
                marginTop: '10px',
                padding: '10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-input)',
                fontSize: '12px',
              }}
            >
              <div>
                Đã kiểm tra: <strong>{lastSlaScanResult.totalRunningChecked}</strong> quy trình đang
                chạy
              </div>
              <div>
                Cảnh báo sắp hết hạn:{' '}
                <strong>{lastSlaScanResult.warningsTriggeredCount}</strong> · Đánh dấu quá hạn:{' '}
                <strong>{lastSlaScanResult.overdueMarkedCount}</strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Split View: Instances List & Selected Instance Inspector */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.15fr 1.35fr',
          gap: '16px',
        }}
      >
        {/* Left: Instances Table */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            Danh sách Quy trình Bản ghi ({instances.length})
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>ID & Bản ghi</th>
                  <th style={authStyles.tableHeaderCell}>Quy trình</th>
                  <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                  <th style={authStyles.tableHeaderCell}>Thời hạn SLA</th>
                </tr>
              </thead>
              <tbody>
                {instances.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        ...authStyles.tableCell,
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Chưa có quy trình nào. Hãy khởi tạo ở khung phía trên.
                    </td>
                  </tr>
                ) : (
                  instances.map((item) => {
                    const isSelected = selectedInstance?.id === item.id;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => void onSelectInstance(item.id)}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? 'var(--bg-light-blue)' : 'transparent',
                        }}
                      >
                        <td style={authStyles.tableCell}>
                          <div style={{ fontWeight: 700, fontSize: '13px' }}>
                            #{item.id} · {item.title}
                          </div>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                            <code>
                              {item.entityType}#{item.entityId}
                            </code>
                          </div>
                        </td>
                        <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                          <code>{item.workflowCode}</code> (v{item.workflowVersion})
                        </td>
                        <td style={authStyles.tableCell}>
                          <span
                            style={
                              item.statusName === 'COMPLETED'
                                ? authStyles.badgeSuccess
                                : item.statusName === 'REJECTED' || item.statusName === 'CANCELLED'
                                  ? authStyles.badgeDanger
                                  : authStyles.badgePrimary
                            }
                          >
                            {item.currentStateCode} ({item.statusName})
                          </span>
                        </td>
                        <td style={{ ...authStyles.tableCell, fontSize: '11.5px' }}>
                          {item.isOverdue ? (
                            <span style={authStyles.badgeDanger}>
                              <AlertTriangle size={11} /> Quá hạn SLA
                            </span>
                          ) : item.dueAt ? (
                            new Date(item.dueAt).toLocaleString('vi-VN')
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Instance Execution, Approvals, Cancel & Full History (9.3.3 – 9.3.7 & 9.4) */}
        <div style={authStyles.card}>
          {!selectedInstance ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Chọn một quy trình bên trái để thực hiện chuyển trạng thái, phê duyệt hoặc xem lịch
              sử.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <h3 style={{ ...authStyles.sectionTitle, marginBottom: 0 }}>
                    Quy trình #{selectedInstance.id}: {selectedInstance.title}
                  </h3>
                  <span style={authStyles.badgePrimary}>
                    Trạng thái hiện tại: {selectedInstance.currentStateCode}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Đối tượng:{' '}
                  <code>
                    {selectedInstance.entityType}#{selectedInstance.entityId}
                  </code>{' '}
                  · Dữ liệu ngữ cảnh:{' '}
                  <code>{JSON.stringify(selectedInstance.contextData)}</code>
                </div>
              </div>

              {/* Available Transitions & Approval Actions */}
              {selectedInstance.statusName === 'RUNNING' && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-input)',
                  }}
                >
                  <label style={authStyles.label}>
                    Lý do / Ý kiến xử lý (dùng cho bước chuyển, phê duyệt hoặc từ chối)
                  </label>
                  <input
                    type="text"
                    value={transitionReason}
                    onChange={(e) => setTransitionReason(e.target.value)}
                    placeholder="Nhập ghi chú hoặc lý do..."
                    style={{ ...authStyles.input, marginBottom: '10px' }}
                  />

                  <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
                    Các bước chuyển trạng thái từ <code>{selectedInstance.currentStateCode}</code>{' '}
                    (Mục 9.3.3 & 9.3.4):
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {selectedInstance.availableTransitions.map((tr) => (
                      <button
                        key={tr.code}
                        type="button"
                        disabled={submitting || !tr.allowed}
                        title={
                          tr.allowed
                            ? `Chuyển sang ${tr.toStateCode}`
                            : tr.blockedReasons.join('; ')
                        }
                        onClick={() => {
                          void onExecuteTransition(
                            selectedInstance.id,
                            tr.code,
                            transitionReason || null,
                          );
                          setTransitionReason('');
                        }}
                        style={tr.allowed ? authStyles.btnPrimary : authStyles.btnSecondary}
                      >
                        {tr.name} ({tr.fromStateCode} → {tr.toStateCode})
                      </button>
                    ))}
                  </div>

                  {/* Quick Approval Buttons when Approval Steps exist */}
                  {selectedInstance.approvalSteps.some((s) => s.decision === 'PENDING') && (
                    <div
                      style={{
                        marginTop: '12px',
                        paddingTop: '10px',
                        borderTop: '1px dashed var(--border-color)',
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 700 }}>
                        Phê duyệt nhanh tại bước hiện tại:
                      </span>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          void onDecideApproval(
                            selectedInstance.id,
                            'APPROVED',
                            transitionReason || 'Đồng ý phê duyệt',
                          )
                        }
                        style={authStyles.btnTeal}
                      >
                        <CheckCircle2 size={14} /> Phê duyệt (Approve)
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          void onDecideApproval(
                            selectedInstance.id,
                            'RETURNED',
                            transitionReason || 'Yêu cầu bổ sung hồ sơ',
                          )
                        }
                        style={authStyles.btnSecondary}
                      >
                        <RotateCcw size={14} /> Trả lại (Return)
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          void onDecideApproval(
                            selectedInstance.id,
                            'REJECTED',
                            transitionReason || 'Từ chối phê duyệt',
                          )
                        }
                        style={authStyles.btnDanger}
                      >
                        <XCircle size={14} /> Từ chối (Reject)
                      </button>
                    </div>
                  )}

                  {/* Section 9.3.6: Cancel or Terminate Workflow */}
                  <div
                    style={{
                      marginTop: '12px',
                      paddingTop: '10px',
                      borderTop: '1px dashed var(--border-color)',
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                    }}
                  >
                    <input
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Lý do hủy / kết thúc quy trình (Mục 9.3.6)..."
                      style={{ ...authStyles.input, flex: 1 }}
                    />
                    <button
                      type="button"
                      disabled={submitting || cancelReason.trim().length < 2}
                      onClick={() => {
                        void onCancelInstance(selectedInstance.id, cancelReason.trim(), 'CANCEL');
                        setCancelReason('');
                      }}
                      style={authStyles.btnDanger}
                    >
                      <XCircle size={14} /> Hủy quy trình
                    </button>
                  </div>
                </div>
              )}

              {/* Section 9.3.7: Full Workflow History Timeline */}
              <div>
                <h4 style={{ ...authStyles.sectionTitle, fontSize: '14px', marginBottom: '8px' }}>
                  <History size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                  Mục 9.3.7 — Lịch sử Toàn bộ Quy trình ({selectedInstance.histories.length} sự
                  kiện)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedInstance.histories.map((h) => (
                    <div
                      key={h.id}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-input)',
                        fontSize: '12px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontWeight: 700,
                        }}
                      >
                        <span>
                          [{h.actionType}] {h.fromStateCode ?? 'START'} → {h.toStateCode}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                          {new Date(h.createdAt).toLocaleString('vi-VN')}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginTop: '3px' }}>
                        Người thực hiện:{' '}
                        <strong>
                          {h.actorFullName ||
                            (h.actorUserId ? `User #${h.actorUserId}` : 'Hệ thống / Scheduler')}
                        </strong>
                        {h.reason ? ` · Lý do: ${h.reason}` : ''}
                      </div>
                      {h.triggeredActions.length > 0 && (
                        <div
                          style={{
                            marginTop: '4px',
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          Hành động đã chạy (9.3.4):{' '}
                          {h.triggeredActions
                            .map((a) => `${a.type} (${a.status})`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

