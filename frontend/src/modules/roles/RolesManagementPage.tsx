import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Compass,
  FileCheck,
  Grid,
  KeyRound,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { authStyles } from '../auth/components/auth-ui.styles';
import { ROLES_TAB, type RolesTabId } from './enum/roles.enum';
import { useRolesManagement } from './hooks/useRolesManagement';
import { RolesDirectoryTab } from './components/RolesDirectoryTab';
import { RolePermissionMatrixTab } from './components/RolePermissionMatrixTab';
import { RoleDataScopesTab } from './components/RoleDataScopesTab';
import { RoleAuditSecurityTab } from './components/RoleAuditSecurityTab';

export const RolesManagementPage: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    loading,
    submitting,
    banner,
    setBanner,
    roles,
    filteredRoles,
    selectedRole,
    selectedRoleId,
    setSelectedRoleId,
    assignedUsers,
    loadingAssignedUsers,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    scopeFilter,
    setScopeFilter,
    permissionGroups,
    matrix,
    orphans,
    lastSyncResult,
    effectiveScope,
    customRules,
    auditLogs,
    auditMeta,
    auditFilter,
    selectedAuditLog,
    setSelectedAuditLog,
    securityEvents,
    securityAlerts,
    stats,
    refreshAll,
    handleCreateRole,
    handleUpdateRole,
    handleCloneRole,
    handleDeleteRole,
    handleSetRolePermissions,
    handleSyncPermissions,
    handleRegisterCustomScopeRule,
    handleApplyAuditFilter,
  } = useRolesManagement();

  const tabItems: readonly { id: RolesTabId; label: string; icon: React.ReactNode }[] = [
    {
      id: ROLES_TAB.DIRECTORY,
      label: `Danh mục Vai trò (${stats.totalRoles})`,
      icon: <Shield size={15} />,
    },
    {
      id: ROLES_TAB.MATRIX,
      label: `Ma trận Quyền hạn (${stats.totalPermissions})`,
      icon: <Grid size={15} />,
    },
    {
      id: ROLES_TAB.DATA_SCOPES,
      label: 'Phạm vi Dữ liệu (Data Scope)',
      icon: <Compass size={15} />,
    },
    {
      id: ROLES_TAB.AUDIT_SECURITY,
      label: `Audit Log & SIEM (${auditMeta.totalItems})`,
      icon: <FileCheck size={15} />,
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
            <KeyRound size={24} />
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
                Quản Trị Vai Trò, Ma Trận Phân Quyền RBAC & Phạm Vi Dữ Liệu
              </h1>
              <span style={authStyles.badgePrimary}>RBAC + Data Scope 4 Tiers</span>
              <span style={authStyles.badgeSuccess}>Immutable Audit Log</span>
            </div>
            <p
              style={{
                fontSize: '13.5px',
                color: 'var(--text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Đồng bộ quyền hạn từ <code>module.manifest.json</code>, kiểm soát phạm vi dữ liệu{' '}
              <code>ALL / ORG_UNIT / SUBORDINATES / SELF</code> và giám sát nhật ký kiểm toán bất biến.
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
            Tổng số Vai trò (Roles)
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--text-main)',
              margin: '6px 0',
            }}
          >
            {stats.totalRoles}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgePrimary}>{stats.systemRoles} Hệ thống</span>
            <span style={authStyles.badgeSuccess}>{stats.customRoles} Tùy chỉnh</span>
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Danh mục Quyền hạn (Permissions)
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--primary)',
              margin: '6px 0',
            }}
          >
            {stats.totalPermissions}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgeSuccess}>
              {permissionGroups.length} Nhóm chức năng
            </span>
            {stats.orphanedCount > 0 && (
              <span style={authStyles.badgeWarning}>{stats.orphanedCount} Quyền mồ côi</span>
            )}
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Phạm vi Dữ liệu Hiệu lực (My Scope)
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: 'var(--secondary)',
              margin: '8px 0',
            }}
          >
            {effectiveScope?.filter.effectiveScopeName ?? 'ALL'}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgeWarning}>
              {stats.allScopeRoles} Vai trò cấp ALL
            </span>
            <span style={authStyles.badgePrimary}>{customRules.length} Custom Rules</span>
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Kiểm toán & Cảnh báo SIEM
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--text-main)',
              margin: '6px 0',
            }}
          >
            {auditMeta.totalItems}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgePrimary}>{securityEvents.length} Security Events</span>
            {stats.securityAlertsCount > 0 ? (
              <span style={authStyles.badgeDanger}>{stats.securityAlertsCount} SIEM Alerts</span>
            ) : (
              <span style={authStyles.badgeSuccess}>0 SIEM Alerts</span>
            )}
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
              banner.type === 'success'
                ? 'var(--status-success-bg)'
                : 'var(--status-danger-bg)',
            color:
              banner.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
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

      {/* Tab Content */}
      {activeTab === ROLES_TAB.DIRECTORY && (
        <RolesDirectoryTab
          roles={filteredRoles}
          selectedRole={selectedRole}
          selectedRoleId={selectedRoleId}
          onSelectRole={setSelectedRoleId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          scopeFilter={scopeFilter}
          onScopeFilterChange={setScopeFilter}
          permissionGroups={permissionGroups}
          assignedUsers={assignedUsers}
          loadingAssignedUsers={loadingAssignedUsers}
          submitting={submitting}
          onCreateRole={handleCreateRole}
          onUpdateRole={handleUpdateRole}
          onCloneRole={handleCloneRole}
          onDeleteRole={handleDeleteRole}
        />
      )}

      {activeTab === ROLES_TAB.MATRIX && (
        <RolePermissionMatrixTab
          matrix={matrix}
          orphans={orphans}
          lastSyncResult={lastSyncResult}
          submitting={submitting}
          onSyncPermissions={handleSyncPermissions}
          onSaveRolePermissions={handleSetRolePermissions}
        />
      )}

      {activeTab === ROLES_TAB.DATA_SCOPES && (
        <RoleDataScopesTab
          effectiveScope={effectiveScope}
          customRules={customRules}
          roles={roles}
          submitting={submitting}
          onRegisterCustomRule={handleRegisterCustomScopeRule}
        />
      )}

      {activeTab === ROLES_TAB.AUDIT_SECURITY && (
        <RoleAuditSecurityTab
          auditLogs={auditLogs}
          auditMeta={auditMeta}
          auditFilter={auditFilter}
          selectedAuditLog={selectedAuditLog}
          onSelectAuditLog={setSelectedAuditLog}
          onApplyAuditFilter={handleApplyAuditFilter}
          securityEvents={securityEvents}
          securityAlerts={securityAlerts}
        />
      )}
    </main>
  );
};

