import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { authStyles } from '../auth/components/auth-ui.styles';
import { USERS_TAB, type UsersTabId } from './enum/users.enum';
import { useUsersManagement } from './hooks/useUsersManagement';
import { UsersDirectoryTable } from './components/UsersDirectoryTable';
import { UserInspectorDrawer } from './components/UserInspectorDrawer';
import { UserLifecycleSecurityPanel } from './components/UserLifecycleSecurityPanel';
import { UsersBulkImportExportTab } from './components/UsersBulkImportExportTab';

export const UsersManagementPage: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    loading,
    submitting,
    banner,
    setBanner,
    users,
    pagination,
    filter,
    applyFilter,
    selectedUser,
    selectedUserId,
    setSelectedUserId,
    statusHistory,
    loginHistory,
    loadingHistory,
    roleOptions,
    organizationOptions,
    lastPasswordResetResult,
    lastMfaResetResult,
    lastImportResult,
    stats,
    refreshAll,
    handleCreateUser,
    handleUpdateUser,
    handleAssignRoles,
    handleAssignOrganizations,
    handleLifecycleAction,
    handleResetPassword,
    handleResetMfa,
    handleRevokeSessions,
    handleDownloadTemplate,
    handleExportUsers,
    handleBulkImport,
  } = useUsersManagement();

  const [inspectorMode, setInspectorMode] = useState<'create' | 'edit'>('edit');

  const tabItems: readonly { id: UsersTabId; label: string; icon: React.ReactNode }[] = [
    {
      id: USERS_TAB.DIRECTORY,
      label: `Danh bạ & Hồ sơ Nhân sự (${stats.totalUsers})`,
      icon: <Users size={15} />,
    },
    {
      id: USERS_TAB.LIFECYCLE_SECURITY,
      label: 'Vòng đời, Bảo mật & Lịch sử',
      icon: <ShieldAlert size={15} />,
    },
    {
      id: USERS_TAB.BULK_IMPORT_EXPORT,
      label: 'Nhập / Xuất Hàng loạt (CSV & XLSX)',
      icon: <FileSpreadsheet size={15} />,
    },
  ];

  return (
    <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 20px 60px' }}>
      {/* Hero Header Banner */}
      <section
        style={{
          background:
            'linear-gradient(135deg, var(--bg-light-blue) 0%, var(--bg-surface-elevated) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: '22px 26px',
          marginBottom: '20px',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '13px',
              background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.28)',
              flexShrink: 0,
            }}
          >
            <Users size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1
                style={{
                  fontSize: '21px',
                  fontWeight: 800,
                  margin: 0,
                  color: 'var(--text-main)',
                  letterSpacing: '-0.02em',
                }}
              >
                Quản Trị Hồ Sơ Nhân Sự, Đa Vai Trò & Vòng Đời Tài Khoản
              </h1>
              <span style={authStyles.badgePrimary}>Multi-Role & Multi-Org</span>
              <span style={authStyles.badgeSuccess}>Data Scope Enforced</span>
            </div>
            <p
              style={{
                fontSize: '13.5px',
                color: 'var(--text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Quản lý toàn diện hồ sơ <code>users</code> & <code>user_profiles</code>, phân công đa
              đơn vị (1 đơn vị chính), chuyển đổi trạng thái{' '}
              <code>ACTIVE / INACTIVE / LOCKED / ARCHIVED</code> và nhập/xuất CSV & XLSX.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void refreshAll()}
          style={authStyles.btnSecondary}
        >
          <RefreshCw size={14} />
          Làm mới
        </button>
      </section>

      {/* KPI Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: '14px',
          marginBottom: '20px',
        }}
      >
        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Tổng số Hồ sơ Nhân sự
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--text-main)',
              margin: '6px 0',
            }}
          >
            {stats.totalUsers}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgePrimary}>Trang {pagination.page}</span>
            <span style={authStyles.badgeSuccess}>{roleOptions.length} Vai trò sẵn sàng</span>
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Nhân sự Đang hoạt động (ACTIVE)
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--primary)',
              margin: '6px 0',
            }}
          >
            {stats.activeCount}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgeSuccess}>Đủ quyền truy cập</span>
            <span style={authStyles.badgePrimary}>
              {organizationOptions.length} Đơn vị tổ chức
            </span>
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Tạm khóa / Ngừng hoạt động
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: stats.lockedOrInactiveCount > 0 ? 'var(--accent)' : 'var(--text-main)',
              margin: '6px 0',
            }}
          >
            {stats.lockedOrInactiveCount}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgeWarning}>LOCKED / INACTIVE</span>
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Đã kích hoạt Bảo mật Đa lớp (MFA)
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--secondary)',
              margin: '6px 0',
            }}
          >
            {stats.mfaEnabledCount}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgeSuccess}>TOTP / Email / SMS OTP</span>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '16px',
            background:
              banner.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
            color: banner.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
            border:
              banner.type === 'success'
                ? '1px solid rgba(16, 185, 129, 0.35)'
                : '1px solid rgba(239, 68, 68, 0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            {banner.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '18px',
          padding: '6px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
        }}
      >
        {tabItems.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={
                active
                  ? authStyles.btnPrimary
                  : {
                      ...authStyles.btnSecondary,
                      background: 'transparent',
                      borderColor: 'transparent',
                    }
              }
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Directory & Profile Inspector */}
      {activeTab === USERS_TAB.DIRECTORY && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.35fr 1fr',
            gap: '18px',
            alignItems: 'start',
          }}
        >
          <UsersDirectoryTable
            users={users}
            selectedUserId={selectedUserId}
            onSelectUser={(id) => {
              setSelectedUserId(id);
              setInspectorMode('edit');
            }}
            onOpenCreateMode={() => setInspectorMode('create')}
            onOpenSecurityTab={(userId) => {
              setSelectedUserId(userId);
              setActiveTab(USERS_TAB.LIFECYCLE_SECURITY);
            }}
            filter={filter}
            onApplyFilter={applyFilter}
            pagination={pagination}
            roleOptions={roleOptions}
            organizationOptions={organizationOptions}
            loading={loading}
          />

          <UserInspectorDrawer
            mode={inspectorMode}
            selectedUser={selectedUser}
            allUsers={users}
            roleOptions={roleOptions}
            organizationOptions={organizationOptions}
            submitting={submitting}
            onSwitchToEdit={() => setInspectorMode('edit')}
            onCreateUser={handleCreateUser}
            onUpdateUser={handleUpdateUser}
            onAssignRoles={handleAssignRoles}
            onAssignOrganizations={handleAssignOrganizations}
          />
        </div>
      )}

      {/* Tab 2: Lifecycle, Security & Histories */}
      {activeTab === USERS_TAB.LIFECYCLE_SECURITY && (
        <UserLifecycleSecurityPanel
          users={users}
          selectedUser={selectedUser}
          onSelectUser={setSelectedUserId}
          statusHistory={statusHistory}
          loginHistory={loginHistory}
          loadingHistory={loadingHistory}
          submitting={submitting}
          lastPasswordResetResult={lastPasswordResetResult}
          lastMfaResetResult={lastMfaResetResult}
          onLifecycleAction={handleLifecycleAction}
          onResetPassword={handleResetPassword}
          onResetMfa={handleResetMfa}
          onRevokeSessions={handleRevokeSessions}
        />
      )}

      {/* Tab 3: Bulk Import & Export */}
      {activeTab === USERS_TAB.BULK_IMPORT_EXPORT && (
        <UsersBulkImportExportTab
          submitting={submitting}
          lastImportResult={lastImportResult}
          onDownloadTemplate={handleDownloadTemplate}
          onExportUsers={handleExportUsers}
          onBulkImport={handleBulkImport}
        />
      )}
    </main>
  );
};

