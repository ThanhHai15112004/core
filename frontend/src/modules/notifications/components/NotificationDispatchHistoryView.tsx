import React from 'react';
import { History, Search, ShieldCheck, Users } from 'lucide-react';
import type {
  ListDispatchesFilterParams,
  NotificationDispatchDetail,
  NotificationDispatchHistoryItem,
} from '../types/notifications.types';

interface NotificationDispatchHistoryViewProps {
  dispatches: NotificationDispatchHistoryItem[];
  total: number;
  filters: ListDispatchesFilterParams;
  selectedDetail: NotificationDispatchDetail | null;
  onChangeFilters: (next: ListDispatchesFilterParams) => void;
  onSelectDetail: (id: number) => void;
  onCloseDetail: () => void;
}

export const NotificationDispatchHistoryView: React.FC<NotificationDispatchHistoryViewProps> = ({
  dispatches,
  total,
  filters,
  selectedDetail,
  onChangeFilters,
  onSelectDetail,
  onCloseDetail,
}) => {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: selectedDetail ? '1fr 420px' : '1fr', gap: 16 }}>
      <div className="glass" style={{ padding: 20, borderRadius: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 16,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={17} color="#60A5FA" />
              <span>Lịch sử phát thông báo gốc (Bất biến)</span>
            </h3>
            <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 4 }}>
              Khi người nhận Lưu trữ hoặc Xóa thông báo trong hộp thư cá nhân, bản ghi lịch sử gửi tại đây vẫn được bảo toàn 100%.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={filters.targetType ?? ''}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  page: 1,
                  targetType: e.target.value || undefined,
                })
              }
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.65)',
                color: 'inherit',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                fontSize: 13,
              }}
            >
              <option value="">Tất cả loại đích gửi</option>
              <option value="SINGLE_USER">Một người dùng (SINGLE_USER)</option>
              <option value="USER_GROUP">Nhóm người dùng (USER_GROUP)</option>
              <option value="ROLE">Theo vai trò (ROLE)</option>
              <option value="ORG_UNIT">Theo đơn vị (ORG_UNIT)</option>
            </select>

            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 9, opacity: 0.6 }} />
              <input
                type="text"
                placeholder="Tìm mã NTF, tiêu đề..."
                value={filters.search ?? ''}
                onChange={(e) =>
                  onChangeFilters({ ...filters, page: 1, search: e.target.value })
                }
                style={{
                  padding: '6px 12px 6px 30px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.65)',
                  color: 'inherit',
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  fontSize: 13,
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
                  textAlign: 'left',
                  opacity: 0.8,
                }}
              >
                <th style={{ padding: '10px 8px' }}>Mã bản tin</th>
                <th style={{ padding: '10px 8px' }}>Tiêu đề & Phân nhóm</th>
                <th style={{ padding: '10px 8px' }}>Phạm vi gửi</th>
                <th style={{ padding: '10px 8px' }}>Phân phối / Bỏ qua</th>
                <th style={{ padding: '10px 8px' }}>Đã đọc / Lưu trữ / Xóa hộp thư</th>
                <th style={{ padding: '10px 8px' }}>Thời điểm gửi</th>
              </tr>
            </thead>
            <tbody>
              {dispatches.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => onSelectDetail(d.id)}
                  style={{
                    borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
                    cursor: 'pointer',
                    background:
                      selectedDetail?.id === d.id ? 'rgba(59, 130, 246, 0.14)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '10px 8px', fontWeight: 700, color: '#60A5FA' }}>
                    {d.code}
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <div style={{ fontWeight: 600 }}>{d.title}</div>
                    <div style={{ fontSize: 11.5, opacity: 0.7 }}>
                      Nhóm: {d.categoryLabel} • Ưu tiên: {d.priorityLabel}
                    </div>
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: 'rgba(148, 163, 184, 0.15)',
                        fontSize: 11.5,
                        fontWeight: 600,
                      }}
                    >
                      {d.targetTypeLabel} ({d.targetTypeName})
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <strong>{d.totalDelivered}</strong> / {d.totalTargeted} người nhận
                    {d.totalSkippedByPref > 0 && (
                      <div style={{ fontSize: 11, color: '#FBBF24' }}>
                        ({d.totalSkippedByPref} tắt kênh cá nhân)
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <span style={{ color: '#34D399' }}>{d.readCount} đã đọc</span> •{' '}
                    <span style={{ color: '#FBBF24' }}>{d.archivedCount} lưu trữ</span> •{' '}
                    <span style={{ color: '#F87171' }}>{d.deletedFromInboxCount} xóa hộp thư</span>
                  </td>
                  <td style={{ padding: '10px 8px', fontSize: 12, opacity: 0.75 }}>
                    {new Date(d.dispatchedAt).toLocaleString('vi-VN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.65 }}>
          Tổng số bản ghi lịch sử phát: {total}
        </div>
      </div>

      {selectedDetail && (
        <div className="glass" style={{ padding: 20, borderRadius: 14, height: 'fit-content' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <ShieldCheck size={16} color="#34D399" />
              <span>Chi tiết chiến dịch #{selectedDetail.code}</span>
            </div>
            <button
              type="button"
              onClick={onCloseDetail}
              className="nav-tab-btn"
              style={{ padding: '4px 8px', fontSize: 12 }}
            >
              Đóng
            </button>
          </div>

          <h4 style={{ margin: '12px 0 6px' }}>{selectedDetail.title}</h4>
          <p style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>{selectedDetail.content}</p>

          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.5)',
              fontSize: 12,
            }}
          >
            <div>
              <strong>Loại mục tiêu:</strong> {selectedDetail.targetTypeLabel}
            </div>
            <div>
              <strong>Target Payload:</strong>{' '}
              <code>{JSON.stringify(selectedDetail.targetPayload)}</code>
            </div>
            <div>
              <strong>Kênh phát:</strong> {selectedDetail.channels.join(', ')}
            </div>
          </div>

          <div style={{ marginTop: 14, fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} />
            <span>Trạng thái hộp thư người nhận ({selectedDetail.recipients.length})</span>
          </div>

          <div style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selectedDetail.recipients.map((rec) => (
              <div
                key={rec.recipientEntryId}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.45)',
                  border: '1px solid rgba(148, 163, 184, 0.16)',
                  fontSize: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong>User #{rec.recipientUserId}</strong> ({rec.channelName})
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: rec.isRead ? '#34D399' : '#60A5FA' }}>
                    {rec.isRead ? 'Đã đọc' : 'Chưa đọc'}
                  </span>
                  <span>•</span>
                  <span>{rec.inboxStatusName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

