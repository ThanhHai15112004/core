import React, { useState } from 'react';
import { Activity, Archive, Bell, History, Send, Settings, ShieldAlert, Sliders } from 'lucide-react';
import { NotificationChannelsOpsView } from './components/NotificationChannelsOpsView';
import { NotificationComposerView } from './components/NotificationComposerView';
import { NotificationConfigView } from './components/NotificationConfigView';
import { NotificationDispatchHistoryView } from './components/NotificationDispatchHistoryView';
import { NotificationInboxView } from './components/NotificationInboxView';
import { NotificationPreferencesView } from './components/NotificationPreferencesView';
import { useNotifications } from './hooks/useNotifications';

type NotificationCenterTab =
  | 'inbox'
  | 'compose'
  | 'history'
  | 'channels'
  | 'preferences'
  | 'config';

export const NotificationsManagementPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NotificationCenterTab>('inbox');
  const {
    inboxItems,
    inboxTotal,
    inboxFilters,
    setInboxFilters,
    selectedInboxItem,
    setSelectedInboxItem,
    unreadSummary,
    dispatches,
    dispatchesTotal,
    dispatchFilters,
    setDispatchFilters,
    selectedDispatchDetail,
    setSelectedDispatchDetail,
    handleSelectDispatchDetail,
    preferences,
    runtimeConfig,
    usersLookup,
    rolesLookup,
    orgUnitsLookup,
    loading,
    error,
    setError,
    feedback,
    setFeedback,
    handleToggleRead,
    handleMarkAllRead,
    handleToggleArchive,
    handleDeleteFromInbox,
    handleSendNotification,
    handleSavePreferences,
    handleSaveRuntimeConfig,
  } = useNotifications();

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '24px 20px 60px' }}>
      {/* Header Summary */}
      <div
        className="glass"
        style={{
          padding: '20px 24px',
          borderRadius: 16,
          marginBottom: 20,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bell size={22} color="#60A5FA" />
            <h1 style={{ margin: 0, fontSize: 22 }}>
              Trung tâm Thông báo Hệ thống (In-App Notification Center)
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, opacity: 0.78 }}>
            Phase 7 — Mục 7.1: Gửi thông báo theo cá nhân / nhóm / vai trò / đơn vị, đánh dấu đọc, lưu trữ & xóa độc lập lịch sử gửi, phân nhóm và thiết lập sở thích kênh nhận.
          </p>
        </div>

        {/* KPI Cards */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              background: 'rgba(59, 130, 246, 0.14)',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              minWidth: 125,
            }}
          >
            <div style={{ fontSize: 11.5, opacity: 0.75 }}>Chưa đọc (Mới)</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#60A5FA' }}>
              {unreadSummary.unreadCount}
            </div>
          </div>

          <div
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              minWidth: 125,
            }}
          >
            <div style={{ fontSize: 11.5, opacity: 0.75 }}>Hộp thư đến</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#34D399' }}>
              {unreadSummary.totalActiveCount}
            </div>
          </div>

          <div
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              minWidth: 125,
            }}
          >
            <div style={{ fontSize: 11.5, opacity: 0.75 }}>Đã lưu trữ</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#FBBF24' }}>
              {unreadSummary.totalArchivedCount}
            </div>
          </div>

          <div
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              minWidth: 125,
            }}
          >
            <div style={{ fontSize: 11.5, opacity: 0.75 }}>Cảnh báo Bảo mật</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#F87171' }}>
              {unreadSummary.byCategory.SECURITY ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 10,
            background: 'rgba(239, 68, 68, 0.16)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#FCA5A5',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={16} />
            {error}
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {feedback && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 10,
            background: 'rgba(16, 185, 129, 0.16)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            color: '#6EE7B7',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => setActiveTab('inbox')}
          className={`nav-tab-btn ${activeTab === 'inbox' ? 'nav-tab-btn-active' : ''}`}
        >
          <Bell size={15} />
          <span>Hộp thư cá nhân ({unreadSummary.unreadCount} mới)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('compose')}
          className={`nav-tab-btn ${activeTab === 'compose' ? 'nav-tab-btn-active' : ''}`}
        >
          <Send size={15} />
          <span>Tạo & Gửi thông báo</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`nav-tab-btn ${activeTab === 'history' ? 'nav-tab-btn-active' : ''}`}
        >
          <History size={15} />
          <span>Lịch sử gửi ({dispatchesTotal})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('channels')}
          className={`nav-tab-btn ${activeTab === 'channels' ? 'nav-tab-btn-active' : ''}`}
        >
          <Activity size={15} />
          <span>Email / SMS / Push & Quota (7.2)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preferences')}
          className={`nav-tab-btn ${activeTab === 'preferences' ? 'nav-tab-btn-active' : ''}`}
        >
          <Sliders size={15} />
          <span>Sở thích nhận thông báo</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('config')}
          className={`nav-tab-btn ${activeTab === 'config' ? 'nav-tab-btn-active' : ''}`}
        >
          <Settings size={15} />
          <span>Cấu hình vận hành</span>
        </button>

        {activeTab === 'inbox' && inboxFilters.inboxStatus === 'ARCHIVED' && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#FBBF24',
              marginLeft: 'auto',
            }}
          >
            <Archive size={14} /> Đang xem mục Đã lưu trữ
          </span>
        )}
      </div>

      {/* Content */}
      {activeTab === 'inbox' && (
        <NotificationInboxView
          items={inboxItems}
          total={inboxTotal}
          filters={inboxFilters}
          unreadSummary={unreadSummary}
          selectedItem={selectedInboxItem}
          onChangeFilters={setInboxFilters}
          onSelectItem={setSelectedInboxItem}
          onToggleRead={(item, isRead) => void handleToggleRead(item, isRead)}
          onMarkAllRead={(cat) => void handleMarkAllRead(cat)}
          onToggleArchive={(item, archived) => void handleToggleArchive(item, archived)}
          onDeleteFromInbox={(item) => void handleDeleteFromInbox(item)}
        />
      )}

      {activeTab === 'compose' && (
        <NotificationComposerView
          usersLookup={usersLookup}
          rolesLookup={rolesLookup}
          orgUnitsLookup={orgUnitsLookup}
          runtimeConfig={runtimeConfig}
          loading={loading}
          onSend={async (payload) => {
            await handleSendNotification(payload);
            setActiveTab('history');
          }}
        />
      )}

      {activeTab === 'history' && (
        <NotificationDispatchHistoryView
          dispatches={dispatches}
          total={dispatchesTotal}
          filters={dispatchFilters}
          selectedDetail={selectedDispatchDetail}
          onChangeFilters={setDispatchFilters}
          onSelectDetail={(id) => void handleSelectDispatchDetail(id)}
          onCloseDetail={() => setSelectedDispatchDetail(null)}
        />
      )}

      {activeTab === 'channels' && <NotificationChannelsOpsView />}

      {activeTab === 'preferences' && (
        <NotificationPreferencesView
          preferences={preferences}
          loading={loading}
          onSave={handleSavePreferences}
        />
      )}

      {activeTab === 'config' && (
        <NotificationConfigView
          config={runtimeConfig}
          loading={loading}
          onSave={handleSaveRuntimeConfig}
        />
      )}
    </main>
  );
};

