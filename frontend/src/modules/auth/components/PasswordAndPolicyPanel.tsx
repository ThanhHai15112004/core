import React, { useState } from 'react';
import {
  Lock,
  Sparkles,
  Sliders,
  KeyRound,
  UserCog,
  Save,
  Copy,
} from 'lucide-react';
import {
  DB_ENCRYPTION_ALGO_OPTIONS,
  MFA_METHOD_OPTIONS,
  MFA_POLICY_OPTIONS,
  PASSWORD_HASH_ALGO_OPTIONS,
} from '../enum/auth.enum';
import { authApi } from '../services/auth.api';
import { authStyles } from './auth-ui.styles';
import type { MfaMethodType, MfaPolicyType, SecuritySettingsState } from '../types/auth.types';

interface PasswordAndPolicyPanelProps {
  accessToken: string;
  securitySettings: SecuritySettingsState;
  onUpdateSettingsState: React.Dispatch<React.SetStateAction<SecuritySettingsState>>;
  onRefresh: () => Promise<void>;
  notify: (type: 'ok' | 'err', text: string) => void;
}

export const PasswordAndPolicyPanel: React.FC<PasswordAndPolicyPanelProps> = ({
  accessToken,
  securitySettings,
  onUpdateSettingsState,
  onRefresh,
  notify,
}) => {
  // Change password state
  const [currentPassword, setCurrentPassword] = useState('!P@ssw0rd#');
  const [newPassword, setNewPassword] = useState('');
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [suggestedPasswords, setSuggestedPasswords] = useState<string[]>([]);

  // Forgot & Reset password state
  const [forgotIdentifier, setForgotIdentifier] = useState('admin.hr@gmail.com');
  const [resetOtpOrToken, setResetOtpOrToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('NewStrong@2026#');

  // Admin reset password state
  const [adminUserId, setAdminUserId] = useState('4');
  const [adminTempPass, setAdminTempPass] = useState('');
  const [adminResetReason, setAdminResetReason] = useState(
    'Cấp lại mật khẩu tạm theo yêu cầu hỗ trợ IT',
  );
  const [issuedTempPassword, setIssuedTempPassword] = useState<string | null>(null);

  const handleSuggestPasswords = async () => {
    try {
      const res = await authApi.suggestPasswords(4, 16);
      setSuggestedPasswords(res.suggestions);
      if (res.suggestions[0]) setNewPassword(res.suggestions[0]);
      notify('ok', 'Đã sinh 4 mật khẩu gợi ý đạt chuẩn chính sách bảo mật.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi sinh mật khẩu gợi ý');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    try {
      await authApi.changePassword(accessToken, {
        ...(currentPassword ? { currentPassword } : {}),
        newPassword,
        revokeOtherSessions,
      });
      setNewPassword('');
      notify('ok', 'Đã đổi mật khẩu thành công!');
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Đổi mật khẩu thất bại');
    }
  };

  const handleForgotPassword = async () => {
    try {
      const res = await authApi.forgotPassword(forgotIdentifier.trim());
      if (res.devOtpCode) setResetOtpOrToken(res.devOtpCode);
      else if (res.devResetToken) setResetOtpOrToken(res.devResetToken);
      notify(
        'ok',
        `Đã gửi yêu cầu khôi phục mật khẩu (${res.maskedEmail ?? forgotIdentifier}).${
          res.devOtpCode ? ` Mã OTP Dev: ${res.devOtpCode}` : ''
        }`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi gửi yêu cầu quên mật khẩu');
    }
  };

  const handleConfirmResetPassword = async () => {
    try {
      const isShortOtp = resetOtpOrToken.trim().length <= 8;
      await authApi.resetPassword({
        identifier: forgotIdentifier.trim(),
        ...(isShortOtp
          ? { otpCode: resetOtpOrToken.trim() }
          : { token: resetOtpOrToken.trim() }),
        newPassword: resetNewPassword,
      });
      notify('ok', 'Đặt lại mật khẩu thành công!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Đặt lại mật khẩu thất bại');
    }
  };

  const handleAdminResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    try {
      const res = await authApi.adminResetPassword(accessToken, {
        userId: Number(adminUserId),
        ...(adminTempPass.trim() ? { temporaryPassword: adminTempPass.trim() } : {}),
        mustChangePassword: true,
        revokeAllSessions: true,
        reason: adminResetReason,
      });
      setIssuedTempPassword(res.temporaryPassword);
      notify(
        'ok',
        `Admin đã đặt lại mật khẩu cho User #${res.userId} (Thu hồi ${res.revokedSessionsCount} phiên).`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi Admin Reset Password');
    }
  };

  const handleSaveSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    try {
      const updated = await authApi.updateSecuritySettings(accessToken, securitySettings);
      onUpdateSettingsState((prev) => ({ ...prev, ...updated }));
      notify('ok', 'Đã lưu và đồng bộ cấu hình chính sách bảo mật (Security Settings) toàn hệ thống!');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi cập nhật Security Settings');
    }
  };

  const toggleAllowedMfaMethod = (method: MfaMethodType) => {
    onUpdateSettingsState((prev) => {
      const exists = prev.allowedMfaMethods.includes(method);
      const next = exists
        ? prev.allowedMfaMethods.filter((m) => m !== method)
        : [...prev.allowedMfaMethods, method];
      return { ...prev, allowedMfaMethods: next.length > 0 ? next : ['TOTP'] };
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hàng 1: Đổi mật khẩu, Quên mật khẩu & Admin Reset Password */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
        }}
      >
        {/* Cột 1: Đổi mật khẩu & Gợi ý mật khẩu mạnh */}
        <div style={authStyles.cardHighlighted}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
              <Lock size={18} color="var(--primary)" />
              <span>Đổi Mật Khẩu & Sinh Mật Khẩu Mạnh (Mục 3.3)</span>
            </h3>
            <button type="button" onClick={handleSuggestPasswords} style={authStyles.btnSecondary}>
              <Sparkles size={14} color="var(--accent)" />
              <span>Gợi ý mật khẩu</span>
            </button>
          </div>
          <p style={authStyles.sectionDesc}>
            Kiểm tra độ phức tạp, chống chứa thông tin cá nhân, chống trùng mật khẩu cũ trong lịch
            sử và tự thu hồi phiên khác.
          </p>

          {suggestedPasswords.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
                flexWrap: 'wrap',
                marginBottom: '12px',
                padding: '10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
              }}
            >
              {suggestedPasswords.map((pw) => (
                <button
                  key={pw}
                  type="button"
                  onClick={() => {
                    setNewPassword(pw);
                    void navigator.clipboard?.writeText(pw);
                    notify('ok', `Đã chọn & copy mật khẩu gợi ý: ${pw}`);
                  }}
                  style={{
                    ...authStyles.btnSecondary,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    padding: '4px 10px',
                  }}
                >
                  <Copy size={11} /> {pw}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={authStyles.label}>Mật khẩu hiện tại</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Mật khẩu mới</label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nhập hoặc bấm Gợi ý mật khẩu mạnh"
                style={authStyles.monoInput}
              />
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={revokeOtherSessions}
                onChange={(e) => setRevokeOtherSessions(e.target.checked)}
              />
              <span>Thu hồi tất cả các phiên đăng nhập trên thiết bị khác sau khi đổi</span>
            </label>
            <div>
              <button type="submit" style={authStyles.btnPrimary}>
                <Lock size={14} />
                <span>Cập nhật mật khẩu (/auth/password/change)</span>
              </button>
            </div>
          </form>
        </div>

        {/* Cột 2: Quên mật khẩu & Admin Reset Password */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <KeyRound size={18} color="var(--secondary)" />
              <span>Quên & Đặt Lại Mật Khẩu (/auth/password/forgot & reset)</span>
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <div>
                <label style={authStyles.label}>Email / Username / SĐT</label>
                <input
                  type="text"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  style={authStyles.input}
                />
              </div>
              <div>
                <label style={authStyles.label}>Mã OTP / Reset Token</label>
                <input
                  type="text"
                  value={resetOtpOrToken}
                  onChange={(e) => setResetOtpOrToken(e.target.value)}
                  placeholder="6 số OTP hoặc Token"
                  style={authStyles.monoInput}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'end' }}>
              <div>
                <label style={authStyles.label}>Mật khẩu mới</label>
                <input
                  type="text"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  style={authStyles.monoInput}
                />
              </div>
              <button type="button" onClick={handleForgotPassword} style={authStyles.btnSecondary}>
                1. Gửi mã
              </button>
              <button type="button" onClick={handleConfirmResetPassword} style={authStyles.btnTeal}>
                2. Đặt lại
              </button>
            </div>
          </div>

          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <UserCog size={18} color="var(--accent)" />
              <span>Admin Cấp Lại Mật Khẩu Tạm (Mục 3.3.4)</span>
            </h3>
            <form onSubmit={handleAdminResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px' }}>
                <div>
                  <label style={authStyles.label}>User ID</label>
                  <input
                    type="number"
                    value={adminUserId}
                    onChange={(e) => setAdminUserId(e.target.value)}
                    style={authStyles.input}
                  />
                </div>
                <div>
                  <label style={authStyles.label}>Mật khẩu tạm (Để trống = tự sinh)</label>
                  <input
                    type="text"
                    value={adminTempPass}
                    onChange={(e) => setAdminTempPass(e.target.value)}
                    placeholder="Tự động sinh mật khẩu mạnh nếu để trống"
                    style={authStyles.monoInput}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'end' }}>
                <div>
                  <label style={authStyles.label}>Lý do cấp lại</label>
                  <input
                    type="text"
                    value={adminResetReason}
                    onChange={(e) => setAdminResetReason(e.target.value)}
                    style={authStyles.input}
                  />
                </div>
                <button type="submit" style={authStyles.btnAccent}>
                  Cấp mật khẩu tạm
                </button>
              </div>
            </form>
            {issuedTempPassword && (
              <div style={{ ...authStyles.codeBox, marginTop: '8px' }}>
                <strong>Mật khẩu tạm đã cấp:</strong> {issuedTempPassword}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hàng 2: Cấu hình Chính sách Bảo mật toàn hệ thống (Security Settings) */}
      <form onSubmit={handleSaveSecuritySettings} style={authStyles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
              <Sliders size={18} color="var(--primary)" />
              <span>Chính Sách Bảo Mật Toàn Hệ Thống (/auth/security-settings)</span>
            </h3>
            <p style={{ ...authStyles.sectionDesc, margin: '4px 0 0' }}>
              Đồng bộ 2 chiều giữa bảng `auth_security_settings` và `SettingRegistryService`
              (Password Policy, Crypto, MFA Policy, Lockout, Session TTL).
            </p>
          </div>
          <button type="submit" style={authStyles.btnPrimary}>
            <Save size={15} />
            <span>Lưu cấu hình bảo mật</span>
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '14px',
            marginBottom: '16px',
          }}
        >
          <div>
            <label style={authStyles.label}>Độ dài mật khẩu tối thiểu</label>
            <input
              type="number"
              min={6}
              max={64}
              value={securitySettings.passwordMinLength}
              onChange={(e) =>
                onUpdateSettingsState((s) => ({ ...s, passwordMinLength: Number(e.target.value) }))
              }
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Số mật khẩu cũ cấm dùng lại</label>
            <input
              type="number"
              min={1}
              max={24}
              value={securitySettings.passwordHistoryLimit}
              onChange={(e) =>
                onUpdateSettingsState((s) => ({
                  ...s,
                  passwordHistoryLimit: Number(e.target.value),
                }))
              }
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Thuật toán băm mật khẩu</label>
            <select
              value={securitySettings.passwordHashAlgorithm}
              onChange={(e) =>
                onUpdateSettingsState((s) => ({
                  ...s,
                  passwordHashAlgorithm: e.target.value as SecuritySettingsState['passwordHashAlgorithm'],
                }))
              }
              style={authStyles.input}
            >
              {PASSWORD_HASH_ALGO_OPTIONS.map((algo) => (
                <option key={algo} value={algo}>
                  {algo}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Thuật toán mã hóa dữ liệu nhạy cảm</label>
            <select
              value={securitySettings.dbEncryptionAlgorithm}
              onChange={(e) =>
                onUpdateSettingsState((s) => ({
                  ...s,
                  dbEncryptionAlgorithm: e.target.value as SecuritySettingsState['dbEncryptionAlgorithm'],
                }))
              }
              style={authStyles.input}
            >
              {DB_ENCRYPTION_ALGO_OPTIONS.map((algo) => (
                <option key={algo} value={algo}>
                  {algo}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Chính sách bắt buộc MFA (MFA Policy)</label>
            <select
              value={securitySettings.mfaPolicy}
              onChange={(e) =>
                onUpdateSettingsState((s) => ({
                  ...s,
                  mfaPolicy: e.target.value as MfaPolicyType,
                }))
              }
              style={authStyles.input}
            >
              {MFA_POLICY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Số lần đăng nhập sai tối đa</label>
            <input
              type="number"
              min={3}
              max={20}
              value={securitySettings.maxFailedLoginAttempts}
              onChange={(e) =>
                onUpdateSettingsState((s) => ({
                  ...s,
                  maxFailedLoginAttempts: Number(e.target.value),
                }))
              }
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Thời gian tự khóa tài khoản (Phút)</label>
            <input
              type="number"
              min={1}
              max={1440}
              value={securitySettings.lockoutDurationMinutes}
              onChange={(e) =>
                onUpdateSettingsState((s) => ({
                  ...s,
                  lockoutDurationMinutes: Number(e.target.value),
                }))
              }
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Session Idle Timeout (Phút)</label>
            <input
              type="number"
              min={5}
              max={1440}
              value={securitySettings.sessionIdleTimeoutMinutes}
              onChange={(e) =>
                onUpdateSettingsState((s) => ({
                  ...s,
                  sessionIdleTimeoutMinutes: Number(e.target.value),
                }))
              }
              style={authStyles.input}
            />
          </div>
        </div>

        {/* Các cờ chính sách Boolean & Phương thức MFA cho phép */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '10px',
            padding: '14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
          }}
        >
          {(
            [
              ['requireUppercase', 'Bắt buộc chữ hoa (A-Z)'],
              ['requireNumbers', 'Bắt buộc chữ số (0-9)'],
              ['requireSpecialChars', 'Bắt buộc ký tự đặc biệt'],
              ['disallowUserInfoInPassword', 'Cấm chứa Username/Email/SĐT trong mật khẩu'],
              ['preventPasswordReuse', 'Chống đặt trùng mật khẩu cũ'],
              ['revokeSessionsOnPasswordChange', 'Tự thu hồi phiên khi đổi mật khẩu'],
              ['allowEmailRegistration', 'Cho phép tự đăng ký bằng Email'],
              ['allowPhoneRegistration', 'Cho phép tự đăng ký bằng SĐT'],
              ['requireEmailVerification', 'Bắt buộc xác minh Email sau đăng ký'],
              ['enableLoginAuditLog', 'Ghi nhật ký Audit Log đăng nhập'],
            ] as const
          ).map(([field, label]) => (
            <label
              key={field}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12.5px',
                color: 'var(--text-main)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={Boolean(securitySettings[field])}
                onChange={(e) =>
                  onUpdateSettingsState((s) => ({ ...s, [field]: e.target.checked }))
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            Phương thức MFA được phép:
          </strong>
          {MFA_METHOD_OPTIONS.map((m) => {
            const active = securitySettings.allowedMfaMethods.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleAllowedMfaMethod(m)}
                style={active ? authStyles.badgePrimary : authStyles.btnSecondary}
              >
                {active ? `✓ ${m}` : m}
              </button>
            );
          })}
        </div>
      </form>
    </div>
  );
};

