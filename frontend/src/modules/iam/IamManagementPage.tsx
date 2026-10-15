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
  id: number;
  code: string;
  name: string;
  status?: number;
  statusName?: string;
  permissions: string[];
}

interface OrgUnitOption {
  id: number;
  code: string;
  name: string;
  type: number;
  typeName?: string;
  parentId: number | null;
  status?: number;
  statusName?: string;
  path?: string;
}

interface UserOrgAssignment {
  organizationUnitId: number;
  code: string;
  name: string;
  type: number;
  typeName?: string;
  isPrimary: boolean;
  positionTitle?: string | null;
}

interface UserItem {
  id: number;
  email: string;
  username: string | null;
  firstName?: string;
  lastName?: string;
  fullName: string;
  phone?: string | null;
  phoneNumber?: string | null;
  status: number | 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'ARCHIVED';
  statusName?: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'ARCHIVED';
  statusReason?: string | null;
  lockReason?: string | null;
  mfaEnabled: boolean;
  primaryOrganizationUnitId?: number | null;
  roles: { id: number; code: string; name: string }[];
  organizationUnits?: UserOrgAssignment[];
  organizations?: UserOrgAssignment[];
}

interface SessionItem {
  id: number;
  deviceName: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

const getUserStatusLabel = (u: Pick<UserItem, 'status' | 'statusName'>): 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'ARCHIVED' => {
  if (u.statusName) return u.statusName;
  if (u.status === 1 || u.status === 'ACTIVE') return 'ACTIVE';
  if (u.status === 2 || u.status === 'INACTIVE') return 'INACTIVE';
  if (u.status === 3 || u.status === 'LOCKED') return 'LOCKED';
  return 'ARCHIVED';
};

const PRIVILEGED_PRESET_ACCOUNTS = [
  { label: 'Super Admin (#1)', email: 'superadmin@gmail.com' },
  { label: 'System Admin (#2)', email: 'admin@gmail.com' },
  { label: 'Security Admin (#3)', email: 'admin.security@gmail.com' },
  { label: 'HR Admin (#4)', email: 'admin.hr@gmail.com' },
  { label: 'Mobile Admin (#5)', email: 'admin.mobile@gmail.com' },
  { label: 'System Console Admin (#6)', email: 'admin.ops@gmail.com' },
  { label: 'Finance Admin (#7)', email: 'admin.finance@gmail.com' },
  { label: 'Support Admin (#8)', email: 'admin.support@gmail.com' },
  { label: 'Branch Director HCM (#9)', email: 'director.hcm@gmail.com' },
  { label: 'Engineering Manager (#10)', email: 'manager.eng@gmail.com' },
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
  const [newUserFirstName, setNewUserFirstName] = useState('');
  const [newUserLastName, setNewUserLastName] = useState('');
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('Abcd@454647#');
  const [newUserRoleIds, setNewUserRoleIds] = useState<number[]>([]);
  const [newUserOrgIds, setNewUserOrgIds] = useState<number[]>([]);
  const [newUserPrimaryOrgId, setNewUserPrimaryOrgId] = useState<number | null>(null);

  // Bulk Import Excel (.xlsx) / CSV state
  const [bulkCsvText, setBulkCsvText] = useState(
    'username,email,lastName,firstName,fullName,phone,status,roles,organizations\nminh.nguyenhoang01,minh.nguyenhoang01@gmail.com,Nguyễn Hoàng,Minh,Nguyễn Hoàng Minh,0901234567,1,staff,BRANCH_HCM|DEPT_ENGINEERING\nanh.tranthiminh02,anh.tranthiminh02@gmail.com,Trần Thị Minh,Anh,Trần Thị Minh Anh,0909876543,1,staff,BRANCH_HCM|DEPT_HR',
  );
  const [bulkXlsxBase64, setBulkXlsxBase64] = useState<string | null>(null);
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const [bulkImportReport, setBulkImportReport] = useState<{
    totalRows: number;
    importedCount: number;
    skippedCount: number;
    failedCount: number;
    errors: Array<{ row: number; identifier: string; message: string }>;
  } | null>(null);

  // User Status History & Status Change modal state (Mục 3.1.10)
  const [statusHistoryUser, setStatusHistoryUser] = useState<UserItem | null>(null);
  const [statusHistoryList, setStatusHistoryList] = useState<
    Array<{
      id: number;
      userId: number;
      fromStatus: number | null;
      fromStatusName: string | null;
      toStatus: number;
      toStatusName: string;
      reason: string | null;
      changedBy: number | null;
      createdAt: string;
    }>
  >([]);
  const [statusChangeTarget, setStatusChangeTarget] = useState<number>(1);
  const [statusChangeReason, setStatusChangeReason] = useState<string>('');

  // Create Role & Organization form state
  const [newRoleCode, setNewRoleCode] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePerms, setNewRolePerms] = useState('users.read,users.update');
  const [newOrgCode, setNewOrgCode] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState<number>(3);
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

  const handleRevokeSession = async (sessionId: number) => {
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
        isPrimary: orgId === (newUserPrimaryOrgId ?? newUserOrgIds[0]),
      }));
      await fetchApi(API_ROUTES.USERS.CREATE, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          email: newUserEmail,
          username: newUserUsername || undefined,
          firstName: newUserFirstName || undefined,
          lastName: newUserLastName || undefined,
          fullName:
            newUserFullName ||
            `${newUserLastName} ${newUserFirstName}`.trim() ||
            newUserEmail,
          phone: newUserPhone || undefined,
          password: newUserPassword,
          roleIds: newUserRoleIds,
          organizationUnits: organizationsPayload,
        }),
      });
      setNewUserEmail('');
      setNewUserUsername('');
      setNewUserFirstName('');
      setNewUserLastName('');
      setNewUserFullName('');
      setNewUserPhone('');
      await loadDirectoryData();
      notify('ok', 'Tạo mới người dùng thành công!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Create user failed');
    }
  };

  const handleUserStatusAction = async (
    userId: number,
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

  const handleOpenStatusHistory = async (user: UserItem) => {
    setStatusHistoryUser(user);
    setStatusChangeTarget(typeof user.status === 'number' ? user.status : 1);
    setStatusChangeReason(user.lockReason ?? '');
    try {
      const history = await fetchApi<
        Array<{
          id: number;
          userId: number;
          fromStatus: number | null;
          fromStatusName: string | null;
          toStatus: number;
          toStatusName: string;
          reason: string | null;
          changedBy: number | null;
          createdAt: string;
        }>
      >(API_ROUTES.USERS.STATUS_HISTORY(user.id), { headers: authHeaders() });
      setStatusHistoryList(Array.isArray(history) ? history : []);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to load user status history');
    }
  };

  const handleSubmitStatusChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusHistoryUser) return;
    try {
      const updated = await fetchApi<UserItem>(API_ROUTES.USERS.STATUS(statusHistoryUser.id), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          status: statusChangeTarget,
          reason: statusChangeReason.trim() || 'Cập nhật trạng thái từ bảng điều khiển IAM',
        }),
      });
      await loadDirectoryData();
      await handleOpenStatusHistory(updated);
      notify('ok', `Đã chuyển trạng thái người dùng #${statusHistoryUser.id} sang mã ${statusChangeTarget} và ghi lịch sử.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to change user status');
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    setBulkImportReport(null);

    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.replace(/^data:[^;]+;base64,/i, '');
        setBulkXlsxBase64(base64);
        notify('ok', `Đã nạp file Excel "${file.name}" (${Math.round(file.size / 1024)} KB). Nhấn "Thực thi Import" để kiểm tra & nhập dữ liệu.`);
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        setBulkXlsxBase64(null);
        setBulkCsvText(text);
        notify('ok', `Đã nạp nội dung file CSV "${file.name}".`);
      };
      reader.readAsText(file, 'utf-8');
    }
  };

  const handleBulkImport = async () => {
    try {
      const payload = bulkXlsxBase64
        ? { xlsxBase64: bulkXlsxBase64, skipDuplicates: true }
        : { csvContent: bulkCsvText, skipDuplicates: true };

      const res = await fetchApi<{
        totalRows: number;
        importedCount: number;
        skippedCount: number;
        failedCount: number;
        errors: Array<{ row: number; identifier: string; message: string }>;
      }>(API_ROUTES.USERS.IMPORT, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      setBulkImportReport(res);
      await loadDirectoryData();
      notify(
        res.failedCount > 0 ? 'err' : 'ok',
        `Nhập hàng loạt hoàn tất: tổng ${res.totalRows} dòng | tạo mới ${res.importedCount} | bỏ qua trùng ${res.skippedCount} | lỗi ${res.failedCount}.`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Bulk import failed');
    }
  };

  const downloadBase64OrCsv = (
    data: {
      fileName?: string;
      format?: 'csv' | 'xlsx';
      csvContent?: string;
      xlsxBase64?: string;
    },
    requestedFormat: 'csv' | 'xlsx',
    fallbackName: string,
  ) => {
    if (requestedFormat === 'xlsx' && data.xlsxBase64) {
      const binary = window.atob(data.xlsxBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.fileName || `${fallbackName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const csvText = data.csvContent ?? '';
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.fileName || `${fallbackName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportUsers = async (format: 'csv' | 'xlsx' = 'csv') => {
    try {
      const qs = new URLSearchParams();
      if (searchQuery.trim()) qs.set('q', searchQuery.trim());
      if (statusFilter) qs.set('status', statusFilter);
      if (roleFilter) qs.set('roleId', roleFilter);
      if (orgFilter) qs.set('organizationUnitId', orgFilter);
      qs.set('format', format);

      const res = await fetchApi<{
        fileName: string;
        format: 'csv' | 'xlsx';
        totalExported: number;
        csvContent: string;
        xlsxBase64: string;
      }>(API_ROUTES.USERS.EXPORT(qs.toString()), {
        headers: authHeaders(),
      });

      downloadBase64OrCsv(res, format, 'users-export');
      notify('ok', `Đã xuất ${res.totalExported} người dùng ra file ${format.toUpperCase()}.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : `Export ${format.toUpperCase()} failed`);
    }
  };

  const handleDownloadImportTemplate = async (format: 'csv' | 'xlsx' = 'xlsx') => {
    try {
      const res = await fetchApi<{
        fileName: string;
        format: 'csv' | 'xlsx';
        csvContent: string;
        xlsxBase64: string;
      }>(API_ROUTES.USERS.IMPORT_TEMPLATE(format), {
        headers: authHeaders(),
      });
      downloadBase64OrCsv(res, format, 'users-import-template');
      notify('ok', `Đã tải file mẫu Import (${format.toUpperCase()}).`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Download template failed');
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
          parentId: newOrgParentId ? Number(newOrgParentId) : null,
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
                <option value="1">1 - ACTIVE (Hoạt động)</option>
                <option value="2">2 - INACTIVE (Vô hiệu hóa)</option>
                <option value="3">3 - LOCKED (Đã khóa)</option>
                <option value="4">4 - ARCHIVED (Lưu trữ)</option>
              </select>
              <select style={inputStyle} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="">-- Lọc theo vai trò --</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    #{r.id} - {r.name} ({r.code})
                  </option>
                ))}
              </select>
              <select style={inputStyle} value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="">-- Lọc theo đơn vị/chi nhánh --</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.id} - {o.name} ({o.code})
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
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleExportUsers('xlsx')}
                  style={{ padding: '7px 14px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} /> Xuất Excel (.xlsx)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleExportUsers('csv')}
                  style={{ padding: '7px 14px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} /> Xuất CSV (.csv)
                </button>
              </div>
            </div>
          </div>

          {/* Status History & Direct Status Transition Panel (3.1.10) */}
          {statusHistoryUser && (
            <div style={{ ...cardStyle, border: '1px solid rgba(56, 189, 248, 0.35)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                  📜 Quản lý & Lịch sử thay đổi trạng thái — #{statusHistoryUser.id} {statusHistoryUser.fullName} ({statusHistoryUser.email})
                </h3>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => setStatusHistoryUser(null)}
                >
                  Đóng
                </button>
              </div>

              <form
                onSubmit={(e) => void handleSubmitStatusChange(e)}
                style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}
              >
                <select
                  style={{ ...inputStyle, width: '220px' }}
                  value={statusChangeTarget}
                  onChange={(e) => setStatusChangeTarget(Number(e.target.value))}
                >
                  <option value={1}>1 - ACTIVE (Hoạt động)</option>
                  <option value={2}>2 - INACTIVE (Vô hiệu hóa)</option>
                  <option value={3}>3 - LOCKED (Tạm khóa)</option>
                  <option value={4}>4 - ARCHIVED (Lưu trữ)</option>
                </select>
                <input
                  style={{ ...inputStyle, flex: 1, minWidth: '240px' }}
                  placeholder="Lý do chuyển trạng thái (bắt buộc để lưu vết kiểm toán)..."
                  value={statusChangeReason}
                  onChange={(e) => setStatusChangeReason(e.target.value)}
                />
                <button type="submit" className="btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Cập nhật trạng thái & Ghi lịch sử
                </button>
              </form>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                      <th style={{ padding: '8px' }}>ID</th>
                      <th style={{ padding: '8px' }}>Từ trạng thái</th>
                      <th style={{ padding: '8px' }}>Sang trạng thái</th>
                      <th style={{ padding: '8px' }}>Lý do thay đổi</th>
                      <th style={{ padding: '8px' }}>Người thực hiện (ID)</th>
                      <th style={{ padding: '8px' }}>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusHistoryList.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          Chưa có bản ghi lịch sử thay đổi trạng thái.
                        </td>
                      </tr>
                    ) : (
                      statusHistoryList.map((h) => (
                        <tr key={h.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                          <td style={{ padding: '8px' }}>#{h.id}</td>
                          <td style={{ padding: '8px' }}>
                            {h.fromStatus !== null ? `${h.fromStatus} (${h.fromStatusName})` : 'Khởi tạo'}
                          </td>
                          <td style={{ padding: '8px', fontWeight: 700, color: '#38bdf8' }}>
                            {h.toStatus} ({h.toStatusName})
                          </td>
                          <td style={{ padding: '8px' }}>{h.reason || '—'}</td>
                          <td style={{ padding: '8px' }}>{h.changedBy ? `User #${h.changedBy}` : 'System'}</td>
                          <td style={{ padding: '8px' }}>{new Date(h.createdAt).toLocaleString('vi-VN')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Users Table */}
          <div style={{ ...cardStyle, overflowX: 'auto' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '14px' }}>
              Danh sách người dùng ({users.length})
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 8px' }}>ID / Họ tên / Email</th>
                  <th style={{ padding: '10px 8px' }}>Trạng thái (STT)</th>
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
                    const statusLabel = getUserStatusLabel(u);
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ fontWeight: 600 }}>
                            <span style={{ color: '#38bdf8', marginRight: '6px' }}>#{u.id}</span>
                            {u.fullName}
                            {u.firstName && u.lastName ? (
                              <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '11px', marginLeft: '6px' }}>
                                (Họ: {u.lastName} | Tên: {u.firstName})
                              </span>
                            ) : null}
                          </div>
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
                                statusLabel === 'ACTIVE'
                                  ? 'rgba(16, 185, 129, 0.18)'
                                  : statusLabel === 'LOCKED'
                                    ? 'rgba(239, 68, 68, 0.2)'
                                    : 'rgba(148, 163, 184, 0.2)',
                              color:
                                statusLabel === 'ACTIVE'
                                  ? '#34d399'
                                  : statusLabel === 'LOCKED'
                                    ? '#f87171'
                                    : '#cbd5e1',
                            }}
                          >
                            {u.status} ({statusLabel})
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
                          {statusLabel === 'LOCKED' ? (
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
                          {statusLabel === 'ACTIVE' ? (
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
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '12px', color: '#38bdf8' }}
                            onClick={() => void handleOpenStatusHistory(u)}
                          >
                            📜 Lịch sử TT
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <input
                    style={inputStyle}
                    placeholder="Họ và tên đệm (Last Name)"
                    value={newUserLastName}
                    onChange={(e) => setNewUserLastName(e.target.value)}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Tên (First Name)"
                    value={newUserFirstName}
                    onChange={(e) => setNewUserFirstName(e.target.value)}
                  />
                </div>
                <input
                  style={inputStyle}
                  placeholder="Họ và tên đầy đủ (Full Name)"
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
                        #{r.id} {r.name} ({r.code})
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
                          #{o.id} {o.name} ({o.code} - {o.typeName ?? o.type})
                        </label>
                        {checked && (
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#38bdf8' }}>
                            <input
                              type="radio"
                              name="primaryOrg"
                              checked={(newUserPrimaryOrgId ?? newUserOrgIds[0]) === o.id}
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

            {/* Bulk Import Users (Excel .xlsx & CSV) */}
            <div style={cardStyle}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Upload size={16} /> Nhập người dùng hàng loạt (Excel .xlsx / CSV)
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Hỗ trợ tải lên trực tiếp file <strong>Excel (.xlsx)</strong> hoặc <strong>CSV (.csv)</strong> có kiểm tra dữ liệu từng dòng (email, username, họ tên, mã role, mã đơn vị, trùng lặp).
              </p>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '5px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  onClick={() => void handleDownloadImportTemplate('xlsx')}
                >
                  <Download size={12} /> Tải file mẫu Excel (.xlsx)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '5px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  onClick={() => void handleDownloadImportTemplate('csv')}
                >
                  <Download size={12} /> Tải file mẫu CSV (.csv)
                </button>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={handleImportFileChange}
                  style={{ ...inputStyle, padding: '6px' }}
                />
                {bulkFileName && (
                  <div style={{ fontSize: '12px', color: '#38bdf8', marginTop: '4px' }}>
                    📎 Đang chọn file: <strong>{bulkFileName}</strong>{' '}
                    {bulkXlsxBase64 ? '(Chế độ đọc trực tiếp binary Excel .xlsx)' : '(Chế độ CSV)'}
                  </div>
                )}
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                Hoặc nhập/chỉnh sửa trực tiếp nội dung CSV (<code>email,username,lastName,firstName,fullName,phoneNumber,roleCodes,organizationUnitCodes</code>):
              </p>
              <textarea
                rows={5}
                style={{ ...inputStyle, fontFamily: 'monospace', marginBottom: '12px' }}
                value={bulkCsvText}
                onChange={(e) => {
                  setBulkCsvText(e.target.value);
                  setBulkXlsxBase64('');
                }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleBulkImport()}
                style={{ padding: '9px 16px', width: '100%' }}
              >
                {bulkXlsxBase64 ? `Thực thi Import từ file Excel (${bulkFileName})` : 'Thực thi Import hàng loạt'}
              </button>

              {bulkImportReport && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '10px',
                    borderRadius: '8px',
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid var(--border-color)',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                    📊 Kết quả kiểm tra & Import: Tổng {bulkImportReport.totalRows} dòng — Thành công:{' '}
                    <span style={{ color: '#34d399' }}>{bulkImportReport.importedCount}</span> — Lỗi:{' '}
                    <span style={{ color: '#f87171' }}>{bulkImportReport.failedCount}</span>
                  </div>
                  {bulkImportReport.errors.length > 0 && (
                    <div style={{ maxHeight: '140px', overflowY: 'auto' }}>
                      {bulkImportReport.errors.map((err, idx) => (
                        <div key={idx} style={{ color: '#fca5a5', padding: '2px 0' }}>
                          • Dòng #{err.row} ({err.identifier}): {err.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                    <strong>#{s.id} - {s.deviceName || 'Unknown Device'}</strong> — IP: {s.ipAddress || 'N/A'}
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
                placeholder="Mã đơn vị (VD: DEPT_AI)"
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
                onChange={(e) => setNewOrgType(Number(e.target.value))}
              >
                <option value={1}>1 - HEADQUARTERS (Trụ sở chính)</option>
                <option value={2}>2 - BRANCH (Chi nhánh)</option>
                <option value={3}>3 - DEPARTMENT (Phòng ban)</option>
                <option value={4}>4 - TEAM (Nhóm)</option>
              </select>
              <select
                style={inputStyle}
                value={newOrgParentId}
                onChange={(e) => setNewOrgParentId(e.target.value)}
              >
                <option value="">-- Không có đơn vị cha (Root) --</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.id} - {o.name} ({o.code})
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
                    <strong>#{o.id} - {o.name}</strong> ({o.code}) — <code>{o.type} ({o.typeName ?? ''})</code>
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
                    <strong>#{r.id} - {r.name}</strong> (<code>{r.code}</code>) — {r.permissions.length} quyền
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
