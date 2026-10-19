import React, { useState, useEffect, useCallback } from 'react';
import { fetchApi, fetchApiWithMeta } from '../../core/services/api';
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
  description?: string | null;
  isSystem?: boolean;
  dataScope?: number;
  dataScopeName?: 'ALL' | 'ORG_UNIT' | 'SUBORDINATES' | 'SELF';
  userCount?: number;
  status?: number;
  statusName?: string;
  permissions: string[];
}

interface DataScopeSelfState {
  userId: number;
  effectiveDataScope: number;
  effectiveDataScopeName: 'ALL' | 'ORG_UNIT' | 'SUBORDINATES' | 'SELF';
  allowedOrganizationUnitIds: number[];
  allowedSubordinateUserIds: number[];
  roles: Array<{
    id: number;
    code: string;
    name: string;
    dataScope: number;
    dataScopeName: 'ALL' | 'ORG_UNIT' | 'SUBORDINATES' | 'SELF';
  }>;
}

interface DataScopeRuleItem {
  resource: string;
  module: string;
  description: string;
  registeredAt: string;
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
  managerId?: number | null;
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

interface LoginHistoryItem {
  id: number;
  userId: number | null;
  identifier: string | null;
  sessionId: number | null;
  eventType: number;
  eventTypeName: string;
  status: number;
  statusName: string;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  reason: string | null;
  createdAt: string;
}

interface SecuritySettingsState {
  requireCurrentPasswordOnChange: boolean;
  passwordMinLength: number;
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
  enableLoginAuditLog: boolean;
}

interface AuditLogItem {
  id: number;
  actorType: 1 | 2 | 3;
  actorTypeName: 'USER' | 'SERVICE_ACCOUNT' | 'SYSTEM';
  actorUserId: number | null;
  actorServiceAccountId: number | null;
  actorApiClientId: number | null;
  actorIdentifier: string | null;
  module: string;
  feature: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  correlationId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
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

const IAM_ACCESS_TOKEN_KEY = 'core_iam_access_token';
const IAM_REFRESH_TOKEN_KEY = 'core_iam_refresh_token';

export const IamManagementPage: React.FC = () => {
  const [subTab, setSubTab] = useState<'users' | 'auth' | 'orgs-roles' | 'audit-logs'>('users');
  const [accessToken, setAccessTokenState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(IAM_ACCESS_TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [_refreshToken, setRefreshTokenState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(IAM_REFRESH_TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [statusBanner, setStatusBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const setAccessToken = useCallback((token: string) => {
    setAccessTokenState(token);
    try {
      if (token) window.localStorage.setItem(IAM_ACCESS_TOKEN_KEY, token);
      else window.localStorage.removeItem(IAM_ACCESS_TOKEN_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

  const setRefreshToken = useCallback((token: string) => {
    setRefreshTokenState(token);
    try {
      if (token) window.localStorage.setItem(IAM_REFRESH_TOKEN_KEY, token);
      else window.localStorage.removeItem(IAM_REFRESH_TOKEN_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

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
    remainingRecoveryCodesCount?: number;
    remainingRecoveryCodes?: number;
  } | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryItem[]>([]);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettingsState>({
    requireCurrentPasswordOnChange: false,
    passwordMinLength: 10,
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 15,
    sessionIdleTimeoutMinutes: 30,
    sessionMaxLifetimeMinutes: 10080,
    enableLoginAuditLog: true,
  });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Users, Roles, Organizations & Pagination state
  const [users, setUsers] = useState<UserItem[]>([]);
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(50);
  const [totalUsers, setTotalUsers] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
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
  const [newUserManagerId, setNewUserManagerId] = useState<string>('');
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

  // User Status History & Status Change modal state (Mục 3.1.10 & 3.4.7)
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
  const [userLoginHistoryList, setUserLoginHistoryList] = useState<LoginHistoryItem[]>([]);
  const [statusChangeTarget, setStatusChangeTarget] = useState<number>(1);
  const [statusChangeReason, setStatusChangeReason] = useState<string>('');

  // Create Role, Data Scope (4.3) & Organization form state
  const [newRoleCode, setNewRoleCode] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDataScope, setNewRoleDataScope] = useState<number>(4);
  const [newRolePerms, setNewRolePerms] = useState('users.read,users.update');
  const [dataScopeSelf, setDataScopeSelf] = useState<DataScopeSelfState | null>(null);
  const [dataScopeRules, setDataScopeRules] = useState<DataScopeRuleItem[]>([]);
  const [newScopeRuleResource, setNewScopeRuleResource] = useState('');
  const [newScopeRuleModule, setNewScopeRuleModule] = useState('');
  const [newScopeRuleDesc, setNewScopeRuleDesc] = useState('');
  const [newOrgCode, setNewOrgCode] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState<number>(3);
  const [newOrgParentId, setNewOrgParentId] = useState<string>('');

  // Section 4.4 — Audit Log state
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState<number>(0);
  const [auditPage, setAuditPage] = useState<number>(1);
  const [auditTotalPages, setAuditTotalPages] = useState<number>(1);
  const [auditModuleFilter, setAuditModuleFilter] = useState<string>('');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('');
  const [auditActorTypeFilter, setAuditActorTypeFilter] = useState<string>('');
  const [auditActorUserIdFilter, setAuditActorUserIdFilter] = useState<string>('');
  const [auditFromDate, setAuditFromDate] = useState<string>('');
  const [auditToDate, setAuditToDate] = useState<string>('');
  const [auditCorrelationFilter, setAuditCorrelationFilter] = useState<string>('');
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogItem | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  }, [accessToken]);

  const notify = (type: 'ok' | 'err', text: string) => {
    setStatusBanner({ type, text });
  };

  const loadAuditLogs = useCallback(async () => {
    if (!accessToken) return;
    try {
      const qs = new URLSearchParams();
      if (auditModuleFilter.trim()) qs.set('module', auditModuleFilter.trim());
      if (auditActionFilter.trim()) qs.set('action', auditActionFilter.trim());
      if (auditActorTypeFilter) qs.set('actorType', auditActorTypeFilter);
      if (auditActorUserIdFilter.trim()) qs.set('actorUserId', auditActorUserIdFilter.trim());
      if (auditFromDate) qs.set('fromDate', auditFromDate);
      if (auditToDate) qs.set('toDate', auditToDate);
      if (auditCorrelationFilter.trim()) qs.set('correlationId', auditCorrelationFilter.trim());
      if (auditSearchQuery.trim()) qs.set('q', auditSearchQuery.trim());
      qs.set('page', String(auditPage));
      qs.set('limit', '20');

      const res = await fetchApiWithMeta<AuditLogItem[] | { items: AuditLogItem[] }>(
        API_ROUTES.ROLES.AUDIT_LOGS(qs.toString()),
        { headers: authHeaders() },
      );
      const rawData = res.data;
      const items = Array.isArray(rawData)
        ? rawData
        : Array.isArray(rawData?.items)
          ? rawData.items
          : [];
      setAuditLogs(items);
      setAuditTotal(res.meta?.total ?? items.length);
      setAuditTotalPages(Math.max(1, res.meta?.totalPages ?? 1));
    } catch {
      // Ignore if current user lacks roles.read
    }
  }, [
    accessToken,
    auditActionFilter,
    auditActorTypeFilter,
    auditActorUserIdFilter,
    auditCorrelationFilter,
    auditFromDate,
    auditModuleFilter,
    auditPage,
    auditSearchQuery,
    auditToDate,
    authHeaders,
  ]);

  const handleTestAuditLogImmutability = async (id: number, method: 'PUT' | 'DELETE') => {
    try {
      await fetchApi(API_ROUTES.ROLES.AUDIT_LOG_DETAIL(id), {
        method,
        headers: authHeaders(),
        body: method === 'PUT' ? JSON.stringify({ reason: 'Tampered audit log' }) : undefined,
      });
      notify('err', 'Cảnh báo: API không chặn thao tác sửa/xóa Audit Log!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '403 Forbidden';
      notify(
        'ok',
        `✅ Kiểm chứng Toàn vẹn (Mục 4.4.8): Backend đã chặn thao tác ${method} Audit Log #${id} — "${msg}"`,
      );
    }
  };

  const loadDirectoryData = useCallback(async () => {
    if (!accessToken) return;
    try {
      const qs = new URLSearchParams();
      if (searchQuery.trim()) qs.set('q', searchQuery.trim());
      if (statusFilter) qs.set('status', statusFilter);
      if (roleFilter) qs.set('roleId', roleFilter);
      if (orgFilter) qs.set('organizationUnitId', orgFilter);
      qs.set('page', String(page));
      qs.set('limit', String(limit));

      const [usersResult, rolesData, orgsData, myScopeData, scopeRulesData] = await Promise.all([
        fetchApiWithMeta<UserItem[] | { items: UserItem[] }>(API_ROUTES.USERS.LIST(qs.toString()), {
          headers: authHeaders(),
        }),
        fetchApi<RoleOption[]>(API_ROUTES.ROLES.LIST, { headers: authHeaders() }),
        fetchApi<OrgUnitOption[]>(API_ROUTES.ORGANIZATIONS.LIST, { headers: authHeaders() }),
        fetchApi<DataScopeSelfState>(API_ROUTES.ROLES.DATA_SCOPES_ME, {
          headers: authHeaders(),
        }).catch(() => null),
        fetchApi<DataScopeRuleItem[]>(API_ROUTES.ROLES.DATA_SCOPES_RULES, {
          headers: authHeaders(),
        }).catch(() => []),
      ]);
      const usersData = usersResult.data;
      const normalizedUsers = Array.isArray(usersData)
        ? usersData
        : Array.isArray(usersData?.items)
          ? usersData.items
          : [];
      setUsers(normalizedUsers);
      setTotalUsers(usersResult.meta?.total ?? normalizedUsers.length);
      setTotalPages(Math.max(1, usersResult.meta?.totalPages ?? 1));
      setRoles(Array.isArray(rolesData) ? rolesData : []);
      setOrgs(Array.isArray(orgsData) ? orgsData : []);
      if (myScopeData) setDataScopeSelf(myScopeData);
      setDataScopeRules(Array.isArray(scopeRulesData) ? scopeRulesData : []);
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
        setAccessToken('');
        setRefreshToken('');
        return;
      }
      notify('err', err instanceof Error ? err.message : 'Failed to load IAM directory data');
    }
  }, [accessToken, authHeaders, limit, orgFilter, page, roleFilter, searchQuery, setAccessToken, setRefreshToken, statusFilter]);

  const [currentUserPermissions, setCurrentUserPermissions] = useState<string[] | null>(null);
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([]);

  const hasPermission = useCallback(
    (perm: string): boolean => {
      if (!currentUserPermissions) return true;
      if (currentUserRoles.includes('super_admin')) return true;
      return currentUserPermissions.includes(perm);
    },
    [currentUserPermissions, currentUserRoles],
  );

  const loadAuthProfileData = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [mfa, sess, hist, secSettings, meProfile] = await Promise.all([
        fetchApi<{
          mfaEnabled: boolean;
          totpEnabled: boolean;
          emailOtpEnabled: boolean;
          remainingRecoveryCodesCount?: number;
          remainingRecoveryCodes?: number;
        }>(API_ROUTES.AUTH.MFA_STATUS, { headers: authHeaders() }),
        fetchApi<SessionItem[]>(API_ROUTES.AUTH.SESSIONS, { headers: authHeaders() }),
        fetchApi<LoginHistoryItem[]>(API_ROUTES.AUTH.LOGIN_HISTORY(50), { headers: authHeaders() }).catch(() => []),
        fetchApi<SecuritySettingsState>(API_ROUTES.AUTH.SECURITY_SETTINGS, { headers: authHeaders() }).catch(() => null),
        fetchApi<{ permissions?: string[]; roles?: Array<{ code: string }> }>(API_ROUTES.AUTH.ME, {
          headers: authHeaders(),
        }).catch(() => null),
      ]);
      setMfaStatus(mfa);
      setSessions(Array.isArray(sess) ? sess : []);
      setLoginHistory(Array.isArray(hist) ? hist : []);
      if (secSettings) {
        setSecuritySettings(secSettings);
      }
      if (meProfile) {
        setCurrentUserPermissions(Array.isArray(meProfile.permissions) ? meProfile.permissions : []);
        setCurrentUserRoles(
          Array.isArray(meProfile.roles) ? meProfile.roles.map((r) => r.code) : [],
        );
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
        setAccessToken('');
        setRefreshToken('');
        return;
      }
      notify('err', err instanceof Error ? err.message : 'Failed to load session/MFA status');
    }
  }, [accessToken, authHeaders, setAccessToken, setRefreshToken]);

  useEffect(() => {
    if (accessToken) {
      void loadDirectoryData();
      void loadAuthProfileData();
      void loadAuditLogs();
    }
  }, [accessToken, loadDirectoryData, loadAuthProfileData, loadAuditLogs]);

  // --- Auth Handlers ---
  const performLoginRequest = useCallback(
    async (loginId: string, loginPass: string, silent = false) => {
      try {
        const res = await fetchApi<{
          mfaRequired: boolean;
          mfaChallengeToken?: string;
          availableMfaMethods?: string[];
          devOtpCode?: string;
          accessToken?: string;
          refreshToken?: string;
          tokens?: { accessToken: string; refreshToken: string };
        }>(API_ROUTES.AUTH.LOGIN, {
          method: 'POST',
          body: JSON.stringify({ identifier: loginId, password: loginPass, deviceName: 'Core Web UI' }),
        });

        const resolvedAccess = res.accessToken ?? res.tokens?.accessToken;
        const resolvedRefresh = res.refreshToken ?? res.tokens?.refreshToken ?? '';

        if (res.mfaRequired && res.mfaChallengeToken) {
          setMfaChallengeToken(res.mfaChallengeToken);
          const methods = res.availableMfaMethods ?? ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'];
          setAvailableMfaMethods(methods);
          if (methods.includes('TOTP')) setSelectedMfaMethod('TOTP');
          else if (methods.includes('EMAIL_OTP')) setSelectedMfaMethod('EMAIL_OTP');
          if (res.devOtpCode) {
            setMfaCode(res.devOtpCode);
          }
          notify(
            'ok',
            `Yêu cầu xác thực 2 lớp (MFA).${res.devOtpCode ? ` Đã tự điền mã OTP Dev: ${res.devOtpCode} — hãy bấm "Xác nhận MFA".` : ' Vui lòng nhập mã TOTP hoặc nhấn "Gửi OTP tới Email".'}`,
          );
        } else if (resolvedAccess) {
          setAccessToken(resolvedAccess);
          setRefreshToken(resolvedRefresh);
          setMfaChallengeToken(null);
          if (!silent) {
            notify('ok', `Đăng nhập thành công (${loginId})!`);
          }
        }
      } catch (err) {
        if (!silent) {
          notify('err', err instanceof Error ? err.message : 'Login failed');
        }
      }
    },
    [setAccessToken, setRefreshToken],
  );

  // Tự động đăng nhập tài khoản quản trị mặc định khi mở trang lần đầu nếu chưa có token
  useEffect(() => {
    if (!accessToken && !mfaChallengeToken) {
      void performLoginRequest('superadmin@gmail.com', '!P@ssw0rd#', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLoginRequest(identifier, password, false);
  };

  const handleSendEmailOtp = async () => {
    try {
      const res = await fetchApi<{ sent: boolean; maskedEmail: string; devOtpCode?: string }>(
        API_ROUTES.AUTH.MFA_EMAIL_OTP_SEND,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(mfaChallengeToken ? { mfaChallengeToken } : {}),
        },
      );
      if (mfaChallengeToken) {
        setSelectedMfaMethod('EMAIL_OTP');
        if (res.devOtpCode) {
          setMfaCode(res.devOtpCode);
        }
      }
      notify(
        'ok',
        `Đã gửi mã OTP 6 chữ số tới ${res.maskedEmail}${res.devOtpCode ? ` (Mã OTP Dev: ${res.devOtpCode})` : ''}`,
      );
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
      const res = await fetchApi<{ secret: string; otpauthUri?: string; otpauthUrl?: string }>(
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
      if (res.recoveryCodes?.length) {
        setRecoveryCodes(res.recoveryCodes);
      }
      setTotpSecret(null);
      setTotpSetupCode('');
      await loadAuthProfileData();
      notify('ok', 'Đã bật TOTP thành công! Hãy lưu lại bộ mã khôi phục.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to verify TOTP setup');
    }
  };

  const handleDisableTotp = async () => {
    try {
      await fetchApi(API_ROUTES.AUTH.MFA_DISABLE, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ method: 'TOTP' }),
      });
      setTotpSecret(null);
      await loadAuthProfileData();
      notify('ok', 'Đã tắt xác thực TOTP.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to disable TOTP');
    }
  };

  const handleToggleEmailOtp = async (enabled: boolean) => {
    try {
      if (enabled) {
        const res = await fetchApi<{ recoveryCodes?: string[] }>(
          API_ROUTES.AUTH.MFA_EMAIL_OTP_ENABLE,
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ enabled: true }),
          },
        );
        if (res.recoveryCodes && res.recoveryCodes.length > 0) {
          setRecoveryCodes(res.recoveryCodes);
        }
      } else {
        await fetchApi(API_ROUTES.AUTH.MFA_DISABLE, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ method: 'EMAIL_OTP' }),
        });
      }
      await loadAuthProfileData();
      notify('ok', enabled ? 'Đã bật xác thực Email OTP!' : 'Đã tắt xác thực Email OTP.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to toggle Email OTP');
    }
  };

  const handleRegenerateRecoveryCodes = async () => {
    try {
      const res = await fetchApi<{ recoveryCodes: string[] }>(
        API_ROUTES.AUTH.MFA_RECOVERY_CODES,
        {
          method: 'POST',
          headers: authHeaders(),
        },
      );
      setRecoveryCodes(res.recoveryCodes ?? []);
      await loadAuthProfileData();
      notify('ok', 'Đã cấp mới 8 mã khôi phục dự phòng (Recovery Codes)!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to regenerate recovery codes');
    }
  };

  const [forgotIdentifier, setForgotIdentifier] = useState('superadmin@gmail.com');
  const [resetTokenOrOtp, setResetTokenOrOtp] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');

  const handleSuggestPassword = async (target: 'change' | 'createUser' | 'reset') => {
    try {
      const res = await fetchApi<{ password: string; suggestions: string[] }>(
        API_ROUTES.AUTH.PASSWORD_SUGGEST(3, 16),
      );
      if (target === 'change') {
        setNewPassword(res.password);
      } else if (target === 'reset') {
        setResetNewPassword(res.password);
      } else {
        setNewUserPassword(res.password);
      }
      notify(
        'ok',
        `Đã điền mật khẩu gợi ý mạnh: ${res.password} (Các gợi ý khác: ${res.suggestions.join(' | ')})`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to suggest password');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchApi<{
        accepted: boolean;
        expiresInSeconds: number;
        maskedTarget?: string;
        devResetToken?: string;
        devResetOtp?: string;
      }>(API_ROUTES.AUTH.PASSWORD_FORGOT, {
        method: 'POST',
        body: JSON.stringify({ identifier: forgotIdentifier }),
      });
      if (res.devResetOtp) {
        setResetTokenOrOtp(res.devResetOtp);
      } else if (res.devResetToken) {
        setResetTokenOrOtp(res.devResetToken);
      }
      notify(
        'ok',
        `Đã gửi yêu cầu khôi phục mật khẩu${res.maskedTarget ? ` tới ${res.maskedTarget}` : ''}.${res.devResetOtp ? ` Mã OTP Dev: ${res.devResetOtp} | Link Token: ${res.devResetToken ?? ''}` : ''}`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Forgot password request failed');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isOtp6 = /^\d{6}$/.test(resetTokenOrOtp.trim());
      const res = await fetchApi<{ reset: boolean; revokedSessionsCount: number }>(
        API_ROUTES.AUTH.PASSWORD_RESET,
        {
          method: 'POST',
          body: JSON.stringify({
            identifier: forgotIdentifier.trim() || undefined,
            ...(isOtp6 ? { otpCode: resetTokenOrOtp.trim() } : { token: resetTokenOrOtp.trim() }),
            newPassword: resetNewPassword,
          }),
        },
      );
      setResetTokenOrOtp('');
      setResetNewPassword('');
      notify(
        'ok',
        `Đặt lại mật khẩu thành công! Đã thu hồi ${res.revokedSessionsCount} phiên đăng nhập cũ.`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Reset password failed');
    }
  };

  const handleAdminResetUserPassword = async (u: UserItem) => {
    try {
      const res = await fetchApi<{
        reset: boolean;
        userId: number;
        generatedPassword?: string;
        revokedSessionsCount: number;
      }>(API_ROUTES.USERS.RESET_PASSWORD(u.id), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          useSuggestedPassword: true,
          revokeSessions: true,
        }),
      });
      notify(
        'ok',
        `Đã Reset mật khẩu cho #${u.id} (${u.email}). Mật khẩu mới tự sinh: ${res.generatedPassword ?? '(đã đặt)'} | Đã thu hồi ${res.revokedSessionsCount} phiên.`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Admin reset password failed');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi(API_ROUTES.AUTH.PASSWORD_CHANGE, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          currentPassword: currentPassword || undefined,
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
      notify('ok', `Đã thu hồi phiên đăng nhập #${sessionId}.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Revoke session failed');
    }
  };

  const handleRevokeAllSessions = async (includeCurrent: boolean) => {
    try {
      const res = await fetchApi<{ revokedCount: number }>(API_ROUTES.AUTH.REVOKE_ALL_SESSIONS, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          includeCurrent,
          reason: includeCurrent
            ? 'Emergency revoke all sessions from UI'
            : 'Revoke all other sessions from UI',
        }),
      });
      await loadAuthProfileData();
      notify(
        'ok',
        includeCurrent
          ? `🚨 Đã thu hồi toàn bộ ${res.revokedCount} phiên đăng nhập khẩn cấp (kể cả thiết bị hiện tại)!`
          : `Đã thu hồi ${res.revokedCount} phiên đăng nhập trên các thiết bị khác.`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Revoke all sessions failed');
    }
  };

  const handleAdminRevokeUserSessions = async (u: UserItem) => {
    try {
      const res = await fetchApi<{
        userId: number;
        revokedCount?: number;
        revokedSessionsCount?: number;
        reason?: string;
      }>(API_ROUTES.USERS.REVOKE_SESSIONS(u.id), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          reason: 'Emergency session revocation by Administrator',
        }),
      });
      const revokedTotal = res.revokedSessionsCount ?? res.revokedCount ?? 0;
      await loadAuthProfileData();
      notify(
        'ok',
        `🚫 Đã thu hồi khẩn cấp ${revokedTotal} phiên đăng nhập của người dùng #${u.id} (${u.email}).`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Admin revoke user sessions failed');
    }
  };

  const handleSaveSessionSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = await fetchApi<SecuritySettingsState>(API_ROUTES.AUTH.SECURITY_SETTINGS, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          sessionIdleTimeoutMinutes: Number(securitySettings.sessionIdleTimeoutMinutes),
          sessionMaxLifetimeMinutes: Number(securitySettings.sessionMaxLifetimeMinutes),
          enableLoginAuditLog: Boolean(securitySettings.enableLoginAuditLog),
        }),
      });
      setSecuritySettings(updated);
      notify(
        'ok',
        `Đã lưu cấu hình phiên & kiểm toán: Idle Timeout = ${updated.sessionIdleTimeoutMinutes} phút | Max Lifetime = ${updated.sessionMaxLifetimeMinutes} phút | Audit Login Log = ${updated.enableLoginAuditLog ? 'BẬT' : 'TẮT'}.`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to update security settings');
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
          managerId: newUserManagerId.trim() ? Number(newUserManagerId) : null,
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
      setNewUserManagerId('');
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
      const [history, loginHist] = await Promise.all([
        fetchApi<
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
        >(API_ROUTES.USERS.STATUS_HISTORY(user.id), { headers: authHeaders() }),
        fetchApi<LoginHistoryItem[]>(API_ROUTES.USERS.LOGIN_HISTORY(user.id), { headers: authHeaders() }).catch(() => []),
      ]);
      setStatusHistoryList(Array.isArray(history) ? history : []);
      setUserLoginHistoryList(Array.isArray(loginHist) ? loginHist : []);
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

  // --- Edit Profile, Roles & Organization Units for Existing User (3.1.2, 3.1.5, 3.1.6) ---
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editManagerId, setEditManagerId] = useState<string>('');
  const [editRoleIds, setEditRoleIds] = useState<number[]>([]);
  const [editOrgIds, setEditOrgIds] = useState<number[]>([]);
  const [editPrimaryOrgId, setEditPrimaryOrgId] = useState<number | null>(null);

  const handleOpenEditUser = (u: UserItem) => {
    setEditingUser(u);
    setEditFirstName(u.firstName ?? '');
    setEditLastName(u.lastName ?? '');
    setEditFullName(u.fullName ?? '');
    setEditEmail(u.email ?? '');
    setEditPhone(u.phone ?? u.phoneNumber ?? '');
    setEditManagerId(u.managerId ? String(u.managerId) : '');
    const currentRoleIds = u.roles
      .map((r) => Number((r as { roleId?: number; id?: number }).roleId ?? r.id))
      .filter((n) => Number.isFinite(n) && n > 0);
    setEditRoleIds(currentRoleIds);
    const orgList = u.organizationUnits ?? u.organizations ?? [];
    const currentOrgIds = orgList.map((o) => Number(o.organizationUnitId));
    setEditOrgIds(currentOrgIds);
    const primary = orgList.find((o) => o.isPrimary)?.organizationUnitId ?? u.primaryOrganizationUnitId ?? currentOrgIds[0] ?? null;
    setEditPrimaryOrgId(primary ? Number(primary) : null);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await fetchApi(API_ROUTES.USERS.UPDATE(editingUser.id), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          email: editEmail.trim(),
          firstName: editFirstName.trim() || undefined,
          lastName: editLastName.trim() || undefined,
          fullName:
            editFullName.trim() ||
            `${editLastName.trim()} ${editFirstName.trim()}`.trim() ||
            editingUser.fullName,
          phone: editPhone.trim() || null,
          managerId: editManagerId.trim() ? Number(editManagerId) : null,
        }),
      });

      await fetchApi(API_ROUTES.USERS.ASSIGN_ROLES(editingUser.id), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ roleIds: editRoleIds }),
      });

      await fetchApi(API_ROUTES.USERS.ASSIGN_ORGANIZATIONS(editingUser.id), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          organizationUnits: editOrgIds.map((orgId) => ({
            organizationUnitId: orgId,
            isPrimary: orgId === (editPrimaryOrgId ?? editOrgIds[0]),
          })),
        }),
      });

      setEditingUser(null);
      await loadDirectoryData();
      notify('ok', `Đã cập nhật hồ sơ, người quản lý, vai trò và đơn vị cho người dùng #${editingUser.id}!`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to update user profile/roles/organizations');
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

  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [selectedRoleUsers, setSelectedRoleUsers] = useState<{
    role: RoleOption;
    users: Array<{ id: number; username: string; email: string; fullName: string; statusName: string }>;
  } | null>(null);

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi(API_ROUTES.ROLES.LIST, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          code: newRoleCode,
          name: newRoleName,
          description: newRoleDesc || null,
          dataScope: newRoleDataScope,
          permissions: newRolePerms
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
        }),
      });
      setNewRoleCode('');
      setNewRoleName('');
      setNewRoleDesc('');
      setNewRoleDataScope(4);
      await loadDirectoryData();
      notify('ok', 'Đã tạo vai trò mới kèm cấu hình Phạm vi dữ liệu (Data Scope)!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Create role failed');
    }
  };

  const handleRegisterScopeRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi(API_ROUTES.ROLES.DATA_SCOPES_RULES, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          resource: newScopeRuleResource.trim(),
          module: newScopeRuleModule.trim(),
          description: newScopeRuleDesc.trim(),
        }),
      });
      setNewScopeRuleResource('');
      setNewScopeRuleModule('');
      setNewScopeRuleDesc('');
      await loadDirectoryData();
      notify('ok', `Đã đăng ký rule phạm vi dữ liệu tùy chỉnh cho tài nguyên "${newScopeRuleResource.trim()}"!`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Register custom data scope rule failed');
    }
  };

  const handleCloneRole = async (role: RoleOption) => {
    const newCode = window.prompt(`Nhập mã (code) cho vai trò sao chép từ "${role.code}":`, `${role.code}_copy`);
    if (!newCode) return;
    const newName = window.prompt('Nhập tên hiển thị cho vai trò mới:', `${role.name} (Copy)`);
    if (!newName) return;
    try {
      await fetchApi(API_ROUTES.ROLES.CLONE(role.id), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ code: newCode.trim(), name: newName.trim() }),
      });
      await loadDirectoryData();
      notify('ok', `Đã sao chép vai trò "${role.code}" -> "${newCode.trim()}"!`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Clone role failed');
    }
  };

  const handleQuickEditRole = async (role: RoleOption) => {
    const updatedName = window.prompt(`Cập nhật tên vai trò (Mã cố định: ${role.code}):`, role.name);
    if (!updatedName) return;
    const updatedDesc = window.prompt('Cập nhật mô tả vai trò:', role.description ?? '');
    const updatedScopeStr = window.prompt(
      'Cập nhật Phạm vi dữ liệu (Data Scope: 1=ALL Toàn hệ thống, 2=ORG_UNIT Đơn vị & cấp dưới, 3=SUBORDINATES Cây quản lý, 4=SELF Cá nhân):',
      String(role.dataScope ?? 4),
    );
    if (updatedScopeStr === null) return;
    const updatedPerms = window.prompt(
      'Cập nhật danh sách mã quyền (cách nhau dấu phẩy):',
      role.permissions.join(','),
    );
    if (updatedPerms === null) return;
    try {
      await fetchApi(API_ROUTES.ROLES.UPDATE(role.id), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          name: updatedName.trim(),
          description: updatedDesc,
          dataScope: Number(updatedScopeStr) || 4,
          permissions: updatedPerms
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
        }),
      });
      await loadDirectoryData();
      notify('ok', `Đã cập nhật vai trò #${role.id} (${role.code})!`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Update role failed');
    }
  };

  const handleViewRoleUsers = async (role: RoleOption) => {
    try {
      const list = await fetchApi<
        Array<{ id: number; username: string; email: string; fullName: string; statusName: string }>
      >(API_ROUTES.ROLES.USERS(role.id), { headers: authHeaders() });
      setSelectedRoleUsers({ role, users: Array.isArray(list) ? list : [] });
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Load role users failed');
    }
  };

  const handleDeleteRole = async (role: RoleOption) => {
    try {
      await fetchApi(API_ROUTES.ROLES.DELETE(role.id), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      await loadDirectoryData();
      notify('ok', `Đã xóa vai trò #${role.id} (${role.code})!`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Delete role failed');
    }
  };

  const handleSyncPermissions = async () => {
    try {
      const res = await fetchApi<{
        totalDeclared: number;
        createdCount: number;
        updatedCount: number;
        unchangedCount: number;
        orphanedCount: number;
      }>(API_ROUTES.ROLES.PERMISSIONS_SYNC, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      await loadDirectoryData();
      notify(
        'ok',
        `Đồng bộ quyền thành công: ${res.totalDeclared} quyền công bố | tạo mới ${res.createdCount} | cập nhật ${res.updatedCount} | giữ nguyên ${res.unchangedCount} | mồ côi ${res.orphanedCount}.`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Sync permissions failed');
    }
  };

  const handleCheckOrphanPermissions = async () => {
    try {
      const list = await fetchApi<Array<{ code: string; warningMessage: string }>>(
        API_ROUTES.ROLES.PERMISSIONS_ORPHANS,
        { headers: authHeaders() },
      );
      if (!list || list.length === 0) {
        notify('ok', 'Không có quyền mồ côi nào trong hệ thống.');
      } else {
        notify('err', `Cảnh báo ${list.length} quyền mồ côi: ${list.map((i) => i.code).join(', ')}`);
      }
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Check orphan permissions failed');
    }
  };

  const handleViewPermissionMatrix = async () => {
    try {
      const matrix = await fetchApi<{
        summary: { totalRoles: number; totalPermissions: number; totalOrphanedPermissions: number };
      }>(API_ROUTES.ROLES.PERMISSIONS_MATRIX, { headers: authHeaders() });
      notify(
        'ok',
        `Ma trận Vai trò × Quyền: ${matrix.summary.totalRoles} vai trò × ${matrix.summary.totalPermissions} quyền (mồ côi: ${matrix.summary.totalOrphanedPermissions}).`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Load permission matrix failed');
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
          <button
            type="button"
            className={subTab === 'audit-logs' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => {
              setSubTab('audit-logs');
              void loadAuditLogs();
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px' }}
          >
            <Shield size={15} /> Nhật ký thao tác (Audit Log 4.4)
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

              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0 }}>
                    🕒 Lịch sử Đăng nhập, Đăng xuất & Thu hồi phiên của người dùng #{statusHistoryUser.id} ({userLoginHistoryList.length})
                  </h4>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '12px', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                    onClick={() => void handleAdminRevokeUserSessions(statusHistoryUser)}
                  >
                    🚫 Thu hồi toàn bộ phiên của người dùng này
                  </button>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: '220px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>Thời gian</th>
                        <th style={{ padding: '6px 8px' }}>Sự kiện</th>
                        <th style={{ padding: '6px 8px' }}>Kết quả</th>
                        <th style={{ padding: '6px 8px' }}>Thiết bị</th>
                        <th style={{ padding: '6px 8px' }}>Địa chỉ IP</th>
                        <th style={{ padding: '6px 8px' }}>Chi tiết / Lý do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userLoginHistoryList.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: '10px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            Chưa có bản ghi lịch sử đăng nhập/đăng xuất.
                          </td>
                        </tr>
                      ) : (
                        userLoginHistoryList.map((item) => (
                          <tr key={item.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                            <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                              {new Date(item.createdAt).toLocaleString('vi-VN')}
                            </td>
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                              <code>{item.eventTypeName}</code>
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <span
                                style={{
                                  color: item.statusName === 'SUCCESS' ? '#34d399' : '#f87171',
                                  fontWeight: 700,
                                }}
                              >
                                {item.statusName}
                              </span>
                            </td>
                            <td style={{ padding: '6px 8px' }}>{item.deviceName || '—'}</td>
                            <td style={{ padding: '6px 8px' }}>{item.ipAddress || '—'}</td>
                            <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>
                              {item.reason || (item.sessionId ? `Session #${item.sessionId}` : '—')}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Edit User Profile, Roles & Organization Units Panel (3.1.2, 3.1.5, 3.1.6) */}
          {editingUser && (
            <form
              onSubmit={(e) => void handleSaveEditUser(e)}
              style={{ ...cardStyle, border: '1px solid rgba(16, 185, 129, 0.4)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                  ✏️ Cập nhật Hồ sơ, Vai trò & Đơn vị — #{editingUser.id} {editingUser.fullName}
                </h3>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => setEditingUser(null)}
                >
                  Đóng
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <input
                  style={inputStyle}
                  placeholder="Họ và tên đệm (Last Name)"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                />
                <input
                  style={inputStyle}
                  placeholder="Tên (First Name)"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                />
                <input
                  style={inputStyle}
                  placeholder="Họ và tên đầy đủ"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                />
                <input
                  style={inputStyle}
                  placeholder="Email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
                <input
                  style={inputStyle}
                  placeholder="Số điện thoại"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
                <input
                  type="number"
                  min={1}
                  style={inputStyle}
                  placeholder="ID Quản lý trực tiếp (Manager ID - 4.3)"
                  value={editManagerId}
                  onChange={(e) => setEditManagerId(e.target.value)}
                />
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                Gán vai trò (Roles — Mục 3.1.5):
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {roles.map((r) => {
                  const checked = editRoleIds.includes(r.id);
                  return (
                    <label key={r.id} style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setEditRoleIds([...editRoleIds, r.id]);
                          else setEditRoleIds(editRoleIds.filter((id) => id !== r.id));
                        }}
                      />
                      #{r.id} {r.name} ({r.code})
                    </label>
                  );
                })}
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                Gán đơn vị / chi nhánh (Multi-Organization Units — Mục 3.1.6):
              </div>
              <div style={{ display: 'grid', gap: '6px', marginBottom: '14px' }}>
                {orgs.map((o) => {
                  const checked = editOrgIds.includes(o.id);
                  return (
                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const next = [...editOrgIds, o.id];
                              setEditOrgIds(next);
                              if (!editPrimaryOrgId) setEditPrimaryOrgId(o.id);
                            } else {
                              setEditOrgIds(editOrgIds.filter((id) => id !== o.id));
                            }
                          }}
                        />
                        #{o.id} {o.name} ({o.code})
                      </label>
                      {checked && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#38bdf8' }}>
                          <input
                            type="radio"
                            name="editPrimaryOrg"
                            checked={(editPrimaryOrgId ?? editOrgIds[0]) === o.id}
                            onChange={() => setEditPrimaryOrgId(o.id)}
                          />
                          Đơn vị chính
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              <button type="submit" className="btn-primary" style={{ padding: '8px 18px', fontSize: '13px' }}>
                Lưu cập nhật Hồ sơ, Vai trò & Đơn vị
              </button>
            </form>
          )}

          {/* Users Table */}
          <div style={{ ...cardStyle, overflowX: 'auto' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '14px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                  Danh sách người dùng (Hiển thị {users.length} / Tổng {totalUsers} người dùng trong phạm vi)
                </h3>
                {dataScopeSelf && (
                  <div style={{ fontSize: '12px', color: '#38bdf8', marginTop: '4px' }}>
                    🛡️ Phạm vi dữ liệu (Data Scope — Mục 4.3) đang áp dụng:{' '}
                    <strong>
                      {dataScopeSelf.effectiveDataScope} - {dataScopeSelf.effectiveDataScopeName}
                    </strong>
                    {dataScopeSelf.effectiveDataScopeName === 'ORG_UNIT' &&
                      ` (Đơn vị & cấp dưới: ${dataScopeSelf.allowedOrganizationUnitIds.join(', ') || '—'})`}
                    {dataScopeSelf.effectiveDataScopeName === 'SUBORDINATES' &&
                      ` (Cấp dưới trực thuộc: ${dataScopeSelf.allowedSubordinateUserIds.length} user)`}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Số dòng/trang:</span>
                <select
                  style={{ ...inputStyle, width: '90px', padding: '5px 8px' }}
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{ padding: '5px 10px', fontSize: '12px', opacity: page <= 1 ? 0.5 : 1 }}
                >
                  ← Trang trước
                </button>
                <span>
                  Trang <strong>{page}</strong> / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  style={{ padding: '5px 10px', fontSize: '12px', opacity: page >= totalPages ? 0.5 : 1 }}
                >
                  Trang sau →
                </button>
              </div>
            </div>
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
                            {u.managerId ? (
                              <span style={{ marginLeft: '6px', color: '#a78bfa' }}>
                                • Quản lý: #{u.managerId}
                              </span>
                            ) : null}
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
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '12px', color: '#34d399' }}
                            onClick={() => handleOpenEditUser(u)}
                          >
                            ✏️ Sửa hồ sơ
                          </button>
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
                            style={{ padding: '4px 8px', fontSize: '12px', color: '#fbbf24' }}
                            onClick={() => void handleAdminResetUserPassword(u)}
                          >
                            🔑 Reset MK
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '12px', color: '#f87171' }}
                            onClick={() => void handleAdminRevokeUserSessions(u)}
                          >
                            🚫 Thu hồi phiên
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '12px', color: '#38bdf8' }}
                            onClick={() => void handleOpenStatusHistory(u)}
                          >
                            📜 Lịch sử TT & ĐN
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <input
                    style={inputStyle}
                    placeholder="Họ và tên đầy đủ (Full Name)"
                    value={newUserFullName}
                    onChange={(e) => setNewUserFullName(e.target.value)}
                  />
                  <input
                    type="number"
                    min={1}
                    style={inputStyle}
                    placeholder="ID Quản lý trực tiếp (VD: 10)"
                    value={newUserManagerId}
                    onChange={(e) => setNewUserManagerId(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="Mật khẩu khởi tạo (*)"
                    required
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ whiteSpace: 'nowrap', padding: '8px 10px', fontSize: '12px' }}
                    onClick={() => void handleSuggestPassword('createUser')}
                  >
                    ✨ Gợi ý MK
                  </button>
                </div>

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
              <div>
                • Số mã khôi phục còn lại:{' '}
                <strong>{mfaStatus?.remainingRecoveryCodesCount ?? mfaStatus?.remainingRecoveryCodes ?? 0}</strong>
              </div>
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
              {mfaStatus?.totpEnabled && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleDisableTotp()}
                  style={{ padding: '7px 12px', fontSize: '13px' }}
                >
                  Tắt TOTP
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleToggleEmailOtp(!mfaStatus?.emailOtpEnabled)}
                style={{ padding: '7px 12px', fontSize: '13px' }}
              >
                {mfaStatus?.emailOtpEnabled ? 'Tắt Email OTP' : 'Bật Email OTP'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleSendEmailOtp()}
                style={{ padding: '7px 12px', fontSize: '13px' }}
              >
                Gửi mã OTP Email
              </button>
              {mfaStatus?.mfaEnabled && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleRegenerateRecoveryCodes()}
                  style={{ padding: '7px 12px', fontSize: '13px' }}
                >
                  Cấp lại mã khôi phục
                </button>
              )}
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

          {/* Password Management (Change & Forgot/Reset) */}
          <div style={cardStyle}>
            <form onSubmit={(e) => void handleChangePassword(e)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <KeyRound size={16} /> Đổi mật khẩu & Khôi phục tài khoản (Mục 3.3)
                </h3>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => void handleSuggestPassword('change')}
                >
                  ✨ Gợi ý mật khẩu mạnh
                </button>
              </div>
              <div style={{ display: 'grid', gap: '10px' }}>
                <input
                  type="password"
                  style={inputStyle}
                  placeholder="Mật khẩu hiện tại (tùy cấu hình biến setting)"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <input
                  type="text"
                  style={inputStyle}
                  placeholder="Mật khẩu mới (hoặc bấm Gợi ý mật khẩu mạnh)"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <button type="submit" className="btn-primary" style={{ padding: '8px 16px' }}>
                  Đổi mật khẩu & Thu hồi phiên khác
                </button>
              </div>
            </form>

            <div
              style={{
                marginTop: '16px',
                paddingTop: '14px',
                borderTop: '1px solid var(--border-color)',
                display: 'grid',
                gap: '10px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600 }}>
                🔑 Quên mật khẩu — Gửi Link Token hoặc Mã OTP 6 số (Mục 3.3.2)
              </div>
              <form onSubmit={(e) => void handleForgotPassword(e)} style={{ display: 'flex', gap: '8px' }}>
                <input
                  style={inputStyle}
                  placeholder="Email, Username hoặc SĐT cần khôi phục"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn-secondary"
                  style={{ whiteSpace: 'nowrap', padding: '8px 12px', fontSize: '12px' }}
                >
                  Gửi Link / OTP
                </button>
              </form>

              <form onSubmit={(e) => void handleResetPassword(e)} style={{ display: 'grid', gap: '8px' }}>
                <input
                  style={inputStyle}
                  placeholder="Nhập mã OTP 6 số hoặc Link Token khôi phục"
                  required
                  value={resetTokenOrOtp}
                  onChange={(e) => setResetTokenOrOtp(e.target.value)}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="Mật khẩu mới đặt lại"
                    required
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ whiteSpace: 'nowrap', padding: '8px 10px', fontSize: '12px' }}
                    onClick={() => void handleSuggestPassword('reset')}
                  >
                    ✨ Gợi ý
                  </button>
                </div>
                <button type="submit" className="btn-secondary" style={{ padding: '8px 14px', fontSize: '13px' }}>
                  Xác nhận Đặt lại mật khẩu & Thu hồi phiên cũ
                </button>
              </form>
            </div>
          </div>

          {/* Active Sessions & Timeout Settings (Mục 3.4) */}
          <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '14px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                  🖥️ Quản lý phiên đăng nhập & Thiết bị (Active Sessions: {sessions.length} — Mục 3.4)
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Cấu hình hiện tại: Idle Timeout = <strong>{securitySettings.sessionIdleTimeoutMinutes} phút</strong> | Thời hạn tối đa (Max Lifetime) ={' '}
                  <strong>{securitySettings.sessionMaxLifetimeMinutes} phút</strong> | Ghi lịch sử đăng nhập/đăng xuất ={' '}
                  <strong style={{ color: securitySettings.enableLoginAuditLog ? '#34d399' : '#fbbf24' }}>
                    {securitySettings.enableLoginAuditLog ? 'ĐANG BẬT' : 'ĐANG TẮT'}
                  </strong>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '7px 12px', fontSize: '12px' }}
                  onClick={() => void handleRevokeAllSessions(false)}
                >
                  Thu hồi các thiết bị khác
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    padding: '7px 12px',
                    fontSize: '12px',
                    color: '#f87171',
                    borderColor: 'rgba(239, 68, 68, 0.45)',
                    background: 'rgba(239, 68, 68, 0.12)',
                  }}
                  onClick={() => void handleRevokeAllSessions(true)}
                >
                  🚨 Thu hồi toàn bộ phiên (Khẩn cấp)
                </button>
              </div>
            </div>

            {/* Session Timeout & Audit Log Settings Form */}
            <form
              onSubmit={(e) => void handleSaveSessionSecuritySettings(e)}
              style={{
                display: 'flex',
                gap: '12px',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.55)',
                border: '1px solid var(--border-color)',
                marginBottom: '14px',
              }}
            >
              <div style={{ minWidth: '170px' }}>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Idle Timeout (phút không hoạt động):
                </label>
                <input
                  type="number"
                  min={1}
                  max={43200}
                  style={inputStyle}
                  value={securitySettings.sessionIdleTimeoutMinutes}
                  onChange={(e) =>
                    setSecuritySettings((prev) => ({
                      ...prev,
                      sessionIdleTimeoutMinutes: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div style={{ minWidth: '190px' }}>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Thời hạn phiên tối đa (Max Lifetime phút):
                </label>
                <input
                  type="number"
                  min={5}
                  max={525600}
                  style={inputStyle}
                  value={securitySettings.sessionMaxLifetimeMinutes}
                  onChange={(e) =>
                    setSecuritySettings((prev) => ({
                      ...prev,
                      sessionMaxLifetimeMinutes: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  paddingBottom: '8px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={securitySettings.enableLoginAuditLog}
                  onChange={(e) =>
                    setSecuritySettings((prev) => ({
                      ...prev,
                      enableLoginAuditLog: e.target.checked,
                    }))
                  }
                />
                Ghi lịch sử đăng nhập & đăng xuất (Audit Login Log)
              </label>
              <button type="submit" className="btn-primary" style={{ padding: '8px 14px', fontSize: '12px' }}>
                Lưu cấu hình Phiên & Audit
              </button>
            </form>

            <div style={{ display: 'grid', gap: '8px' }}>
              {sessions.length === 0 ? (
                <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  Không có phiên đăng nhập nào đang hoạt động.
                </div>
              ) : (
                sessions.map((s) => (
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
                        Hoạt động cuối: {new Date(s.lastActiveAt).toLocaleString('vi-VN')} | Hết hạn tối đa:{' '}
                        {new Date(s.expiresAt).toLocaleString('vi-VN')}
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
                ))
              )}
            </div>
          </div>

          {/* Login & Logout Audit History (Mục 3.4.7) */}
          <div style={{ ...cardStyle, gridColumn: '1 / -1', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                📜 Lịch sử Đăng nhập & Đăng xuất theo Thời gian, IP và Thiết bị ({loginHistory.length} bản ghi — Mục 3.4.7)
              </h3>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '5px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => void loadAuthProfileData()}
              >
                <RefreshCw size={13} /> Làm mới lịch sử
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>ID</th>
                  <th style={{ padding: '8px' }}>Thời gian</th>
                  <th style={{ padding: '8px' }}>Sự kiện (Event)</th>
                  <th style={{ padding: '8px' }}>Trạng thái</th>
                  <th style={{ padding: '8px' }}>Thiết bị (Device / User-Agent)</th>
                  <th style={{ padding: '8px' }}>Địa chỉ IP</th>
                  <th style={{ padding: '8px' }}>Phiên / Lý do chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {loginHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Chưa có bản ghi lịch sử đăng nhập / đăng xuất.
                    </td>
                  </tr>
                ) : (
                  loginHistory.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                      <td style={{ padding: '8px' }}>#{item.id}</td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        {new Date(item.createdAt).toLocaleString('vi-VN')}
                      </td>
                      <td style={{ padding: '8px', fontWeight: 600 }}>
                        <code>{item.eventTypeName}</code>
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background:
                              item.statusName === 'SUCCESS'
                                ? 'rgba(16, 185, 129, 0.18)'
                                : 'rgba(239, 68, 68, 0.2)',
                            color: item.statusName === 'SUCCESS' ? '#34d399' : '#f87171',
                          }}
                        >
                          {item.statusName}
                        </span>
                      </td>
                      <td style={{ padding: '8px' }}>{item.deviceName || item.userAgent || '—'}</td>
                      <td style={{ padding: '8px' }}>{item.ipAddress || '—'}</td>
                      <td style={{ padding: '8px', color: 'var(--text-muted)' }}>
                        {item.sessionId ? `[Session #${item.sessionId}] ` : ''}
                        {item.reason || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
              🔑 Quản lý Vai trò, Quyền hạn & Phạm vi dữ liệu (RBAC & Data Scope — Mục 4.1 & 4.3)
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
                placeholder="Mô tả vai trò (tùy chọn)"
                value={newRoleDesc}
                onChange={(e) => setNewRoleDesc(e.target.value)}
              />
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Phạm vi dữ liệu của vai trò (Data Scope — Mục 4.3):
                </label>
                <select
                  style={inputStyle}
                  value={newRoleDataScope}
                  onChange={(e) => setNewRoleDataScope(Number(e.target.value))}
                >
                  <option value={1}>1 - ALL (Xem dữ liệu toàn hệ thống — chỉ vai trò được phép)</option>
                  <option value={2}>2 - ORG_UNIT (Xem dữ liệu đơn vị & các đơn vị con)</option>
                  <option value={3}>3 - SUBORDINATES (Xem dữ liệu cấp dưới theo cây quản lý)</option>
                  <option value={4}>4 - SELF (Chỉ xem dữ liệu của chính mình — mặc định)</option>
                </select>
              </div>
              <input
                style={inputStyle}
                placeholder="Danh sách quyền (cách nhau dấu phẩy)"
                value={newRolePerms}
                onChange={(e) => setNewRolePerms(e.target.value)}
              />
              <button
                type="submit"
                className="btn-primary"
                style={{ padding: '8px 16px' }}
                disabled={!hasPermission('roles.manage')}
              >
                Thêm vai trò
              </button>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  disabled={!hasPermission('roles.manage')}
                  onClick={() => void handleSyncPermissions()}
                >
                  Đồng bộ quyền Module (4.2)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  disabled={!hasPermission('roles.read')}
                  onClick={() => void handleCheckOrphanPermissions()}
                >
                  Cảnh báo quyền mồ côi
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  disabled={!hasPermission('roles.read')}
                  onClick={() => void handleViewPermissionMatrix()}
                >
                  Ma trận Vai trò × Quyền
                </button>
              </div>
            </div>

            {selectedRoleUsers && (
              <div
                style={{
                  marginBottom: '14px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <strong>
                    👥 Người dùng thuộc vai trò {selectedRoleUsers.role.name} (
                    {selectedRoleUsers.users.length}):
                  </strong>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => setSelectedRoleUsers(null)}
                  >
                    Đóng
                  </button>
                </div>
                {selectedRoleUsers.users.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)' }}>Chưa có người dùng nào gán vai trò này.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '18px' }}>
                    {selectedRoleUsers.users.map((u) => (
                      <li key={u.id}>
                        #{u.id} {u.fullName} ({u.email}) — <code>{u.statusName}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div style={{ fontSize: '13px' }}>
              <strong>Danh sách vai trò hiện có ({roles.length}):</strong>
              <ul style={{ marginTop: '8px', paddingLeft: '18px', lineHeight: 1.8 }}>
                {roles.map((r) => (
                  <li key={r.id} style={{ marginBottom: '6px' }}>
                    <div>
                      <strong>#{r.id} - {r.name}</strong> (<code>{r.code}</code>){' '}
                      {r.isSystem ? '[SYSTEM]' : '[CUSTOM]'}{' '}
                      <span
                        style={{
                          padding: '1px 7px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: 'rgba(56, 189, 248, 0.16)',
                          color: '#38bdf8',
                        }}
                      >
                        Scope: {r.dataScope ?? 4} ({r.dataScopeName ?? 'SELF'})
                      </span>{' '}
                      — {r.permissions.length} quyền — <strong>{r.userCount ?? 0} user</strong>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        disabled={!hasPermission('roles.read')}
                        onClick={() => void handleViewRoleUsers(r)}
                      >
                        Xem user ({r.userCount ?? 0})
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        disabled={!hasPermission('roles.manage')}
                        onClick={() => void handleQuickEditRole(r)}
                      >
                        Sửa / Gán quyền & Scope
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        disabled={!hasPermission('roles.manage')}
                        onClick={() => void handleCloneRole(r)}
                      >
                        Sao chép
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        disabled={
                          !hasPermission('roles.manage') ||
                          Boolean(r.isSystem) ||
                          (r.userCount ?? 0) > 0
                        }
                        title={
                          r.isSystem
                            ? 'Vai trò hệ thống bị khóa không cho xóa'
                            : (r.userCount ?? 0) > 0
                              ? 'Đang có người dùng sử dụng vai trò này'
                              : 'Xóa vai trò'
                        }
                        onClick={() => void handleDeleteRole(r)}
                      >
                        Xóa
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </form>

          {/* Section 4.3 — Data Scope & Custom Module Scope Rules Panel */}
          <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
              🛡️ Mục 4.3 — Phạm vi dữ liệu (Data Scope) & Rule mở rộng theo Module nghiệp vụ
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
              Áp dụng phạm vi dữ liệu trực tiếp ở tầng Backend/SQL cho danh sách, báo cáo xuất file (CSV/XLSX) và kiểm tra chống truy cập trái phép bằng cách đổi ID (Anti-IDOR 403). Cho phép các module nghiệp vụ đăng ký rule phạm vi riêng qua <code>DataScopeService.registerResourceRule()</code> mà không sửa trực tiếp Core.
            </p>

            {dataScopeSelf && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  background: 'rgba(15, 23, 42, 0.65)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  marginBottom: '16px',
                  fontSize: '13px',
                }}
              >
                <div>
                  <strong>Phạm vi dữ liệu hiệu lực của phiên hiện tại (User #{dataScopeSelf.userId}):</strong>{' '}
                  <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                    {dataScopeSelf.effectiveDataScope} — {dataScopeSelf.effectiveDataScopeName}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  • Đơn vị được phép truy cập (kể cả đơn vị con):{' '}
                  <code>
                    {dataScopeSelf.allowedOrganizationUnitIds.length > 0
                      ? dataScopeSelf.allowedOrganizationUnitIds.join(', ')
                      : 'Tất cả / Theo Scope'}
                  </code>{' '}
                  | • Cấp dưới trực thuộc theo cây quản lý (Subordinates):{' '}
                  <code>{dataScopeSelf.allowedSubordinateUserIds.length} user</code>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              <form onSubmit={(e) => void handleRegisterScopeRule(e)} style={{ display: 'grid', gap: '8px' }}>
                <strong style={{ fontSize: '13px' }}>
                  ➕ Đăng ký Rule phạm vi riêng cho Module nghiệp vụ (Không sửa Core):
                </strong>
                <input
                  style={inputStyle}
                  placeholder="Mã tài nguyên (VD: courses, orders, tickets)"
                  required
                  value={newScopeRuleResource}
                  onChange={(e) => setNewScopeRuleResource(e.target.value)}
                />
                <input
                  style={inputStyle}
                  placeholder="Tên module nghiệp vụ (VD: lms-courses)"
                  required
                  value={newScopeRuleModule}
                  onChange={(e) => setNewScopeRuleModule(e.target.value)}
                />
                <input
                  style={inputStyle}
                  placeholder="Mô tả quy tắc phạm vi dữ liệu của module"
                  required
                  value={newScopeRuleDesc}
                  onChange={(e) => setNewScopeRuleDesc(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: '8px 14px', fontSize: '13px' }}
                  disabled={!hasPermission('roles.manage')}
                >
                  Đăng ký Rule Phạm vi Module
                </button>
              </form>

              <div style={{ fontSize: '13px' }}>
                <strong>Danh sách Rule phạm vi dữ liệu đã đăng ký ({dataScopeRules.length}):</strong>
                {dataScopeRules.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', marginTop: '8px', fontSize: '12px' }}>
                    Chưa có module nghiệp vụ nào đăng ký rule tùy chỉnh ngoài 4 mức mặc định (ALL, ORG_UNIT, SUBORDINATES, SELF).
                  </div>
                ) : (
                  <ul style={{ marginTop: '8px', paddingLeft: '18px', lineHeight: 1.7 }}>
                    {dataScopeRules.map((rule) => (
                      <li key={rule.resource}>
                        <code>{rule.resource}</code> (Module: <strong>{rule.module}</strong>) —{' '}
                        {rule.description}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 4: AUDIT LOGS (Mục 4.4 — Nhật ký thao tác bất biến) */}
      {subTab === 'audit-logs' && (
        <div>
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700 }}>
                  📜 Mục 4.4 — Nhật ký thao tác hệ thống (Immutable Audit Log)
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Lưu vết bất biến (Append-only) toàn bộ thao tác nhạy cảm: Người thực hiện (User ID / Service Account), Thời gian & IP, Module & Chức năng, Dữ liệu Trước/Sau (Before/After JSON đã tự động che mật khẩu/secret), Lý do thay đổi, Request ID & Correlation ID. Nghiêm cấm sửa/xóa qua API thường (403 Forbidden).
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void loadAuditLogs()}
                style={{ padding: '7px 14px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCw size={14} /> Tra cứu / Làm mới ({auditTotal})
              </button>
            </div>

            {/* Filter Bar (4.4.7) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '10px',
                marginBottom: '16px',
                padding: '12px',
                borderRadius: '10px',
                background: 'rgba(15, 23, 42, 0.55)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Loại tác nhân (Actor Type)
                </label>
                <select
                  style={inputStyle}
                  value={auditActorTypeFilter}
                  onChange={(e) => {
                    setAuditActorTypeFilter(e.target.value);
                    setAuditPage(1);
                  }}
                >
                  <option value="">Tất cả (User + Service Account + System)</option>
                  <option value="1">1 — USER (Người dùng)</option>
                  <option value="2">2 — SERVICE_ACCOUNT (Tài khoản hệ thống)</option>
                  <option value="3">3 — SYSTEM (Tiến trình nội bộ)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Module nghiệp vụ
                </label>
                <select
                  style={inputStyle}
                  value={auditModuleFilter}
                  onChange={(e) => {
                    setAuditModuleFilter(e.target.value);
                    setAuditPage(1);
                  }}
                >
                  <option value="">Tất cả Module</option>
                  <option value="users">users (Người dùng)</option>
                  <option value="roles">roles (Vai trò & Quyền)</option>
                  <option value="organizations">organizations (Đơn vị/Chi nhánh)</option>
                  <option value="auth">auth (Xác thực & Service Account)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Hành động (Action)
                </label>
                <input
                  style={inputStyle}
                  placeholder="VD: role.update, user.unlock..."
                  value={auditActionFilter}
                  onChange={(e) => {
                    setAuditActionFilter(e.target.value);
                    setAuditPage(1);
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  User ID thực hiện
                </label>
                <input
                  style={inputStyle}
                  placeholder="VD: 1, 2..."
                  value={auditActorUserIdFilter}
                  onChange={(e) => {
                    setAuditActorUserIdFilter(e.target.value);
                    setAuditPage(1);
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Correlation ID / Request ID
                </label>
                <input
                  style={inputStyle}
                  placeholder="VD: corr-seed-audit-001"
                  value={auditCorrelationFilter}
                  onChange={(e) => {
                    setAuditCorrelationFilter(e.target.value);
                    setAuditPage(1);
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Từ khóa (Lý do / Định danh / IP)
                </label>
                <input
                  style={inputStyle}
                  placeholder="Tìm kiếm tự do..."
                  value={auditSearchQuery}
                  onChange={(e) => {
                    setAuditSearchQuery(e.target.value);
                    setAuditPage(1);
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Từ ngày (From Date)
                </label>
                <input
                  type="date"
                  style={inputStyle}
                  value={auditFromDate}
                  onChange={(e) => {
                    setAuditFromDate(e.target.value);
                    setAuditPage(1);
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Đến ngày (To Date)
                </label>
                <input
                  type="date"
                  style={inputStyle}
                  value={auditToDate}
                  onChange={(e) => {
                    setAuditToDate(e.target.value);
                    setAuditPage(1);
                  }}
                />
              </div>
            </div>

            {/* Audit Log Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '10px 8px' }}>ID / Thời gian</th>
                    <th style={{ padding: '10px 8px' }}>Người thực hiện (4.4.1)</th>
                    <th style={{ padding: '10px 8px' }}>Module / Chức năng / Hành động (4.4.3)</th>
                    <th style={{ padding: '10px 8px' }}>Lý do thay đổi (4.4.5)</th>
                    <th style={{ padding: '10px 8px' }}>IP & Request / Correlation ID (4.4.2 & 4.4.6)</th>
                    <th style={{ padding: '10px 8px', textAlign: 'right' }}>Chi tiết & Kiểm chứng Bất biến (4.4.4 & 4.4.8)</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Không tìm thấy bản ghi Nhật ký thao tác (Audit Log) nào khớp bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.12)' }}>
                        <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700 }}>#{log.id}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {new Date(log.createdAt).toLocaleString('vi-VN')}
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 7px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background:
                                log.actorType === 2
                                  ? 'rgba(168, 85, 247, 0.2)'
                                  : log.actorType === 1
                                    ? 'rgba(56, 189, 248, 0.2)'
                                    : 'rgba(148, 163, 184, 0.2)',
                              color:
                                log.actorType === 2
                                  ? '#c084fc'
                                  : log.actorType === 1
                                    ? '#38bdf8'
                                    : '#cbd5e1',
                              marginBottom: '3px',
                            }}
                          >
                            {log.actorTypeName}
                          </span>
                          <div style={{ fontSize: '12px' }}>
                            {log.actorIdentifier || (log.actorUserId ? `User #${log.actorUserId}` : log.actorServiceAccountId ? `SA #${log.actorServiceAccountId}` : 'system')}
                          </div>
                          {log.actorUserId && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              User ID: <code>{log.actorUserId}</code>
                            </div>
                          )}
                          {log.actorServiceAccountId && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              SA ID: <code>{log.actorServiceAccountId}</code>
                              {log.actorApiClientId ? ` | Client #${log.actorApiClientId}` : ''}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <div>
                            <strong style={{ color: '#38bdf8' }}>{log.module}</strong> /{' '}
                            <span>{log.feature}</span>
                          </div>
                          <div style={{ marginTop: '2px' }}>
                            <code>{log.action}</code>
                            {log.resourceType && (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                                ({log.resourceType} #{log.resourceId ?? 'N/A'})
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px', maxWidth: '240px' }}>
                          {log.reason ? (
                            <span>{log.reason}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 8px', fontSize: '11px' }}>
                          <div>
                            IP: <code>{log.ipAddress ?? 'local'}</code>
                          </div>
                          <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                            Req: <code>{log.requestId ?? '—'}</code>
                          </div>
                          <div style={{ color: 'var(--text-muted)' }}>
                            Corr: <code>{log.correlationId ?? '—'}</code>
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => setSelectedAuditLog(log)}
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                            >
                              Xem Before/After
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => void handleTestAuditLogImmutability(log.id, 'DELETE')}
                              style={{ padding: '4px 10px', fontSize: '12px', color: '#f87171' }}
                              title="Kiểm chứng Mục 4.4.8: Thử gọi DELETE /roles/audit-logs/:id (Backend sẽ chặn 403)"
                            >
                              Thử Xóa (403)
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Tổng số bản ghi Audit Log: <strong>{auditTotal}</strong> (Trang {auditPage}/{auditTotalPages})
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  ← Trang trước
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={auditPage >= auditTotalPages}
                  onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))}
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  Trang sau →
                </button>
              </div>
            </div>
          </div>

          {/* Modal xem chi tiết Before / After JSON (Mục 4.4.4) */}
          {selectedAuditLog && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700 }}>
                  🔍 Chi tiết Nhật ký thao tác #{selectedAuditLog.id} — <code>{selectedAuditLog.action}</code>
                </h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void handleTestAuditLogImmutability(selectedAuditLog.id, 'PUT')}
                    style={{ padding: '4px 10px', fontSize: '12px', color: '#fbbf24' }}
                  >
                    Thử Sửa PUT (Kiểm chứng 403)
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSelectedAuditLog(null)}
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                  >
                    Đóng ✕
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                Actor: <strong>{selectedAuditLog.actorTypeName}</strong> ({selectedAuditLog.actorIdentifier ?? 'N/A'}) | IP: <code>{selectedAuditLog.ipAddress ?? 'local'}</code> | Request ID: <code>{selectedAuditLog.requestId ?? '—'}</code> | Correlation ID: <code>{selectedAuditLog.correlationId ?? '—'}</code>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
                <div>
                  <strong style={{ fontSize: '13px', color: '#f87171' }}>
                    Dữ liệu TRƯỚC khi thay đổi (beforeData):
                  </strong>
                  <pre
                    style={{
                      marginTop: '6px',
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(248, 113, 113, 0.3)',
                      fontSize: '12px',
                      overflowX: 'auto',
                    }}
                  >
                    {selectedAuditLog.beforeData
                      ? JSON.stringify(selectedAuditLog.beforeData, null, 2)
                      : 'null (Tạo mới / Không có trạng thái trước)'}
                  </pre>
                </div>
                <div>
                  <strong style={{ fontSize: '13px', color: '#34d399' }}>
                    Dữ liệu SAU khi thay đổi (afterData):
                  </strong>
                  <pre
                    style={{
                      marginTop: '6px',
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(52, 211, 153, 0.3)',
                      fontSize: '12px',
                      overflowX: 'auto',
                    }}
                  >
                    {selectedAuditLog.afterData
                      ? JSON.stringify(selectedAuditLog.afterData, null, 2)
                      : 'null'}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
};
