import React, { useState } from 'react';
import { Bell, Calendar, Plus, RefreshCw, Repeat, Shield, Users } from 'lucide-react';
import { authStyles } from '../auth/components/auth-ui.styles';
import { useCalendarManagement } from './hooks/useCalendarManagement';

export const CalendarManagementPage: React.FC = () => {
  const {
    events,
    selectedEvent,
    providers,
    loading,
    banner,
    loadAll,
    selectEvent,
    handleQuickCreate,
    handleSyncExternal,
    handleScanReminders,
  } = useCalendarManagement();

  const [title, setTitle] = useState('Họp điều phối dự án Sprint mới');
  const [startAt, setStartAt] = useState('2026-11-15T09:00:00.000Z');
  const [endAt, setEndAt] = useState('2026-11-15T10:30:00.000Z');
  const [frequency, setFrequency] = useState<'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [resourceCode, setResourceCode] = useState('ROOM_HCM_A1');

  const onSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    void handleQuickCreate({
      title,
      startAt,
      endAt,
      resourceCode: resourceCode || null,
      recurrenceRule:
        frequency === 'NONE' ? null : { frequency, interval: 1, count: 4 },
      participants: [{ participantType: 'USER', userId: 2, role: 'REQUIRED', canEdit: true }],
      syncProviders: ['GOOGLE'],
    });
  };

  return (
    <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 20px 60px' }}>
      <section
        style={{
          background: 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          marginBottom: '18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Calendar size={24} />
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>
              Lịch & Sự Kiện (Calendar & Event — Mục 9.7)
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Tạo sự kiện, người tham gia (User/Đơn vị), lặp lại (Ngày/Tuần/Tháng), nhắc lịch, kiểm tra trùng lịch, phân quyền & đồng bộ Google/Microsoft Calendar.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={() => void handleScanReminders()} style={authStyles.btnSecondary}>
            <Bell size={14} /> Quét nhắc lịch
          </button>
          <button type="button" disabled={loading} onClick={() => void loadAll()} style={authStyles.btnSecondary}>
            <RefreshCw size={14} /> Làm mới
          </button>
        </div>
      </section>

      {banner && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '14px',
            fontWeight: 600,
            fontSize: '13px',
            background: banner.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
            color: banner.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
          }}
        >
          {banner.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '18px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <form
            onSubmit={onSubmitCreate}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '15px' }}>Tạo nhanh sự kiện lịch (9.7.1 – 9.7.5)</h3>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tiêu đề sự kiện"
              style={authStyles.input}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <input value={startAt} onChange={(e) => setStartAt(e.target.value)} style={authStyles.input} />
              <input value={endAt} onChange={(e) => setEndAt(e.target.value)} style={authStyles.input} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as typeof frequency)}
                style={authStyles.input}
              >
                <option value="NONE">Không lặp (NONE)</option>
                <option value="DAILY">Hàng ngày (DAILY)</option>
                <option value="WEEKLY">Hàng tuần (WEEKLY)</option>
                <option value="MONTHLY">Hàng tháng (MONTHLY)</option>
              </select>
              <input
                value={resourceCode}
                onChange={(e) => setResourceCode(e.target.value)}
                placeholder="Mã tài nguyên / phòng họp"
                style={authStyles.input}
              />
            </div>
            <button type="submit" style={authStyles.btnPrimary}>
              <Plus size={14} /> Tạo sự kiện
            </button>
          </form>

          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>
              Danh sách sự kiện ({events.length}) — Adapters ({providers.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {events.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => void selectEvent(ev.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border:
                      selectedEvent?.id === ev.id
                        ? '1px solid var(--primary)'
                        : '1px solid var(--border-color)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '13.5px' }}>
                    [{ev.code}] {ev.title}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {ev.startAt} → {ev.endAt} | {ev.statusName} | Lặp:{' '}
                    {ev.recurrenceRule?.frequency ?? 'NONE'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '18px',
          }}
        >
          {selectedEvent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '17px' }}>
                    {selectedEvent.title} ({selectedEvent.code})
                  </h2>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    <Shield size={12} style={{ display: 'inline', marginRight: 4 }} />
                    Quyền hiện tại: <b>{selectedEvent.viewerAccess.accessRole}</b> (canEdit:{' '}
                    {String(selectedEvent.viewerAccess.canEdit)}) | Tài nguyên:{' '}
                    {selectedEvent.resourceCode ?? 'N/A'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => void handleSyncExternal(selectedEvent.id, 'GOOGLE')}
                    style={authStyles.btnSecondary}
                  >
                    Sync Google
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSyncExternal(selectedEvent.id, 'MICROSOFT')}
                    style={authStyles.btnSecondary}
                  >
                    Sync Microsoft
                  </button>
                </div>
              </div>

              <div>
                <h4 style={{ margin: '0 0 6px', fontSize: '13.5px' }}>
                  <Users size={14} style={{ display: 'inline', marginRight: 4 }} />
                  Người tham gia ({selectedEvent.participants.length})
                </h4>
                {selectedEvent.participants.map((p) => (
                  <div key={p.id} style={{ fontSize: '12.5px', padding: '4px 0' }}>
                    • [{p.participantType}] {p.userFullName ?? p.organizationUnitName ?? `#${p.userId ?? p.organizationUnitId}`} — Vai trò: {p.role} — RSVP: <b>{p.rsvpStatus}</b>
                  </div>
                ))}
              </div>

              <div>
                <h4 style={{ margin: '0 0 6px', fontSize: '13.5px' }}>
                  <Repeat size={14} style={{ display: 'inline', marginRight: 4 }} />
                  Các phiên diễn ra kế tiếp ({selectedEvent.upcomingOccurrences.length})
                </h4>
                {selectedEvent.upcomingOccurrences.slice(0, 5).map((occ) => (
                  <div key={occ.occurrenceIndex} style={{ fontSize: '12.5px', padding: '2px 0' }}>
                    #{occ.occurrenceIndex}: {occ.startAt} → {occ.endAt}
                  </div>
                ))}
              </div>

              <div>
                <h4 style={{ margin: '0 0 6px', fontSize: '13.5px' }}>
                  Lịch sử thay đổi & Nguồn thay đổi ({selectedEvent.histories.length})
                </h4>
                {selectedEvent.histories.map((h) => (
                  <div key={h.id} style={{ fontSize: '12px', padding: '4px 0', borderBottom: '1px dashed var(--border-color)' }}>
                    <b>[{h.changeSource}]</b> {h.actionType} — {h.reason ?? ''} ({h.createdAt})
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>
              Chọn một sự kiện để xem chi tiết.
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
