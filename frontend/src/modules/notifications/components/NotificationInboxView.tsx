import React from 'react';
import {
  Archive,
  ArchiveRestore,
  Bell,
  CheckCheck,
  CheckCircle2,
  Circle,
  Eye,
  Filter,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  ListInboxFilterParams,
  NotificationInboxItem,
  NotificationUnreadSummary,
} from '../types/notifications.types';

interface NotificationInboxViewProps {
  items: NotificationInboxItem[];
  total: number;
  filters: ListInboxFilterParams;
  unreadSummary: NotificationUnreadSummary;
  selectedItem: NotificationInboxItem | null;
  onChangeFilters: (next: ListInboxFilterParams) => void;
  onSelectItem: (item: NotificationInboxItem | null) => void;
  onToggleRead: (item: NotificationInboxItem, isRead: boolean) => void;
  onMarkAllRead: (category?: string) => void;
  onToggleArchive: (item: NotificationInboxItem, archived: boolean) => void;
  onDeleteFromInbox: (item: NotificationInboxItem) => void;
}

const CATEGORY_BADGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  SYSTEM: {
    bg: 'rgba(59, 130, 246, 0.14)',
    text: '#60A5FA',
    border: 'rgba(59, 130, 246, 0.35)',
  },
  WORK: {
    bg: 'rgba(16, 185, 129, 0.14)',
    text: '#34D399',
    border: 'rgba(16, 185, 129, 0.35)',
  },
  SECURITY: {
    bg: 'rgba(239, 68, 68, 0.14)',
    text: '#F87171',
    border: 'rgba(239, 68, 68, 0.35)',
  },
  ANNOUNCEMENT: {
    bg: 'rgba(245, 158, 11, 0.14)',
    text: '#FBBF24',
    border: 'rgba(245, 158, 11, 0.35)',
  },
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#94A3B8',
  NORMAL: '#60A5FA',
  HIGH: '#FBBF24',
  URGENT: '#F87171',
};

export const NotificationInboxView: React.FC<NotificationInboxViewProps> = ({
  items,
  total,
  filters,
  unreadSummary,
  selectedItem,
  onChangeFilters,
  onSelectItem,
  onToggleRead,
  onMarkAllRead,
  onToggleArchive,
  onDeleteFromInbox,
}) => {
  const isArchivedTab = filters.inboxStatus === 'ARCHIVED' || filters.inboxStatus === 2;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selectedItem ? '1fr 380px' : '1fr', gap: 16 }}>
      <div className="glass" style={{ padding: 20, borderRadius: 14 }}>
        {/* Filter bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => onChangeFilters({ ...filters, page: 1, inboxStatus: 'ACTIVE' })}
              className={`nav-tab-btn ${!isArchivedTab ? 'nav-tab-btn-active' : ''}`}
            >
              <Bell size={14} />
              <span>Hộp thư đến ({unreadSummary.totalActiveCount})</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeFilters({ ...filters, page: 1, inboxStatus: 'ARCHIVED' })}
              className={`nav-tab-btn ${isArchivedTab ? 'nav-tab-btn-active' : ''}`}
            >
              <Archive size={14} />
              <span>Đã lưu trữ ({unreadSummary.totalArchivedCount})</span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <Filter size={14} style={{ opacity: 0.7 }} />
              <select
                value={filters.category ?? ''}
                onChange={(e) =>
                  onChangeFilters({
                    ...filters,
                    page: 1,
                    category: e.target.value || undefined,
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
                <option value="">Tất cả phân nhóm</option>
                <option value="SYSTEM">
                  Hệ thống ({unreadSummary.byCategory.SYSTEM ?? 0} chưa đọc)
                </option>
                <option value="WORK">
                  Công việc ({unreadSummary.byCategory.WORK ?? 0} chưa đọc)
                </option>
                <option value="SECURITY">
                  Bảo mật ({unreadSummary.byCategory.SECURITY ?? 0} chưa đọc)
                </option>
                <option value="ANNOUNCEMENT">
                  Thông báo chung ({unreadSummary.byCategory.ANNOUNCEMENT ?? 0} chưa đọc)
                </option>
              </select>

              <select
                value={
                  filters.isRead === undefined ? '' : filters.isRead ? 'true' : 'false'
                }
                onChange={(e) =>
                  onChangeFilters({
                    ...filters,
                    page: 1,
                    isRead:
                      e.target.value === '' ? undefined : e.target.value === 'true',
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
                <option value="">Tất cả trạng thái đọc</option>
                <option value="false">Chưa đọc ({unreadSummary.unreadCount})</option>
                <option value="true">Đã đọc</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search
                size={14}
                style={{ position: 'absolute', left: 10, top: 9, opacity: 0.6 }}
              />
              <input
                type="text"
                placeholder="Tìm tiêu đề, nội dung, mã..."
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
                  width: 210,
                }}
              />
            </div>

            {!isArchivedTab && unreadSummary.unreadCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  onMarkAllRead(
                    typeof filters.category === 'string' && filters.category
                      ? filters.category
                      : undefined,
                  )
                }
                className="nav-tab-btn"
                style={{
                  border: '1px solid rgba(59, 130, 246, 0.45)',
                  background: 'rgba(59, 130, 246, 0.14)',
                }}
              >
                <CheckCheck size={14} />
                <span>Đánh dấu đã đọc tất cả</span>
              </button>
            )}
          </div>
        </div>

        {/* List */}
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '44px 20px', opacity: 0.7 }}>
            <Bell size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>Không có thông báo nào phù hợp</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Khi có thông báo mới gửi cho bạn, theo vai trò hoặc theo đơn vị, thông báo sẽ xuất hiện tại đây.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((item) => {
              const catStyle = CATEGORY_BADGE_COLORS[item.categoryName] ?? CATEGORY_BADGE_COLORS.SYSTEM!;
              const priorityColor = PRIORITY_COLORS[item.priorityName] ?? '#60A5FA';
              const isSelected = selectedItem?.id === item.id;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectItem(item);
                    if (!item.isRead) {
                      onToggleRead(item, true);
                    }
                  }}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    background: isSelected
                      ? 'rgba(59, 130, 246, 0.16)'
                      : item.isRead
                        ? 'rgba(15, 23, 42, 0.35)'
                        : 'rgba(30, 41, 59, 0.82)',
                    border: isSelected
                      ? '1px solid rgba(59, 130, 246, 0.6)'
                      : item.isRead
                        ? '1px solid rgba(148, 163, 184, 0.16)'
                        : '1px solid rgba(59, 130, 246, 0.4)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {!item.isRead ? (
                        <span
                          title="Chưa đọc"
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: '50%',
                            background: '#3B82F6',
                            display: 'inline-block',
                          }}
                        />
                      ) : null}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 99,
                          background: catStyle.bg,
                          color: catStyle.text,
                          border: `1px solid ${catStyle.border}`,
                        }}
                      >
                        {item.categoryLabel}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: priorityColor,
                        }}
                      >
                        • Ưu tiên: {item.priorityLabel}
                      </span>
                      <span style={{ fontSize: 11, opacity: 0.6 }}>• Mã: {item.code}</span>
                      <span style={{ fontSize: 11, opacity: 0.6 }}>
                        • Phạm vi: {item.targetTypeName}
                      </span>
                    </div>

                    <div
                      style={{
                        fontWeight: item.isRead ? 600 : 700,
                        fontSize: 15,
                        marginTop: 6,
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        opacity: item.isRead ? 0.72 : 0.9,
                        marginTop: 4,
                        lineHeight: 1.45,
                      }}
                    >
                      {item.content}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
                      Nhận lúc: {new Date(item.deliveredAt).toLocaleString('vi-VN')}
                      {item.readAt
                        ? ` • Đã đọc lúc: ${new Date(item.readAt).toLocaleString('vi-VN')}`
                        : ''}
                    </div>
                  </div>

                  <div
                    style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      title={item.isRead ? 'Đánh dấu Chưa đọc' : 'Đánh dấu Đã đọc'}
                      onClick={() => onToggleRead(item, !item.isRead)}
                      className="nav-tab-btn"
                      style={{ padding: '6px 8px' }}
                    >
                      {item.isRead ? (
                        <Circle size={14} color="#94A3B8" />
                      ) : (
                        <CheckCircle2 size={14} color="#34D399" />
                      )}
                    </button>

                    <button
                      type="button"
                      title={isArchivedTab ? 'Khôi phục về Hộp thư đến' : 'Lưu trữ thông báo'}
                      onClick={() => onToggleArchive(item, !isArchivedTab)}
                      className="nav-tab-btn"
                      style={{ padding: '6px 8px' }}
                    >
                      {isArchivedTab ? (
                        <ArchiveRestore size={14} color="#60A5FA" />
                      ) : (
                        <Archive size={14} color="#FBBF24" />
                      )}
                    </button>

                    <button
                      type="button"
                      title="Xóa khỏi hộp thư cá nhân (Không ảnh hưởng lịch sử gửi)"
                      onClick={() => onDeleteFromInbox(item)}
                      className="nav-tab-btn"
                      style={{ padding: '6px 8px' }}
                    >
                      <Trash2 size={14} color="#F87171" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.65 }}>
          Hiển thị {items.length} / {total} thông báo • Lưu ý: Lưu trữ hoặc Xóa tại đây chỉ áp dụng cho hộp thư cá nhân của bạn, không xóa lịch sử gửi của hệ thống.
        </div>
      </div>

      {/* Inspector Panel */}
      {selectedItem && (
        <div className="glass" style={{ padding: 20, borderRadius: 14, height: 'fit-content' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <Eye size={16} color="#60A5FA" />
              <span>Chi tiết thông báo</span>
            </div>
            <button
              type="button"
              onClick={() => onSelectItem(null)}
              className="nav-tab-btn"
              style={{ padding: '4px 8px', fontSize: 12 }}
            >
              Đóng
            </button>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>Mã bản tin: {selectedItem.code}</div>
          <h3 style={{ margin: '6px 0 10px', fontSize: 16 }}>{selectedItem.title}</h3>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {selectedItem.content}
          </p>

          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: 'rgba(15, 23, 42, 0.5)',
              fontSize: 12.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div>
              <strong>Phân nhóm:</strong> {selectedItem.categoryLabel} ({selectedItem.categoryName})
            </div>
            <div>
              <strong>Mức độ ưu tiên:</strong> {selectedItem.priorityLabel} ({selectedItem.priorityName})
            </div>
            <div>
              <strong>Phạm vi phát:</strong> {selectedItem.targetTypeName}
            </div>
            <div>
              <strong>Trạng thái đọc:</strong> {selectedItem.isRead ? 'Đã đọc' : 'Chưa đọc'}
            </div>
            <div>
              <strong>Trạng thái hộp thư:</strong> {selectedItem.inboxStatusName}
            </div>
            {selectedItem.actionUrl && (
              <div>
                <strong>Liên kết điều hướng:</strong> <code>{selectedItem.actionUrl}</code>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => onToggleRead(selectedItem, !selectedItem.isRead)}
              className="nav-tab-btn"
            >
              {selectedItem.isRead ? 'Đánh dấu Chưa đọc' : 'Đánh dấu Đã đọc'}
            </button>
            <button
              type="button"
              onClick={() =>
                onToggleArchive(selectedItem, selectedItem.inboxStatusName !== 'ARCHIVED')
              }
              className="nav-tab-btn"
            >
              {selectedItem.inboxStatusName === 'ARCHIVED' ? 'Bỏ lưu trữ' : 'Lưu trữ'}
            </button>
            <button
              type="button"
              onClick={() => onDeleteFromInbox(selectedItem)}
              className="nav-tab-btn"
              style={{ color: '#F87171' }}
            >
              Xóa khỏi hộp thư
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

