import React, { useState } from 'react';
import {
  KeyRound,
  UserPlus,
  MailCheck,
  Smartphone,
  UserCheck,
  RefreshCw,
  LogOut,
  ShieldAlert,
  Globe,
  CheckCircle2,
} from 'lucide-react';
import { PRIVILEGED_PRESET_ACCOUNTS } from '../enum/auth.enum';
import { authApi } from '../services/auth.api';
import { authStyles } from './auth-ui.styles';
import type { AuthenticatedUserProfile, MfaMethodType } from '../types/auth.types';

interface AuthGatewayPanelProps {
  accessToken: string;
  refreshToken: string;
  currentUser: AuthenticatedUserProfile | null;
  onAuthenticated: (accessToken: string, refreshToken: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onRotateRefresh: () => Promise<void>;
  notify: (type: 'ok' | 'err', text: string) => void;
}

export const AuthGatewayPanel: React.FC<AuthGatewayPanelProps> = ({
  accessToken,
  refreshToken,
  currentUser,
  onAuthenticated,
  onLogout,
  onRotateRefresh,
  notify,
}) => {
  // Login & MFA step-2 state
  const [identifier, setIdentifier] = useState('superadmin@gmail.com');
  const [password, setPassword] = useState('!P@ssw0rd#');
  const [deviceName, setDeviceName] = useState('Enterprise Web Console');
  const [trustedDeviceToken, setTrustedDeviceToken] = useState<string>(() => {
    try {
      return window.localStorage.getItem('core_trusted_device_token') ?? '';
    } catch {
      return '';
    }
  });
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [availableMfaMethods, setAvailableMfaMethods] = useState<MfaMethodType[]>([]);
  const [selectedMfaMethod, setSelectedMfaMethod] = useState<MfaMethodType>('TOTP');
  const [mfaCode, setMfaCode] = useState('');
  const [trustThisDevice, setTrustThisDevice] = useState(true);

  // Registration state
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regPassword, setRegPassword] = useState('Abcd@454647#');

  // Verification Email / Phone state
  const [verifyEmailAddr, setVerifyEmailAddr] = useState('');
  const [verifyEmailCode, setVerifyEmailCode] = useState('');
  const [verifyPhoneNum, setVerifyPhoneNum] = useState('');
  const [verifyPhoneCode, setVerifyPhoneCode] = useState('');

  // Preferences state
  const [prefLocale, setPrefLocale] = useState(currentUser?.preferredLocale ?? 'vi');
  const [prefTimezone, setPrefTimezone] = useState(
    currentUser?.preferredTimezone ?? 'Asia/Ho_Chi_Minh',
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await authApi.login({
        identifier,
        password,
        deviceName,
        ...(trustedDeviceToken ? { trustedDeviceToken } : {}),
      });

      if (res.mfaRequired && res.mfaChallengeToken) {
        setMfaChallengeToken(res.mfaChallengeToken);
        const methods = res.availableMfaMethods ?? ['TOTP'];
        setAvailableMfaMethods(methods);
        setSelectedMfaMethod(methods[0] ?? 'TOTP');
        if (res.devOtpCode) {
          setMfaCode(res.devOtpCode);
          notify('ok', `Yêu cầu MFA bước 2. Mã OTP (Dev): ${res.devOtpCode}`);
        } else {
          notify('ok', 'Vui lòng nhập mã xác thực MFA bước 2 để hoàn tất đăng nhập.');
        }
        return;
      }

      if (res.accessToken) {
        setMfaChallengeToken(null);
        await onAuthenticated(res.accessToken, res.refreshToken ?? '');
        notify('ok', `Đăng nhập thành công với định danh ${identifier}`);
      }
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Đăng nhập thất bại');
    }
  };

  const handleVerifyMfaStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaChallengeToken) return;
    try {
      const res = await authApi.verifyMfaChallenge({
        mfaChallengeToken,
        code: mfaCode,
        method: selectedMfaMethod,
        trustThisDevice,
        deviceName,
      });

      if (res.trustedDeviceToken) {
        setTrustedDeviceToken(res.trustedDeviceToken);
        try {
          window.localStorage.setItem('core_trusted_device_token', res.trustedDeviceToken);
        } catch {
          // ignore
        }
      }

      if (res.accessToken) {
        setMfaChallengeToken(null);
        setMfaCode('');
        await onAuthenticated(res.accessToken, res.refreshToken ?? '');
        notify('ok', 'Xác thực MFA bước 2 thành công!');
      }
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Mã MFA không hợp lệ');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await authApi.register({
        ...(regUsername.trim() ? { username: regUsername.trim() } : {}),
        ...(regEmail.trim() ? { email: regEmail.trim() } : {}),
        ...(regPhone.trim() ? { phone: regPhone.trim() } : {}),
        firstName: regFirstName.trim() || 'Người dùng',
        lastName: regLastName.trim() || 'Mới',
        fullName: `${regLastName.trim()} ${regFirstName.trim()}`.trim() || 'Người dùng mới',
        password: regPassword,
      });

      if (res.verificationRequired) {
        if (res.devVerificationCode) {
          if (res.verificationChannel === 'EMAIL') setVerifyEmailCode(res.devVerificationCode);
          if (res.verificationChannel === 'PHONE') setVerifyPhoneCode(res.devVerificationCode);
        }
        notify(
          'ok',
          `Đăng ký thành công! Vui lòng xác minh ${res.verificationChannel} (${res.maskedTarget ?? ''}).${
            res.devVerificationCode ? ` Mã Dev: ${res.devVerificationCode}` : ''
          }`,
        );
      } else {
        if (res.accessToken) {
          await onAuthenticated(res.accessToken, res.refreshToken ?? '');
        }
        notify('ok', `Đã tạo tài khoản ${res.user.email || res.user.username} thành công!`);
      }
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Đăng ký tài khoản thất bại');
    }
  };

  const handleSendEmailVerify = async () => {
    const emailToUse = verifyEmailAddr.trim() || currentUser?.email || identifier;
    try {
      const res = await authApi.sendEmailVerification(emailToUse, accessToken);
      if (res.devVerificationCode) setVerifyEmailCode(res.devVerificationCode);
      notify(
        'ok',
        `Đã gửi mã xác minh tới ${res.maskedTarget} (Còn ${res.remainingSends} lần).${
          res.devVerificationCode ? ` Mã Dev: ${res.devVerificationCode}` : ''
        }`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi gửi mã xác minh Email');
    }
  };

  const handleConfirmEmailVerify = async () => {
    const emailToUse = verifyEmailAddr.trim() || currentUser?.email || identifier;
    try {
      await authApi.confirmEmailVerification({ email: emailToUse, code: verifyEmailCode.trim() });
      notify('ok', 'Xác minh địa chỉ Email thành công!');
      if (accessToken) await onAuthenticated(accessToken, refreshToken);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Mã xác minh Email không hợp lệ');
    }
  };

  const handleSendPhoneVerify = async () => {
    const phoneToUse = verifyPhoneNum.trim() || currentUser?.phone || '';
    try {
      const res = await authApi.sendPhoneVerification(phoneToUse, accessToken);
      if (res.devVerificationCode) setVerifyPhoneCode(res.devVerificationCode);
      notify(
        'ok',
        `Đã gửi OTP xác minh SĐT ${res.maskedTarget}.${
          res.devVerificationCode ? ` Mã Dev: ${res.devVerificationCode}` : ''
        }`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi gửi OTP xác minh SĐT');
    }
  };

  const handleConfirmPhoneVerify = async () => {
    const phoneToUse = verifyPhoneNum.trim() || currentUser?.phone || '';
    try {
      await authApi.confirmPhoneVerification({ phone: phoneToUse, code: verifyPhoneCode.trim() });
      notify('ok', 'Xác minh số điện thoại thành công!');
      if (accessToken) await onAuthenticated(accessToken, refreshToken);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Mã OTP SĐT không hợp lệ');
    }
  };

  const handleSavePreferences = async () => {
    if (!accessToken) return;
    try {
      const res = await authApi.updatePreferences(accessToken, {
        preferredLocale: prefLocale,
        preferredTimezone: prefTimezone,
      });
      notify(
        'ok',
        `Đã lưu tùy chọn ngôn ngữ (${res.preferredLocale}) & múi giờ (${res.preferredTimezone}).`,
      );
      await onAuthenticated(accessToken, refreshToken);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi cập nhật tùy chọn cá nhân');
    }
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        gap: '20px',
      }}
    >
      {/* Cột 1: Đăng nhập & MFA Challenge */}
      <div style={authStyles.cardHighlighted}>
        <h3 style={authStyles.sectionTitle}>
          <KeyRound size={18} color="var(--primary)" />
          <span>Đăng Nhập Đa Định Danh (Email / Username / SĐT)</span>
        </h3>
        <p style={authStyles.sectionDesc}>
          Hỗ trợ tự động nâng cấp thuật toán băm, chống dò tài khoản, khóa tạm thời khi nhập sai và
          nhận diện thiết bị tin cậy.
        </p>

        <div style={{ marginBottom: '14px' }}>
          <label style={authStyles.label}>Chọn nhanh tài khoản mẫu (Seeded Accounts)</label>
          <select
            value={
              PRIVILEGED_PRESET_ACCOUNTS.some((a) => a.email === identifier) ? identifier : ''
            }
            onChange={(e) => {
              if (e.target.value) {
                setIdentifier(e.target.value);
                setPassword('!P@ssw0rd#');
              }
            }}
            style={authStyles.input}
          >
            <option value="">-- Chọn tài khoản quản trị / nghiệp vụ mẫu --</option>
            {PRIVILEGED_PRESET_ACCOUNTS.map((acc) => (
              <option key={acc.email} value={acc.email}>
                {acc.label} — {acc.email} ({acc.role})
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={authStyles.label}>Email / Username / Số điện thoại</label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="superadmin@gmail.com hoặc 0901234567"
              style={authStyles.input}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={authStyles.label}>Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Tên thiết bị (Device Name)</label>
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                style={authStyles.input}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
            <button type="submit" style={authStyles.btnPrimary}>
              <KeyRound size={15} />
              <span>Đăng nhập (/auth/login)</span>
            </button>
            {accessToken && (
              <>
                <button type="button" onClick={onRotateRefresh} style={authStyles.btnTeal}>
                  <RefreshCw size={14} />
                  <span>Rotate Refresh Token</span>
                </button>
                <button type="button" onClick={onLogout} style={authStyles.btnDanger}>
                  <LogOut size={14} />
                  <span>Đăng xuất</span>
                </button>
              </>
            )}
          </div>
        </form>

        {/* Bước 2 MFA Challenge */}
        {mfaChallengeToken && (
          <form
            onSubmit={handleVerifyMfaStep2}
            style={{
              marginTop: '16px',
              padding: '14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--accent)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 700,
                fontSize: '13.5px',
                color: 'var(--accent)',
                marginBottom: '10px',
              }}
            >
              <ShieldAlert size={16} />
              <span>Xác thực MFA bước 2 (Challenge Active)</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={authStyles.label}>Phương thức MFA</label>
                <select
                  value={selectedMfaMethod}
                  onChange={(e) => setSelectedMfaMethod(e.target.value as MfaMethodType)}
                  style={authStyles.input}
                >
                  {(availableMfaMethods.length > 0
                    ? availableMfaMethods
                    : (['TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE'] as MfaMethodType[])
                  ).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={authStyles.label}>Mã OTP / Recovery Code</label>
                <input
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="Nhập 6 số hoặc mã khôi phục"
                  style={authStyles.monoInput}
                />
              </div>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                marginBottom: '10px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={trustThisDevice}
                onChange={(e) => setTrustThisDevice(e.target.checked)}
              />
              <span>Ghi nhớ thiết bị tin cậy này (Không hỏi lại MFA trong 30 ngày)</span>
            </label>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="submit" style={authStyles.btnAccent}>
                <CheckCircle2 size={15} />
                <span>Xác nhận MFA</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await authApi.sendEmailOtp({ mfaChallengeToken }, accessToken);
                    if (r.devOtpCode) setMfaCode(r.devOtpCode);
                    notify('ok', `Đã gửi Email OTP tới ${r.maskedEmail}`);
                  } catch (err) {
                    notify('err', err instanceof Error ? err.message : 'Lỗi gửi Email OTP');
                  }
                }}
                style={authStyles.btnSecondary}
              >
                Gửi Email OTP
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await authApi.sendSmsOtp({ mfaChallengeToken }, accessToken);
                    if (r.devOtpCode) setMfaCode(r.devOtpCode);
                    notify('ok', `Đã gửi SMS OTP tới ${r.maskedPhone}`);
                  } catch (err) {
                    notify('err', err instanceof Error ? err.message : 'Lỗi gửi SMS OTP');
                  }
                }}
                style={authStyles.btnSecondary}
              >
                Gửi SMS OTP
              </button>
            </div>
          </form>
        )}

        {/* Thông tin hồ sơ đang đăng nhập (/auth/me & /auth/preferences) */}
        {currentUser && (
          <div
            style={{
              marginTop: '18px',
              padding: '14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserCheck size={16} color="var(--secondary)" />
                <strong style={{ fontSize: '13.5px', color: 'var(--text-main)' }}>
                  {currentUser.fullName} (@{currentUser.username})
                </strong>
              </div>
              <span style={authStyles.badgeSuccess}>ID #{currentUser.id}</span>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <span style={authStyles.badgePrimary}>Email: {currentUser.email}</span>
              <span style={currentUser.emailVerified ? authStyles.badgeSuccess : authStyles.badgeWarning}>
                {currentUser.emailVerified ? 'Email đã xác minh' : 'Email chưa xác minh'}
              </span>
              <span style={currentUser.mfaEnabled ? authStyles.badgeSuccess : authStyles.badgeWarning}>
                MFA: {currentUser.mfaEnabled ? 'Đang bật' : 'Chưa bật'}
              </span>
              {currentUser.roles.map((r) => (
                <span key={r} style={authStyles.badgePrimary}>
                  Role: {r}
                </span>
              ))}
            </div>

            {/* Chỉnh sửa tùy chọn Ngôn ngữ & Múi giờ (/auth/preferences) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr auto',
                gap: '8px',
                alignItems: 'end',
                paddingTop: '10px',
                borderTop: '1px solid var(--border-color)',
              }}
            >
              <div>
                <label style={authStyles.label}>Ngôn ngữ ưu tiên</label>
                <select
                  value={prefLocale}
                  onChange={(e) => setPrefLocale(e.target.value)}
                  style={authStyles.input}
                >
                  <option value="vi">Tiếng Việt (vi)</option>
                  <option value="en">English (en)</option>
                </select>
              </div>
              <div>
                <label style={authStyles.label}>Múi giờ ưu tiên</label>
                <select
                  value={prefTimezone}
                  onChange={(e) => setPrefTimezone(e.target.value)}
                  style={authStyles.input}
                >
                  <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (GMT+7)</option>
                  <option value="UTC">UTC (GMT+0)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
                </select>
              </div>
              <button type="button" onClick={handleSavePreferences} style={authStyles.btnSecondary}>
                <Globe size={14} />
                <span>Lưu</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cột 2: Đăng ký tài khoản & Xác minh Email / SĐT */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <UserPlus size={18} color="var(--secondary)" />
            <span>Đăng Ký Tài Khoản Mới (/auth/register)</span>
          </h3>
          <p style={authStyles.sectionDesc}>
            Đăng ký bằng Email + mật khẩu hoặc Số điện thoại + mật khẩu (tuân thủ chính sách bật/tắt
            tự đăng ký của dự án).
          </p>

          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={authStyles.label}>Họ và đệm (Last Name)</label>
                <input
                  type="text"
                  value={regLastName}
                  onChange={(e) => setRegLastName(e.target.value)}
                  placeholder="Nguyễn Văn"
                  style={authStyles.input}
                />
              </div>
              <div>
                <label style={authStyles.label}>Tên (First Name)</label>
                <input
                  type="text"
                  value={regFirstName}
                  onChange={(e) => setRegFirstName(e.target.value)}
                  placeholder="An"
                  style={authStyles.input}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={authStyles.label}>Email</label>
                <input
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="user.new@gmail.com"
                  style={authStyles.input}
                />
              </div>
              <div>
                <label style={authStyles.label}>Số điện thoại</label>
                <input
                  type="text"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="0901234567"
                  style={authStyles.input}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={authStyles.label}>Username (Tùy chọn)</label>
                <input
                  type="text"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  placeholder="an.nguyenvan"
                  style={authStyles.input}
                />
              </div>
              <div>
                <label style={authStyles.label}>Mật khẩu</label>
                <input
                  type="text"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  style={authStyles.monoInput}
                />
              </div>
            </div>

            <div>
              <button type="submit" style={authStyles.btnTeal}>
                <UserPlus size={15} />
                <span>Đăng ký tài khoản mới</span>
              </button>
            </div>
          </form>
        </div>

        {/* Xác minh Email & Số điện thoại (Mục 3.2.6 & 3.2.7) */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <MailCheck size={18} color="var(--primary)" />
            <span>Xác Minh Email & Số Điện Thoại (OTP có giới hạn gửi lại)</span>
          </h3>
          <p style={authStyles.sectionDesc}>
            Gửi mã xác minh có thời hạn và giới hạn số lần gửi/nhập sai qua Notification Adapter.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            {/* Email Verification */}
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                1. Xác minh Email
              </strong>
              <input
                type="email"
                value={verifyEmailAddr}
                onChange={(e) => setVerifyEmailAddr(e.target.value)}
                placeholder={currentUser?.email ?? 'Nhập email cần xác minh'}
                style={authStyles.input}
              />
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={verifyEmailCode}
                  onChange={(e) => setVerifyEmailCode(e.target.value)}
                  placeholder="Mã 6 số"
                  style={authStyles.monoInput}
                />
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleSendEmailVerify} style={authStyles.btnSecondary}>
                  Gửi mã
                </button>
                <button type="button" onClick={handleConfirmEmailVerify} style={authStyles.btnPrimary}>
                  Xác nhận
                </button>
              </div>
            </div>

            {/* Phone Verification */}
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                <Smartphone size={13} style={{ display: 'inline', marginRight: '4px' }} />
                2. Xác minh SĐT (SMS OTP)
              </strong>
              <input
                type="text"
                value={verifyPhoneNum}
                onChange={(e) => setVerifyPhoneNum(e.target.value)}
                placeholder={currentUser?.phone ?? '0901234567'}
                style={authStyles.input}
              />
              <input
                type="text"
                value={verifyPhoneCode}
                onChange={(e) => setVerifyPhoneCode(e.target.value)}
                placeholder="Mã OTP 6 số"
                style={authStyles.monoInput}
              />
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleSendPhoneVerify} style={authStyles.btnSecondary}>
                  Gửi OTP
                </button>
                <button type="button" onClick={handleConfirmPhoneVerify} style={authStyles.btnTeal}>
                  Xác nhận
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

