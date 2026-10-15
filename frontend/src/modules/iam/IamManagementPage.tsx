import React, { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../core/services/api';
import { API_ROUTES } from '../../routes/index';
import {
  Shield,
  Users,
  KeyRound,
  Building2,
  Lock,
  Unlock,
  UserPlus,
  Upload,
  Download,
  RefreshCw,
  Smartphone,
  Mail,
  LogOut,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface RoleOption {
  id: string;
  code: string;
  name: string;
  permissions: string[];
}

interface OrgUnitOption {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  path: string;
}

interface UserOrgAssignment {
  organizationUnitId: string;
  code: string;
  name: string;
  type: string;
  isPrimary: boolean;
  positionTitle?: string | null;
}

interface UserItem {
  id: string;
  email: string;
  username: string | null;
  fullName: string;
  phone?: string | null;
  phoneNumber?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'ARCHIVED';
  statusReason?: string | null;
  lockReason?: string | null;
  mfaEnabled: boolean;
  primaryOrganizationUnitId?: string | null;
  roles: { id: string; code: string; name: string }[];
  organizationUnits?: UserOrgAssignment[];
  organizations?: UserOrgAssignment[];
}

interface SessionItem {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

const PRIVILEGED_PRESET_ACCOUNTS = [
  { label: 'Super Admin', email: 'superadmin@gmail.com' },
  { label: 'System Admin', email: 'admin@gmail.com' },
  { label: 'Security Admin', email: 'admin.security@gmail.com' },
  { label: 'HR Admin', email: 'admin.hr@gmail.com' },
  { label: 'Mobile Admin', email: 'admin.mobile@gmail.com' },
  { label: 'System Console Admin', email: 'admin.ops@gmail.com' },
  { label: 'Finance Admin', email: 'admin.finance@gmail.com' },
  { label: 'Support Admin', email: 'admin.support@gmail.com' },
  { label: 'Branch Director HCM', email: 'director.hcm@gmail.com' },
  { label: 'Engineering Manager', email: 'manager.eng@gmail.com' },
];

export const IamManagementPage: React.FC = () => {
  const [subTab, setSubTab] = useState<'users' | 'auth' | 'orgs-roles'>('users');
  const [accessToken, setAccessToken] = useState<string>('');
  const [_refreshToken, setRefreshToken] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Auth & MFA state
  const [identifier, setIdentifier] = useState('superadmin@gmail.com');
  const [password, setPassword] = useState('!P@ssw0rd#');
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [availableMfaMethods, setAvailableMfaMethods] = useState<string[]>([]);
  const [selectedMfaMethod, setSelectedMfaMethod] = useState<'TOTP' | 'EMAIL_OTP' | 'RECOVERY_CODE'>('TOTP');
  const [mfaCode, setMfaCode] = useState('');
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpSetupCode, setTotpSetupCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaStatus, setMfaStatus] = useState<{
    mfaEnabled: boolean;
    totpEnabled: boolean;
    emailOtpEnabled: boolean;
    remainingRecoveryCodes: number;
  } | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Users, Roles, Organizations state
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [orgs, setOrgs] = useState<OrgUnitOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [orgFilter, setOrgFilter] = useState<string>('');

  // Create User form state
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('Abcd@454647#');
  const [newUserRoleIds, setNewUserRoleIds] = useState<string[]>([]);
  const [newUserOrgIds, setNewUserOrgIds] = useState<string[]>([]);
  const [newUserPrimaryOrgId, setNewUserPrimaryOrgId] = useState<string>('');

  // Bulk Import CSV text state
  const [bulkCsvText, setBulkCsvText] = useState(
    'minh.nguyenhoang01@gmail.com,minh.nguyenhoang01,Nguyễn Hoàng Minh,0901234567\nanh.tranthiminh02@gmail.com,anh.tranthiminh02,Trần Thị Minh Anh,0909876543',
  );

  // Create Role & Organization form state
  const [newRoleCode, setNewRoleCode] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePerms, setNewRolePerms] = useState('users.read,users.write');
  const [newOrgCode, setNewOrgCode] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState<'HEADQUARTERS' | 'BRANCH' | 'DEPARTMENT' | 'TEAM'>('DEPARTMENT');
  const [newOrgParentId, setNewOrgParentId] = useState<string>('');

  const authHeaders = useCallback((): Record<string, string> => {
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  }, [accessToken]);

  const notify = (type: 'ok' | 'err', text: string) => {
    setStatusBanner({ type, text });
  };

  const loadDirectoryData = useCallback(async () => {
    if (!accessToken) return;
    try {
      const qs = new URLSearchParams();
      if (searchQuery.trim()) qs.set('q', searchQuery.trim());
      if (statusFilter) qs.set('status', statusFilter);
      if (roleFilter) qs.set('roleId', roleFilter);
      if (orgFilter) qs.set('organizationUnitId', orgFilter);

      const [usersData, rolesData, orgsData] = await Promise.all([
        fetchApi<UserItem[] | { items: UserItem[] }>(API_ROUTES.USERS.LIST(qs.toString()), { headers: authHeaders() }),
        fetchApi<RoleOption[]>(API_ROUTES.ROLES.LIST, { headers: authHeaders() }),
        fetchApi<OrgUnitOption[]>(API_ROUTES.ORGANIZATIONS.LIST, { headers: authHeaders() }),
      ]);
      const normalizedUsers = Array.isArray(usersData)
        ? usersData
        : Array.isArray(usersData?.items)
          ? usersData.items
          : [];
      setUsers(normalizedUsers);
      setRoles(Array.isArray(rolesData) ? rolesData : []);
      setOrgs(Array.isArray(orgsData) ? orgsData : []);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to load IAM directory data');
    }
  }, [accessToken, authHeaders, orgFilter, roleFilter, searchQuery, statusFilter]);

  const loadAuthProfileData = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [mfa, sess] = await Promise.all([
        fetchApi<{
          mfaEnabled: boolean;
          totpEnabled: boolean;
          emailOtpEnabled: boolean;
          remainingRecoveryCodes: number;
        }>(API_ROUTES.AUTH.MFA_STATUS, { headers: authHeaders() }),
        fetchApi<SessionItem[]>(API_ROUTES.AUTH.SESSIONS, { headers: authHeaders() }),
      ]);
      setMfaStatus(mfa);
      setSessions(Array.isArray(sess) ? sess : []);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to load session/MFA status');
    }
  }, [accessToken, authHeaders]);

  useEffect(() => {
    if (accessToken) {
      void loadDirectoryData();
      void loadAuthProfileData();
    }
  }, [accessToken, loadDirectoryData, loadAuthProfileData]);

  // --- Auth Handlers ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchApi<{
        mfaRequired: boolean;
        mfaChallengeToken?: string;
        availableMfaMethods?: string[];
        accessToken?: string;
        refreshToken?: string;
        tokens?: { accessToken: string; refreshToken: string };
      }>(API_ROUTES.AUTH.LOGIN, {
        method: 'POST',
        body: JSON.stringify({ identifier, password, deviceName: 'Core Web UI' }),
      });

      const resolvedAccess = res.accessToken ?? res.tokens?.accessToken;
      const resolvedRefresh = res.refreshToken ?? res.tokens?.refreshToken ?? '';

      if (res.mfaRequired && res.mfaChallengeToken) {
        setMfaChallengeToken(res.mfaChallengeToken);
        setAvailableMfaMethods(res.availableMfaMethods ?? ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE']);
        notify('ok', 'Yêu cầu xác thực đa lớp (MFA). Vui lòng nhập mã TOTP hoặc gửi OTP qua Email.');
      } else if (resolvedAccess) {
        setAccessToken(resolvedAccess);
        setRefreshToken(resolvedRefresh);
        setMfaChallengeToken(null);
        notify('ok', 'Đăng nhập thành công!');
      }
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleSendEmailOtp = async () => {
    if (!mfaChallengeToken) return;
    try {
      const res = await fetchApi<{ sent: boolean; maskedEmail: string }>(
        API_ROUTES.AUTH.MFA_EMAIL_OTP_SEND,
        {
          method: 'POST',
          body: JSON.stringify({ mfaChallengeToken }),
        },
      );
      setSelectedMfaMethod('EMAIL_OTP');
      notify('ok', `Đã gửi mã OTP 6 chữ số tới ${res.maskedEmail}`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to send Email OTP');
    }
  };

  const handleVerifyMfaLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaChallengeToken) return;
    try {
      const res = await fetchApi<{
        accessToken?: string;
        refreshToken?: string;
        tokens?: { accessToken: string; refreshToken: string };
      }>(API_ROUTES.AUTH.MFA_VERIFY, {
        method: 'POST',
        body: JSON.stringify({
          mfaChallengeToken,
          method: selectedMfaMethod,
          code: mfaCode,
          deviceName: 'Core Web UI (MFA)',
        }),
      });
      const resolvedAccess = res.accessToken ?? res.tokens?.accessToken;
      const resolvedRefresh = res.refreshToken ?? res.tokens?.refreshToken ?? '';
      if (resolvedAccess) {
        setAccessToken(resolvedAccess);
        setRefreshToken(resolvedRefresh);
        setMfaChallengeToken(null);
        setMfaCode('');
        notify('ok', 'Xác thực 2 lớp thành công!');
      }
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'MFA verification failed');
    }
  };

  const handleSetupTotp = async () => {
    try {
      const res = await fetchApi<{ secret: string; otpauthUrl: string }>(
        API_ROUTES.AUTH.MFA_TOTP_SETUP,
        { method: 'POST', headers: authHeaders() },
      );
      setTotpSecret(res.secret);
      notify('ok', 'Đã khởi tạo khóa TOTP. Nhập mã 6 số từ ứng dụng Authenticator để kích hoạt.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to setup TOTP');
    }
  };

  const handleVerifyTotpSetup = async () => {
    try {
      const res = await fetchApi<{ totpEnabled: boolean; recoveryCodes: string[] }>(
        API_ROUTES.AUTH.MFA_TOTP_VERIFY_SETUP,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ code: totpSetupCode }),
        },
      );
      setRecoveryCodes(res.recoveryCodes);
      setTotpSecret(null);
      setTotpSetupCode('');
      await loadAuthProfileData();
      notify('ok', 'Đã bật TOTP thành công! Hãy lưu lại 8 mã khôi phục.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to verify TOTP setup');
    }
  };

  const handleToggleEmailOtp = async (enabled: boolean) => {
    try {
      await fetchApi(API_ROUTES.AUTH.MFA_EMAIL_OTP_TOGGLE, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ enabled }),
      });
      await loadAuthProfileData();
      notify('ok', enabled ? 'Đã bật xác thực Email OTP!' : 'Đã tắt xác thực Email OTP.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to toggle Email OTP');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi(API_ROUTES.AUTH.PASSWORD_CHANGE, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      notify('ok', 'Đổi mật khẩu thành công!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Change password failed');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await fetchApi(API_ROUTES.AUTH.REVOKE_SESSION(sessionId), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      await loadAuthProfileData();
      notify('ok', 'Đã thu hồi phiên đăng nhập.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Revoke session failed');
    }
  };

  // --- User Management Handlers ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const organizationsPayload = newUserOrgIds.map((orgId) => ({
        organizationUnitId: orgId,
        isPrimary: orgId === (newUserPrimaryOrgId || newUserOrgIds[0]),
      }));
      await fetchApi(API_ROUTES.USERS.CREATE, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          email: newUserEmail,
          username: newUserUsername || undefined,
          fullName: newUserFullName,
          phone: newUserPhone || undefined,
          password: newUserPassword,
          roleIds: newUserRoleIds,
          organizationUnits: organizationsPayload,
        }),
      });
      setNewUserEmail('');
      setNewUserUsername('');
      setNewUserFullName('');
      setNewUserPhone('');
      await loadDirectoryData();
      notify('ok', 'Tạo mới người dùng thành công!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Create user failed');
    }
  };

  const handleUserStatusAction = async (
    userId: string,
    action: 'lock' | 'unlock' | 'deactivate' | 'archive' | 'activate',
  ) => {
    try {
      if (action === 'lock') {
        await fetchApi(API_ROUTES.USERS.LOCK(userId), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ reason: 'Locked by administrator' }),
        });
      } else if (action === 'unlock') {
        await fetchApi(API_ROUTES.USERS.UNLOCK(userId), {
          method: 'POST',
          headers: authHeaders(),
        });
      } else if (action === 'deactivate') {
        await fetchApi(API_ROUTES.USERS.DEACTIVATE(userId), {
          method: 'POST',
          headers: authHeaders(),
        });
      } else if (action === 'archive') {
        await fetchApi(API_ROUTES.USERS.ARCHIVE(userId), {
          method: 'DELETE',
          headers: authHeaders(),
        });
      } else {
        await fetchApi(API_ROUTES.USERS.ACTIVATE(userId), {
          method: 'POST',
          headers: authHeaders(),
        });
      }
      await loadDirectoryData();
      notify('ok', `Đã cập nhật trạng thái người dùng (${action.toUpperCase()}).`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Status update failed');
    }
  };

  const handleBulkImport = async () => {
    try {
      const lines = bulkCsvText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const items = lines.map((line) => {
        const [email = '', username = '', fullName = '', phone = ''] = line
          .split(',')
          .map((s) => s.trim());
        return {
          email,
          username: username || undefined,
          fullName: fullName || email,
          phone: phone || undefined,
          password: 'Abcd@454647#',
        };
      });

      const res = await fetchApi<{ createdCount: number; failedCount: number }>(
        API_ROUTES.USERS.IMPORT,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ items }),
        },
      );
      await loadDirectoryData();
      notify(
        'ok',
        `Nhập hàng loạt hoàn tất: tạo mới ${res.createdCount}, lỗi ${res.failedCount}.`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Bulk import failed');
    }
  };

  const handleExportCsv = async () => {
    try {
      const qs = new URLSearchParams();
      if (searchQuery.trim()) qs.set('q', searchQuery.trim());
      if (statusFilter) qs.set('status', statusFilter);
      const csv = await fetchApi<string | { csv?: string }>(API_ROUTES.USERS.EXPORT(qs.toString()), {
        headers: authHeaders(),
      });
      const csvString =
        typeof csv === 'string'
          ? csv
          : typeof csv?.csv === 'string'
            ? csv.csv
            : JSON.stringify(csv);
      const blob = new Blob([csvString], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'users-export.csv';
      a.click();
      URL.revokeObjectURL(url);
      notify('ok', 'Đã xuất danh sách người dùng (CSV).');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Export CSV failed');
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi(API_ROUTES.ROLES.LIST, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          code: newRoleCode,
          name: newRoleName,
          permissions: newRolePerms
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
        }),
      });
      setNewRoleCode('');
      setNewRoleName('');
      await loadDirectoryData();
      notify('ok', 'Đã tạo vai trò mới!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Create role failed');
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi(API_ROUTES.ORGANIZATIONS.LIST, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          code: newOrgCode,
          name: newOrgName,
          type: newOrgType,
          parentId: newOrgParentId || null,
        }),
      });
      setNewOrgCode('');
      setNewOrgName('');
      await loadDirectoryData();
      notify('ok', 'Đã tạo đơn vị/chi nhánh mới!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Create organization unit failed');
    }
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-secondary, rgba(15, 23, 42, 0.7))',
    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.18))',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px',
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-primary, #0f172a)',
    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
    borderRadius: '8px',
    color: 'var(--text-main, #f8fafc)',
    padding: '8px 12px',
    fontSize: '14px',
    width: '100%',
  };

  return (
    <main style={{ maxWidth: '1240px', margin: '0 auto', padding: '32px 24px 80px', width: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '6px' }}>
            🛡️ Quản lý Người dùng & Xác thực (IAM Core)
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Tài khoản, đăng nhập, mật khẩu, phiên đăng nhập, xác thực đa lớp (TOTP + Email OTP) & quản trị người dùng đa đơn vị.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={subTab === 'users' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setSubTab('users')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px' }}
          >
            <Users size={15} /> Quản lý Người dùng (3.1)
          </button>
          <button
            type="button"
            className={subTab === 'auth' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setSubTab('auth')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px' }}
          >
            <KeyRound size={15} /> Xác thực, Phiên & MFA (3.0)
          </button>
          <button
            type="button"
            className={subTab === 'orgs-roles' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setSubTab('orgs-roles')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px' }}
          >
            <Building2 size={15} /> Vai trò & Đơn vị/Chi nhánh
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {statusBanner && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            borderRadius: '10px',
            marginBottom: '20px',
            background: statusBanner.type === 'ok' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.15)',
            border: `1px solid ${statusBanner.type === 'ok' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
            color: statusBanner.type === 'ok' ? '#34d399' : '#f87171',
            fontSize: '14px',
          }}
        >
          {statusBanner.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span style={{ flex: 1 }}>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Quick Auth Bar */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Shield size={18} />
            <span style={{ fontWeight: 600, fontSize: '14px' }}>
              Trạng thái phiên API:{' '}
              {accessToken ? (
                <span style={{ color: '#34d399' }}>Đã xác thực (JWT Bearer)</span>
              ) : (
                <span style={{ color: '#fbbf24' }}>Chưa đăng nhập</span>
              )}
            </span>
          </div>
          {accessToken ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void loadDirectoryData()}
                style={{ padding: '6px 12px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCw size={14} /> Làm mới dữ liệu
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setAccessToken('');
                  setRefreshToken('');
                  notify('ok', 'Đã đăng xuất.');
                }}
                style={{ padding: '6px 12px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <LogOut size={14} /> Đăng xuất
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void handleLogin(e)} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                style={{ ...inputStyle, width: '210px' }}
                placeholder="Email hoặc Username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
              <input
                type="password"
                style={{ ...inputStyle, width: '170px' }}
                placeholder="Mật khẩu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="submit" className="btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }}>
                Đăng nhập
              </button>
            </form>
          )}
        </div>

        {/* Preset Privileged Accounts Bar */}
        {!accessToken && (
          <div
            style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginRight: '4px' }}>
              Chọn nhanh TK đặc quyền (<code>!P@ssw0rd#</code>):
            </span>
            {PRIVILEGED_PRESET_ACCOUNTS.map((acct) => (
              <button
                key={acct.email}
                type="button"
                className="btn-secondary"
                style={{ padding: '3px 8px', fontSize: '11px' }}
                onClick={() => {
                  setIdentifier(acct.email);
                  setPassword('!P@ssw0rd#');
                }}
              >
                {acct.label} ({acct.email})
              </button>
            ))}
          </div>
        )}

        {/* 2-Step MFA Verification Modal/Banner when mfaRequired = true */}
        {mfaChallengeToken && (
          <form
            onSubmit={(e) => void handleVerifyMfaLogin(e)}
            style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600 }}>
              Xác thực 2 lớp ({availableMfaMethods.join(' / ')}):
            </span>
            <select
              style={{ ...inputStyle, width: '170px' }}
              value={selectedMfaMethod}
              onChange={(e) =>
                setSelectedMfaMethod(e.target.value as 'TOTP' | 'EMAIL_OTP' | 'RECOVERY_CODE')
              }
            >
              <option value="TOTP">Ứng dụng TOTP</option>
              <option value="EMAIL_OTP">Mã OTP qua Email</option>
              <option value="RECOVERY_CODE">Mã khôi phục</option>
            </select>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void handleSendEmailOtp()}
              style={{ padding: '8px 12px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Mail size={14} /> Gửi OTP tới Email
            </button>
            <input
              style={{ ...inputStyle, width: '160px' }}
              placeholder="Nhập mã 6 số / Recovery"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
            />
            <button type="submit" className="btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }}>
              Xác nhận MFA
            </button>
          </form>
        )}
      </div>

      {/* SUBTAB 1: USER MANAGEMENT (3.1) */}
      {subTab === 'users' && (
        <div>
          {/* Search & Filter Bar */}
          <div style={cardStyle}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <input
                style={inputStyle}
                placeholder="🔍 Tìm theo tên, email, username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                style={inputStyle}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">-- Tất cả trạng thái --</option>
                <option value="ACTIVE">ACTIVE (Hoạt động)</option>
                <option value="INACTIVE">INACTIVE (Vô hiệu hóa)</option>
                <option value="LOCKED">LOCKED (Đã khóa)</option>
                <option value="ARCHIVED">ARCHIVED (Lưu trữ)</option>
              </select>
              <select style={inputStyle} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="">-- Lọc theo vai trò --</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
              <select style={inputStyle} value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="">-- Lọc theo đơn vị/chi nhánh --</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.code})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void loadDirectoryData()}
                style={{ padding: '7px 14px', fontSize: '13px' }}
              >
                Tìm kiếm & Lọc
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleExportCsv()}
                style={{ padding: '7px 14px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Download size={14} /> Xuất danh sách CSV
              </button>
            </div>
          </div>

          {/* Users Table */}
          <div style={{ ...cardStyle, overflowX: 'auto' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '14px' }}>
              Danh sách người dùng ({users.length})
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 8px' }}>Họ tên / Email</th>
                  <th style={{ padding: '10px 8px' }}>Trạng thái</th>
                  <th style={{ padding: '10px 8px' }}>Vai trò (Roles)</th>
                  <th style={{ padding: '10px 8px' }}>Đơn vị / Chi nhánh (Multi-Org)</th>
                  <th style={{ padding: '10px 8px' }}>MFA</th>
                  <th style={{ padding: '10px 8px' }}>Thao tác quản trị</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Chưa có dữ liệu hoặc chưa đăng nhập tài khoản quản trị.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const orgList = u.organizationUnits ?? u.organizations ?? [];
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ fontWeight: 600 }}>{u.fullName}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                            {u.email} {u.username ? `(@${u.username})` : ''}
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background:
                                u.status === 'ACTIVE'
                                  ? 'rgba(16, 185, 129, 0.18)'
                                  : u.status === 'LOCKED'
                                    ? 'rgba(239, 68, 68, 0.2)'
                                    : 'rgba(148, 163, 184, 0.2)',
                              color:
                                u.status === 'ACTIVE'
                                  ? '#34d399'
                                  : u.status === 'LOCKED'
                                    ? '#f87171'
                                    : '#cbd5e1',
                            }}
                          >
                            {u.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          {u.roles.map((r) => r.code).join(', ') || '—'}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          {orgList.map((o) => (
                            <div key={o.organizationUnitId} style={{ fontSize: '12px' }}>
                              {o.name} ({o.code}){' '}
                              {o.isPrimary && (
                                <span style={{ color: '#38bdf8', fontWeight: 600 }}>[Chính]</span>
                              )}
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: '10px 8px' }}>{u.mfaEnabled ? '✅ Bật' : 'Tắt'}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {u.status === 'LOCKED' ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => void handleUserStatusAction(u.id, 'unlock')}
                            >
                              <Unlock size={12} /> Mở khóa
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => void handleUserStatusAction(u.id, 'lock')}
                            >
                              <Lock size={12} /> Khóa
                            </button>
                          )}
                          {u.status === 'ACTIVE' ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => void handleUserStatusAction(u.id, 'deactivate')}
                            >
                              Vô hiệu hóa
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => void handleUserStatusAction(u.id, 'activate')}
                            >
                              Kích hoạt
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                            onClick={() => void handleUserStatusAction(u.id, 'archive')}
                          >
                            Lưu trữ
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Create User + Bulk Import Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
            {/* Create User Form */}
            <form onSubmit={(e) => void handleCreateUser(e)} style={cardStyle}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserPlus size={16} /> Tạo mới người dùng & Gán Vai trò / Đơn vị
              </h3>
              <div style={{ display: 'grid', gap: '10px' }}>
                <input
                  style={inputStyle}
                  placeholder="Email (*)"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <input
                    style={inputStyle}
                    placeholder="Username"
                    value={newUserUsername}
                    onChange={(e) => setNewUserUsername(e.target.value)}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Số điện thoại"
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                  />
                </div>
                <input
                  style={inputStyle}
                  placeholder="Họ và tên (*)"
                  required
                  value={newUserFullName}
                  onChange={(e) => setNewUserFullName(e.target.value)}
                />
                <input
                  type="password"
                  style={inputStyle}
                  placeholder="Mật khẩu khởi tạo (*)"
                  required
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                />

                {/* Multi-role selection */}
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Gán vai trò (Roles):</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {roles.map((r) => {
                    const checked = newUserRoleIds.includes(r.id);
                    return (
                      <label key={r.id} style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setNewUserRoleIds([...newUserRoleIds, r.id]);
                            else setNewUserRoleIds(newUserRoleIds.filter((id) => id !== r.id));
                          }}
                        />
                        {r.name} ({r.code})
                      </label>
                    );
                  })}
                </div>

                {/* Multi-organization unit selection */}
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Gán nhiều đơn vị / chi nhánh (Multi-Organization Units):
                </div>
                <div style={{ display: 'grid', gap: '6px' }}>
                  {orgs.map((o) => {
                    const checked = newUserOrgIds.includes(o.id);
                    return (
                      <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                const next = [...newUserOrgIds, o.id];
                                setNewUserOrgIds(next);
                                if (!newUserPrimaryOrgId) setNewUserPrimaryOrgId(o.id);
                              } else {
                                setNewUserOrgIds(newUserOrgIds.filter((id) => id !== o.id));
                              }
                            }}
                          />
                          {o.name} ({o.code} - {o.type})
                        </label>
                        {checked && (
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#38bdf8' }}>
                            <input
                              type="radio"
                              name="primaryOrg"
                              checked={(newUserPrimaryOrgId || newUserOrgIds[0]) === o.id}
                              onChange={() => setNewUserPrimaryOrgId(o.id)}
                            />
                            Đơn vị chính
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button type="submit" className="btn-primary" style={{ marginTop: '6px', padding: '9px 16px' }}>
                  Tạo người dùng
                </button>
              </div>
            </form>

            {/* Bulk Import Users */}
            <div style={cardStyle}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Upload size={16} /> Nhập người dùng hàng loạt (Bulk Import)
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Định dạng mỗi dòng: <code>email,username,fullName,phoneNumber</code>
              </p>
              <textarea
                rows={6}
                style={{ ...inputStyle, fontFamily: 'monospace', marginBottom: '12px' }}
                value={bulkCsvText}
                onChange={(e) => setBulkCsvText(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleBulkImport()}
                style={{ padding: '9px 16px', width: '100%' }}
              >
                Thực thi Import hàng loạt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: AUTH, PASSWORD, SESSIONS & MFA (3.0) */}
      {subTab === 'auth' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
          {/* MFA Configuration (TOTP + Email OTP) */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Smartphone size={16} /> Xác thực nhiều lớp (TOTP & Email OTP)
            </h3>
            <div style={{ fontSize: '13px', marginBottom: '14px', lineHeight: 1.7 }}>
              <div>• Trạng thái MFA tổng: <strong>{mfaStatus?.mfaEnabled ? 'ĐANG BẬT' : 'ĐANG TẮT'}</strong></div>
              <div>• TOTP (Google Authenticator): <strong>{mfaStatus?.totpEnabled ? 'Đã kích hoạt' : 'Chưa kích hoạt'}</strong></div>
              <div>• Email OTP (Mã 6 số qua Email): <strong>{mfaStatus?.emailOtpEnabled ? 'Đã kích hoạt' : 'Chưa kích hoạt'}</strong></div>
              <div>• Số mã khôi phục còn lại: <strong>{mfaStatus?.remainingRecoveryCodes ?? 0}</strong></div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleSetupTotp()}
                style={{ padding: '7px 12px', fontSize: '13px' }}
              >
                Thiết lập TOTP
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleToggleEmailOtp(!mfaStatus?.emailOtpEnabled)}
                style={{ padding: '7px 12px', fontSize: '13px' }}
              >
                {mfaStatus?.emailOtpEnabled ? 'Tắt Email OTP' : 'Bật Email OTP'}
              </button>
            </div>

            {totpSecret && (
              <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.1)', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', marginBottom: '6px' }}>
                  Secret Base32: <code>{totpSecret}</code>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    style={inputStyle}
                    placeholder="Nhập mã 6 số TOTP"
                    value={totpSetupCode}
                    onChange={(e) => setTotpSetupCode(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleVerifyTotpSetup()}
                    style={{ padding: '7px 14px', fontSize: '13px' }}
                  >
                    Kích hoạt
                  </button>
                </div>
              </div>
            )}

            {recoveryCodes.length > 0 && (
              <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.12)', fontSize: '12px' }}>
                <div style={{ fontWeight: 700, marginBottom: '6px' }}>Mã khôi phục dự phòng (lưu lại an toàn):</div>
                <code>{recoveryCodes.join(' , ')}</code>
              </div>
            )}
          </div>

          {/* Password Management */}
          <form onSubmit={(e) => void handleChangePassword(e)} style={cardStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <KeyRound size={16} /> Quản lý mật khẩu
            </h3>
            <div style={{ display: 'grid', gap: '10px' }}>
              <input
                type="password"
                style={inputStyle}
                placeholder="Mật khẩu hiện tại"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <input
                type="password"
                style={inputStyle}
                placeholder="Mật khẩu mới (tối thiểu 8 ký tự)"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button type="submit" className="btn-primary" style={{ padding: '8px 16px' }}>
                Đổi mật khẩu & Thu hồi phiên khác
              </button>
            </div>
          </form>

          {/* Active Sessions */}
          <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
               Quản lý phiên đăng nhập (Active Sessions: {sessions.length})
            </h3>
            <div style={{ display: 'grid', gap: '8px' }}>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    fontSize: '13px',
                  }}
                >
                  <div>
                    <strong>{s.deviceName || 'Unknown Device'}</strong> — IP: {s.ipAddress || 'N/A'}
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Hoạt động cuối: {new Date(s.lastActiveAt).toLocaleString()} | Hết hạn:{' '}
                      {new Date(s.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '5px 10px', fontSize: '12px' }}
                    onClick={() => void handleRevokeSession(s.id)}
                  >
                    Thu hồi phiên
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 3: ROLES & ORGANIZATION UNITS */}
      {subTab === 'orgs-roles' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
          {/* Organization Units Manager */}
          <form onSubmit={(e) => void handleCreateOrg(e)} style={cardStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
              🏢 Tạo Đơn vị / Chi nhánh (Organization Unit)
            </h3>
            <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
              <input
                style={inputStyle}
                placeholder="Mã đơn vị (VD: BRANCH_HN)"
                required
                value={newOrgCode}
                onChange={(e) => setNewOrgCode(e.target.value)}
              />
              <input
                style={inputStyle}
                placeholder="Tên đơn vị / chi nhánh"
                required
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
              />
              <select
                style={inputStyle}
                value={newOrgType}
                onChange={(e) =>
                  setNewOrgType(e.target.value as 'HEADQUARTERS' | 'BRANCH' | 'DEPARTMENT' | 'TEAM')
                }
              >
                <option value="HEADQUARTERS">HEADQUARTERS (Trụ sở chính)</option>
                <option value="BRANCH">BRANCH (Chi nhánh)</option>
                <option value="DEPARTMENT">DEPARTMENT (Phòng ban)</option>
                <option value="TEAM">TEAM (Nhóm)</option>
              </select>
              <select
                style={inputStyle}
                value={newOrgParentId}
                onChange={(e) => setNewOrgParentId(e.target.value)}
              >
                <option value="">-- Không có đơn vị cha (Root) --</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.code})
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary" style={{ padding: '8px 16px' }}>
                Thêm đơn vị / chi nhánh
              </button>
            </div>

            <div style={{ fontSize: '13px' }}>
              <strong>Danh sách đơn vị hiện có ({orgs.length}):</strong>
              <ul style={{ marginTop: '8px', paddingLeft: '18px', lineHeight: 1.7 }}>
                {orgs.map((o) => (
                  <li key={o.id}>
                    <strong>{o.name}</strong> ({o.code}) — <code>{o.type}</code>
                  </li>
                ))}
              </ul>
            </div>
          </form>

          {/* Roles Manager */}
          <form onSubmit={(e) => void handleCreateRole(e)} style={cardStyle}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
              🔑 Tạo Vai trò & Quyền hạn (RBAC Role)
            </h3>
            <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
              <input
                style={inputStyle}
                placeholder="Mã vai trò (VD: branch_manager)"
                required
                value={newRoleCode}
                onChange={(e) => setNewRoleCode(e.target.value)}
              />
              <input
                style={inputStyle}
                placeholder="Tên hiển thị vai trò"
                required
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
              />
              <input
                style={inputStyle}
                placeholder="Danh sách quyền (cách nhau dấu phẩy)"
                value={newRolePerms}
                onChange={(e) => setNewRolePerms(e.target.value)}
              />
              <button type="submit" className="btn-primary" style={{ padding: '8px 16px' }}>
                Thêm vai trò
              </button>
            </div>

            <div style={{ fontSize: '13px' }}>
              <strong>Danh sách vai trò hiện có ({roles.length}):</strong>
              <ul style={{ marginTop: '8px', paddingLeft: '18px', lineHeight: 1.7 }}>
                {roles.map((r) => (
                  <li key={r.id}>
                    <strong>{r.name}</strong> (<code>{r.code}</code>) — {r.permissions.length} quyền
                  </li>
                ))}
              </ul>
            </div>
          </form>
        </div>
      )}
    </main>
  );
};
