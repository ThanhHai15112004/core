export type AuthSubTabId =
  | 'gateway'
  | 'mfa-devices'
  | 'sessions-history'
  | 'password-policy'
  | 'service-accounts';

export interface AuthSubTabMeta {
  readonly id: AuthSubTabId;
  readonly label: string;
  readonly badge?: string;
  readonly description: string;
}

export const AUTH_MODULE_TABS: readonly AuthSubTabMeta[] = [
  {
    id: 'gateway',
    label: 'Cổng Xác Thực & Định Danh',
    badge: '3.2 / 3.5',
    description: 'Đăng nhập, Đăng ký, Xác minh Email/SĐT, Hồ sơ (/auth/me) & Tùy chọn cá nhân',
  },
  {
    id: 'mfa-devices',
    label: 'MFA, Thiết Bị Tin Cậy & Step-Up',
    badge: '3.5',
    description: 'TOTP, Email/SMS OTP, Recovery Codes, Trusted Devices & Xác thực bước nâng cao',
  },
  {
    id: 'sessions-history',
    label: 'Phiên Hoạt Động & Lịch Sử',
    badge: '3.4',
    description: 'Quản lý các phiên đăng nhập đang mở, thu hồi phiên từ xa & nhật ký đăng nhập',
  },
  {
    id: 'password-policy',
    label: 'Mật Khẩu & Chính Sách Bảo Mật',
    badge: '3.3',
    description: 'Đổi/Quên/Gợi ý mật khẩu, Admin Reset & Cấu hình Security Settings toàn hệ thống',
  },
  {
    id: 'service-accounts',
    label: 'Service Accounts & API Clients',
    badge: '3.6',
    description: 'Tài khoản hệ thống M2M, Client ID/Secret, Scopes, Allowed IPs/CIDR & Usage Logs',
  },
] as const;

export const PRIVILEGED_PRESET_ACCOUNTS = [
  { label: 'Super Admin (#1)', email: 'superadmin@gmail.com', role: 'SUPER_ADMIN' },
  { label: 'System Admin (#2)', email: 'admin@gmail.com', role: 'SYSTEM_ADMIN' },
  { label: 'Security Admin (#3)', email: 'admin.security@gmail.com', role: 'SECURITY_ADMIN' },
  { label: 'HR Admin (#4)', email: 'admin.hr@gmail.com', role: 'HR_ADMIN' },
  { label: 'Mobile Admin (#5)', email: 'admin.mobile@gmail.com', role: 'MOBILE_ADMIN' },
  { label: 'System Console Admin (#6)', email: 'admin.ops@gmail.com', role: 'OPS_ADMIN' },
  { label: 'Finance Admin (#7)', email: 'admin.finance@gmail.com', role: 'FINANCE_ADMIN' },
  { label: 'Support Admin (#8)', email: 'admin.support@gmail.com', role: 'SUPPORT_ADMIN' },
  { label: 'Branch Director HCM (#9)', email: 'director.hcm@gmail.com', role: 'DIRECTOR' },
  { label: 'Engineering Manager (#10)', email: 'manager.eng@gmail.com', role: 'MANAGER' },
] as const;

export const MFA_POLICY_OPTIONS = [
  { value: 'OPTIONAL', label: 'Tùy chọn (OPTIONAL) — Người dùng tự bật' },
  { value: 'REQUIRED_FOR_ADMINS', label: 'Bắt buộc cho Quản trị viên (REQUIRED_FOR_ADMINS)' },
  { value: 'REQUIRED_FOR_ALL', label: 'Bắt buộc toàn hệ thống (REQUIRED_FOR_ALL)' },
] as const;

export const MFA_METHOD_OPTIONS = ['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE'] as const;

export const PASSWORD_HASH_ALGO_OPTIONS = ['argon2id', 'bcrypt', 'pbkdf2'] as const;

export const DB_ENCRYPTION_ALGO_OPTIONS = ['aes-256-gcm', 'aes-256-cbc'] as const;

