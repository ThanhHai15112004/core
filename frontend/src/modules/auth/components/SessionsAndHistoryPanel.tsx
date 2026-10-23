import React, { useState, useMemo } from 'react';
import { Laptop, History, Trash2, RefreshCw, Filter, CheckCircle2, AlertCircle } from 'lucide-react';
import { authApi } from '../services/auth.api';
import { authStyles } from './auth-ui.styles';
import type { LoginHistoryItem, SessionItem } from '../types/auth.types';

interface SessionsAndHistoryPanelProps {
  accessToken: string;
  sessions: SessionItem[];
  loginHistory: LoginHistoryItem[];
  onRefresh: () => Promise<void>;
  notify: (type: 'ok' | 'err', text: string) => void;
}

export const SessionsAndHistoryPanel: React.FC<SessionsAndHistoryPanelProps> = ({
  accessToken,
  sessions,
  loginHistory,
  onRefresh,
  notify,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [eventFilter, setEventFilter] = useState<string>('');

  const filteredHistory = useMemo(() => {
    return loginHistory.filter((item) => {
      if (statusFilter !== 'ALL' && item.statusName !== statusFilter) return false;
      if (
        eventFilter.trim() &&
        !item.eventTypeName.toLowerCase().includes(eventFilter.trim().toLowerCase()) &&
        !(item.reason ?? '').toLowerCase().includes(eventFilter.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [loginHistory, statusFilter, eventFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Phiên đăng nhập đang hoạt động (Mục 3.4.4 - 3.4.6) */}
      <div style={authStyles.cardHighlighted}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
              <Laptop size={18} color="var(--primary)" />
              <span>Phiên Đăng Nhập Đang Hoạt Động ({sessions.length})</span>
            </h3>
            <p style={{ ...authStyles.sectionDesc, margin: '4px 0 0' }}>
              Theo dõi thiết bị, IP, thời gian hoạt động gần nhất và thu hồi từ xa từng phiên hoặc
              toàn bộ các phiên khác.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" onClick={onRefresh} style={authStyles.btnSecondary}>
              <RefreshCw size={14} /> Làm mới
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!accessToken) return;
                try {
                  const res = await authApi.revokeAllSessions(accessToken, true);
                  notify('ok', `Đã thu hồi ${res.revokedCount} phiên đăng nhập khác (giữ phiên hiện tại).`);
                  await onRefresh();
                } catch (err) {
                  notify('err', err instanceof Error ? err.message : 'Lỗi thu hồi các phiên khác');
                }
              }}
              style={authStyles.btnDanger}
            >
              <Trash2 size={14} /> Thu hồi các phiên khác
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Session ID</th>
                <th style={authStyles.tableHeaderCell}>Thiết bị / Trình duyệt</th>
                <th style={authStyles.tableHeaderCell}>Địa chỉ IP</th>
                <th style={authStyles.tableHeaderCell}>Hoạt động gần nhất</th>
                <th style={authStyles.tableHeaderCell}>Hết hạn lúc</th>
                <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                <th style={authStyles.tableHeaderCell}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...authStyles.tableCell, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Hãy đăng nhập ở tab Cổng Xác Thực để xem danh sách phiên hoạt động.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id}>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      #{s.id}
                    </td>
                    <td style={{ ...authStyles.tableCell, fontWeight: 600 }}>
                      {s.deviceName ?? 'Web Browser'}
                    </td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)' }}>
                      {s.ipAddress ?? '127.0.0.1'}
                    </td>
                    <td style={authStyles.tableCell}>
                      {new Date(s.lastActiveAt).toLocaleString('vi-VN')}
                    </td>
                    <td style={authStyles.tableCell}>
                      {new Date(s.expiresAt).toLocaleString('vi-VN')}
                    </td>
                    <td style={authStyles.tableCell}>
                      {s.isCurrent ? (
                        <span style={authStyles.badgeSuccess}>Phiên hiện tại</span>
                      ) : (
                        <span style={authStyles.badgePrimary}>Đang mở</span>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!accessToken) return;
                          try {
                            await authApi.revokeSession(accessToken, s.id);
                            notify('ok', `Đã thu hồi phiên #${s.id}`);
                            await onRefresh();
                          } catch (err) {
                            notify('err', err instanceof Error ? err.message : 'Lỗi thu hồi phiên');
                          }
                        }}
                        style={authStyles.btnDanger}
                      >
                        <Trash2 size={13} /> Thu hồi
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Lịch sử sự kiện đăng nhập & bảo mật (Mục 3.4.7) */}
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '14px',
          }}
        >
          <div>
            <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
              <History size={18} color="var(--secondary)" />
              <span>Nhật Ký Sự Kiện Đăng Nhập & Xác Thực ({filteredHistory.length})</span>
            </h3>
            <p style={{ ...authStyles.sectionDesc, margin: '4px 0 0' }}>
              Lưu vết đầy đủ thời gian, loại sự kiện, kết quả, thiết bị, IP và nguyên nhân chi tiết.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Filter size={15} color="var(--text-muted)" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ ...authStyles.input, width: '150px' }}
            >
              <option value="ALL">Mọi trạng thái</option>
              <option value="SUCCESS">Thành công (SUCCESS)</option>
              <option value="FAILED">Thất bại (FAILED)</option>
            </select>
            <input
              type="text"
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              placeholder="Lọc theo sự kiện / lý do..."
              style={{ ...authStyles.input, width: '210px' }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Thời gian</th>
                <th style={authStyles.tableHeaderCell}>Sự kiện</th>
                <th style={authStyles.tableHeaderCell}>Kết quả</th>
                <th style={authStyles.tableHeaderCell}>Thiết bị</th>
                <th style={authStyles.tableHeaderCell}>IP</th>
                <th style={authStyles.tableHeaderCell}>Chi tiết / Lý do</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Không có bản ghi lịch sử đăng nhập khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredHistory.map((h) => (
                  <tr key={h.id}>
                    <td style={{ ...authStyles.tableCell, whiteSpace: 'nowrap', fontSize: '12.5px' }}>
                      {new Date(h.createdAt).toLocaleString('vi-VN')}
                    </td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600 }}>
                      {h.eventTypeName}
                    </td>
                    <td style={authStyles.tableCell}>
                      {h.statusName === 'SUCCESS' ? (
                        <span style={authStyles.badgeSuccess}>
                          <CheckCircle2 size={12} /> SUCCESS
                        </span>
                      ) : (
                        <span style={authStyles.badgeDanger}>
                          <AlertCircle size={12} /> {h.statusName}
                        </span>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>{h.deviceName ?? '—'}</td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {h.ipAddress ?? '—'}
                    </td>
                    <td style={{ ...authStyles.tableCell, color: 'var(--text-secondary)' }}>
                      {h.reason ?? '—'}
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

