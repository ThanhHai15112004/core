import React, { useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ChevronLeft,
  ChevronRight,
  FileCheck,
  Lock,
  Search,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { AUDIT_ACTOR_TYPE_LABELS } from '../enum/roles.enum';
import type {
  AuditLogItem,
  SecurityAlertItem,
  SecurityEventItem,
} from '../types/roles.types';

interface RoleAuditSecurityTabProps {
  auditLogs: readonly AuditLogItem[];
  auditMeta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
  auditFilter: {
    page: number;
    q: string;
    module: string;
    action: string;
  };
  selectedAuditLog: AuditLogItem | null;
  onSelectAuditLog: (item: AuditLogItem) => void;
  onApplyAuditFilter: (next: Partial<RoleAuditSecurityTabProps['auditFilter']>) => Promise<void>;
  securityEvents: readonly SecurityEventItem[];
  securityAlerts: readonly SecurityAlertItem[];
}

export const RoleAuditSecurityTab: React.FC<RoleAuditSecurityTabProps> = ({
  auditLogs,
  auditMeta,
  auditFilter,
  selectedAuditLog,
  onSelectAuditLog,
  onApplyAuditFilter,
  securityEvents,
  securityAlerts,
}) => {
  const [subView, setSubView] = useState<'audit' | 'security'>('audit');
  const [searchInput, setSearchInput] = useState<string>(auditFilter.q);
  const [moduleInput, setModuleInput] = useState<string>(auditFilter.module);
  const [actionInput, setActionInput] = useState<string>(auditFilter.action);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onApplyAuditFilter({
      page: 1,
      q: searchInput,
      module: moduleInput,
      action: actionInput,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Sub-view Switcher */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setSubView('audit')}
            style={subView === 'audit' ? authStyles.btnPrimary : authStyles.btnSecondary}
          >
            <FileCheck size={14} />
            Nhật ký Kiểm toán Bất biến (Audit Logs · {auditMeta.totalItems})
          </button>
          <button
            type="button"
            onClick={() => setSubView('security')}
            style={subView === 'security' ? authStyles.btnPrimary : authStyles.btnSecondary}
          >
            <AlertOctagon size={14} />
            Sự kiện & Cảnh báo Bảo mật SIEM ({securityAlerts.length} Alerts / {securityEvents.length}{' '}
            Events)
          </button>
        </div>

        <span style={authStyles.badgeSuccess}>
          <Lock size={11} /> Bảo vệ toàn vẹn Mục 4.4.8: Chặn tuyệt đối PUT / PATCH / DELETE Audit Log
        </span>
      </div>

      {subView === 'audit' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '18px' }}>
          {/* Left: Audit Log Table */}
          <div style={authStyles.card}>
            <form
              onSubmit={handleSearchSubmit}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 130px 150px auto',
                gap: '8px',
                marginBottom: '14px',
              }}
            >
              <div style={{ position: 'relative' }}>
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  placeholder="Tìm người thực hiện, IP, Request ID..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  style={{ ...authStyles.input, paddingLeft: '30px' }}
                />
              </div>

              <input
                type="text"
                placeholder="Module (vd: roles)"
                value={moduleInput}
                onChange={(e) => setModuleInput(e.target.value)}
                style={authStyles.input}
              />

              <input
                type="text"
                placeholder="Action (vd: ROLE_UPDATED)"
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                style={authStyles.input}
              />

              <button type="submit" style={authStyles.btnPrimary}>
                Lọc
              </button>
            </form>

            <div style={{ overflowX: 'auto', maxHeight: '540px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>ID / Thời gian</th>
                    <th style={authStyles.tableHeaderCell}>Tác nhân (Actor)</th>
                    <th style={authStyles.tableHeaderCell}>Module / Action</th>
                    <th style={authStyles.tableHeaderCell}>Tài nguyên</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          ...authStyles.tableCell,
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                          padding: '28px',
                        }}
                      >
                        Chưa có bản ghi Audit Log nào khớp với điều kiện truy vấn.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((item) => {
                      const isSelected = selectedAuditLog?.id === item.id;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => onSelectAuditLog(item)}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? 'var(--primary-light)' : 'transparent',
                          }}
                        >
                          <td style={authStyles.tableCell}>
                            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              #{item.id}
                            </div>
                            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                              {new Date(item.createdAt).toLocaleString('vi-VN')}
                            </div>
                          </td>
                          <td style={authStyles.tableCell}>
                            <div style={{ fontWeight: 600 }}>
                              {item.actorDisplayName ||
                                (item.actorUserId ? `User #${item.actorUserId}` : 'System')}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {AUDIT_ACTOR_TYPE_LABELS[item.actorType] ?? 'SYSTEM'} ·{' '}
                              {item.ipAddress || 'local'}
                            </div>
                          </td>
                          <td style={authStyles.tableCell}>
                            <span style={authStyles.badgePrimary}>{item.module}</span>
                            <div
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '12px',
                                fontWeight: 700,
                                marginTop: '3px',
                              }}
                            >
                              {item.action}
                            </div>
                          </td>
                          <td style={authStyles.tableCell}>
                            <div style={{ fontSize: '12.5px' }}>
                              {item.resourceType ?? '—'}{' '}
                              {item.resourceId ? `#${item.resourceId}` : ''}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Bar */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '12px',
                paddingTop: '10px',
                borderTop: '1px solid var(--border-color)',
              }}
            >
              <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                Trang {auditMeta.page} / {auditMeta.totalPages} ({auditMeta.totalItems} bản ghi)
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  disabled={auditMeta.page <= 1}
                  onClick={() => void onApplyAuditFilter({ page: auditMeta.page - 1 })}
                  style={authStyles.btnSecondary}
                >
                  <ChevronLeft size={14} /> Trước
                </button>
                <button
                  type="button"
                  disabled={auditMeta.page >= auditMeta.totalPages}
                  onClick={() => void onApplyAuditFilter({ page: auditMeta.page + 1 })}
                  style={authStyles.btnSecondary}
                >
                  Sau <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Audit Log Before/After Inspector */}
          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <FileCheck size={17} color="var(--primary)" />
              Chi tiết Bản ghi Kiểm toán (Before / After Snapshot)
            </h3>
            <p style={authStyles.sectionDesc}>
              Đối chiếu trạng thái dữ liệu trước và sau khi thao tác cùng thông tin truy vết Request ID
            </p>

            {!selectedAuditLog ? (
              <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Chọn một bản ghi Audit Log ở bảng bên trái để xem chi tiết Before / After.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '10px',
                  }}
                >
                  <div style={authStyles.codeBox}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Action & Resource
                    </div>
                    <strong>
                      {selectedAuditLog.action} ({selectedAuditLog.resourceType ?? 'resource'} #
                      {selectedAuditLog.resourceId ?? '—'})
                    </strong>
                  </div>
                  <div style={authStyles.codeBox}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Request ID / Correlation ID
                    </div>
                    <strong>
                      {selectedAuditLog.requestId || selectedAuditLog.correlationId || 'internal'}
                    </strong>
                  </div>
                </div>

                {selectedAuditLog.reason && (
                  <div style={authStyles.codeBox}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Lý do thao tác</div>
                    <span>{selectedAuditLog.reason}</span>
                  </div>
                )}

                <div>
                  <label style={authStyles.label}>Dữ liệu Trước thao tác (beforeData)</label>
                  <pre
                    style={{
                      ...authStyles.codeBox,
                      maxHeight: '190px',
                      overflowY: 'auto',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {selectedAuditLog.beforeData
                      ? JSON.stringify(selectedAuditLog.beforeData, null, 2)
                      : 'null (Tạo mới)'}
                  </pre>
                </div>

                <div>
                  <label style={authStyles.label}>Dữ liệu Sau thao tác (afterData)</label>
                  <pre
                    style={{
                      ...authStyles.codeBox,
                      maxHeight: '220px',
                      overflowY: 'auto',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {selectedAuditLog.afterData
                      ? JSON.stringify(selectedAuditLog.afterData, null, 2)
                      : 'null'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* SIEM Security Alerts & Events View */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <AlertOctagon size={17} color="var(--status-danger)" />
              Cảnh báo Thao tác Bất thường (SIEM Anomaly Alerts · {securityAlerts.length})
            </h3>
            <p style={authStyles.sectionDesc}>
              Phát hiện tự động các hành vi leo thang đặc quyền, brute-force, tắt MFA hoặc xuất dữ liệu lớn
            </p>

            {securityAlerts.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Hệ thống an toàn — Chưa ghi nhận cảnh báo bất thường nào.
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  maxHeight: '520px',
                  overflowY: 'auto',
                }}
              >
                {securityAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-surface-elevated)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '6px',
                      }}
                    >
                      <span
                        style={
                          alert.severity === 'CRITICAL' || alert.severity === 'HIGH'
                            ? authStyles.badgeDanger
                            : authStyles.badgeWarning
                        }
                      >
                        {alert.severity} · {alert.anomalyType}
                      </span>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        {new Date(alert.detectedAt).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)' }}>
                      {alert.message}
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Actor: {alert.actorId ? `#${alert.actorId}` : 'anonymous'} · IP:{' '}
                      {alert.ipAddress ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <Activity size={17} color="var(--primary)" />
              Dòng Sự kiện Bảo mật Nền tảng (Security Events · {securityEvents.length})
            </h3>
            <p style={authStyles.sectionDesc}>
              Ghi nhận thời gian thực các sự kiện thay đổi quyền hạn, xác thực và cấu hình bảo mật
            </p>

            {securityEvents.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Chưa có sự kiện bảo mật nào trong phiên hiện tại.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={authStyles.tableHeaderCell}>Sự kiện</th>
                      <th style={authStyles.tableHeaderCell}>Module / Action</th>
                      <th style={authStyles.tableHeaderCell}>Chi tiết</th>
                      <th style={authStyles.tableHeaderCell}>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {securityEvents.map((ev) => (
                      <tr key={ev.id}>
                        <td style={authStyles.tableCell}>
                          <span style={authStyles.badgePrimary}>{ev.eventType}</span>
                        </td>
                        <td style={authStyles.tableCell}>
                          <div style={{ fontWeight: 600 }}>{ev.module}</div>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                            {ev.action}
                          </div>
                        </td>
                        <td style={authStyles.tableCell}>
                          <div style={{ fontSize: '12.5px' }}>{ev.reason ?? '—'}</div>
                        </td>
                        <td style={authStyles.tableCell}>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                            {new Date(ev.occurredAt).toLocaleString('vi-VN')}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

