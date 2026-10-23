import React, { useState } from 'react';
import {
  Smartphone,
  Mail,
  MessageSquare,
  KeyRound,
  Laptop,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
  Copy,
} from 'lucide-react';
import { authApi } from '../services/auth.api';
import { authStyles } from './auth-ui.styles';
import type { MfaMethodType, MfaStatusData, TrustedDeviceItem } from '../types/auth.types';

interface MfaAndDevicesPanelProps {
  accessToken: string;
  mfaStatus: MfaStatusData | null;
  trustedDevices: TrustedDeviceItem[];
  onRefresh: () => Promise<void>;
  notify: (type: 'ok' | 'err', text: string) => void;
}

export const MfaAndDevicesPanel: React.FC<MfaAndDevicesPanelProps> = ({
  accessToken,
  mfaStatus,
  trustedDevices,
  onRefresh,
  notify,
}) => {
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpOtpauthUrl, setTotpOtpauthUrl] = useState<string | null>(null);
  const [totpSetupCode, setTotpSetupCode] = useState('');
  const [smsPhone, setSmsPhone] = useState('0901234567');
  const [smsSetupCode, setSmsSetupCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  // Step-up verification state
  const [stepUpPassword, setStepUpPassword] = useState('!P@ssw0rd#');
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpAction, setStepUpAction] = useState('security.sensitive_operation');
  const [issuedStepUpToken, setIssuedStepUpToken] = useState<string | null>(null);

  // Admin reset MFA state
  const [adminResetUserId, setAdminResetUserId] = useState('2');
  const [adminResetReason, setAdminResetReason] = useState(
    'Người dùng mất thiết bị xác thực, đã xác minh danh tính qua Helpdesk',
  );
  const [adminResetRef, setAdminResetRef] = useState('TICKET-AUTH-2026-01');

  const handleSetupTotp = async () => {
    if (!accessToken) return;
    try {
      const res = await authApi.setupTotp(accessToken);
      setTotpSecret(res.secret);
      setTotpOtpauthUrl(res.otpauthUrl);
      notify('ok', 'Đã khởi tạo khóa bí mật TOTP. Nhập mã 6 số để kích hoạt.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi khởi tạo TOTP');
    }
  };

  const handleEnableTotp = async () => {
    if (!accessToken) return;
    try {
      const res = await authApi.enableTotp(accessToken, totpSetupCode.trim());
      setRecoveryCodes(res.recoveryCodes ?? []);
      setTotpSecret(null);
      setTotpSetupCode('');
      notify('ok', 'Đã kích hoạt TOTP thành công!');
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Mã TOTP không hợp lệ');
    }
  };

  const handleEnableEmailOtp = async () => {
    if (!accessToken) return;
    try {
      const res = await authApi.enableEmailOtp(accessToken);
      if (res.recoveryCodes?.length) setRecoveryCodes(res.recoveryCodes);
      notify('ok', 'Đã bật xác thực bước 2 qua Email OTP.');
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi bật Email OTP');
    }
  };

  const handleSendSmsForSetup = async () => {
    if (!accessToken) return;
    try {
      const res = await authApi.sendSmsOtp({ phone: smsPhone.trim() }, accessToken);
      if (res.devOtpCode) setSmsSetupCode(res.devOtpCode);
      notify(
        'ok',
        `Đã gửi mã SMS OTP tới ${res.maskedPhone}.${
          res.devOtpCode ? ` Mã Dev: ${res.devOtpCode}` : ''
        }`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi gửi SMS OTP');
    }
  };

  const handleEnableSmsOtp = async () => {
    if (!accessToken) return;
    try {
      const res = await authApi.enableSmsOtp(accessToken, {
        phone: smsPhone.trim(),
        ...(smsSetupCode.trim() ? { code: smsSetupCode.trim() } : {}),
      });
      if (res.recoveryCodes?.length) setRecoveryCodes(res.recoveryCodes);
      notify('ok', 'Đã bật xác thực bước 2 qua SMS OTP.');
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi bật SMS OTP');
    }
  };

  const handleDisableMfa = async (method: 'TOTP' | 'EMAIL_OTP' | 'SMS_OTP' | 'ALL') => {
    if (!accessToken) return;
    try {
      await authApi.disableMfa(accessToken, { method });
      notify('ok', `Đã tắt phương thức MFA: ${method}`);
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi tắt MFA');
    }
  };

  const handleRegenerateRecoveryCodes = async () => {
    if (!accessToken) return;
    try {
      const res = await authApi.regenerateRecoveryCodes(accessToken);
      setRecoveryCodes(res.recoveryCodes);
      notify('ok', `Đã cấp mới ${res.recoveryCodes.length} mã khôi phục dự phòng.`);
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Cần bật ít nhất 1 phương thức MFA trước');
    }
  };

  const handleVerifyStepUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    try {
      const res = await authApi.verifyStepUp(accessToken, {
        ...(stepUpPassword ? { password: stepUpPassword } : {}),
        ...(stepUpCode ? { code: stepUpCode, method: 'TOTP' as MfaMethodType } : {}),
        action: stepUpAction,
      });
      setIssuedStepUpToken(res.stepUpToken);
      notify(
        'ok',
        `Xác thực nâng cao (Step-Up) thành công bằng ${res.verifiedMethod} (TTL: ${res.expiresInSeconds}s).`,
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Xác thực Step-Up thất bại');
    }
  };

  const handleAdminResetMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    try {
      const res = await authApi.adminResetMfa(accessToken, {
        userId: Number(adminResetUserId),
        reason: adminResetReason,
        verificationReference: adminResetRef,
        revokeAllSessions: true,
      });
      notify(
        'ok',
        `Admin đã đặt lại MFA cho User #${res.userId} (Thu hồi ${res.revokedSessionsCount} phiên & ${res.revokedTrustedDevicesCount} thiết bị tin cậy).`,
      );
      await onRefresh();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Lỗi Admin Reset MFA');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hàng 1: Các phương thức MFA & Recovery Codes */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
        }}
      >
        <div style={authStyles.cardHighlighted}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
              <ShieldCheck size={18} color="var(--primary)" />
              <span>Cấu Hình Xác Thực Đa Nhân Tố (MFA / 2FA)</span>
            </h3>
            <span style={mfaStatus?.mfaEnabled ? authStyles.badgeSuccess : authStyles.badgeWarning}>
              {mfaStatus?.mfaEnabled ? 'MFA ĐANG BẬT' : 'MFA ĐANG TẮT'}
            </span>
          </div>
          <p style={authStyles.sectionDesc}>
            Quản lý 4 phương thức xác thực bước 2: Ứng dụng Authenticator (TOTP), Email OTP, SMS
            OTP và Mã dự phòng (Recovery Codes).
          </p>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <span style={mfaStatus?.totpEnabled ? authStyles.badgeSuccess : authStyles.badgePrimary}>
              TOTP: {mfaStatus?.totpEnabled ? 'Bật' : 'Tắt'}
            </span>
            <span style={mfaStatus?.emailOtpEnabled ? authStyles.badgeSuccess : authStyles.badgePrimary}>
              Email OTP: {mfaStatus?.emailOtpEnabled ? 'Bật' : 'Tắt'}
            </span>
            <span style={mfaStatus?.smsOtpEnabled ? authStyles.badgeSuccess : authStyles.badgePrimary}>
              SMS OTP: {mfaStatus?.smsOtpEnabled ? 'Bật' : 'Tắt'}
            </span>
            <span style={authStyles.badgePrimary}>
              Mã dự phòng còn lại: {mfaStatus?.remainingRecoveryCodesCount ?? 0}
            </span>
          </div>

          {/* 1. TOTP Setup */}
          <div
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              marginBottom: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Smartphone size={15} color="var(--primary)" />
                <span>1. Ứng dụng Authenticator (TOTP RFC 6238)</span>
              </strong>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={handleSetupTotp} style={authStyles.btnSecondary}>
                  Khởi tạo Secret
                </button>
                {mfaStatus?.totpEnabled && (
                  <button
                    type="button"
                    onClick={() => handleDisableMfa('TOTP')}
                    style={authStyles.btnDanger}
                  >
                    Tắt TOTP
                  </button>
                )}
              </div>
            </div>

            {totpSecret && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                <div style={authStyles.codeBox}>
                  <div>
                    <strong>Secret (Base32):</strong> {totpSecret}
                  </div>
                  {totpOtpauthUrl && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {totpOtpauthUrl}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={totpSetupCode}
                    onChange={(e) => setTotpSetupCode(e.target.value)}
                    placeholder="Nhập mã 6 số từ Google Authenticator"
                    style={authStyles.monoInput}
                  />
                  <button type="button" onClick={handleEnableTotp} style={authStyles.btnPrimary}>
                    Kích hoạt
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2. Email OTP & 3. SMS OTP */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
              }}
            >
              <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <Mail size={15} color="var(--secondary)" />
                <span>2. Email OTP</span>
              </strong>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleEnableEmailOtp} style={authStyles.btnTeal}>
                  Bật Email OTP
                </button>
                {mfaStatus?.emailOtpEnabled && (
                  <button
                    type="button"
                    onClick={() => handleDisableMfa('EMAIL_OTP')}
                    style={authStyles.btnDanger}
                  >
                    Tắt
                  </button>
                )}
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
              }}
            >
              <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <MessageSquare size={15} color="var(--accent)" />
                <span>3. SMS OTP</span>
              </strong>
              <input
                type="text"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                placeholder="Số điện thoại nhận OTP"
                style={{ ...authStyles.input, marginBottom: '6px' }}
              />
              <input
                type="text"
                value={smsSetupCode}
                onChange={(e) => setSmsSetupCode(e.target.value)}
                placeholder="Mã OTP (nếu có)"
                style={{ ...authStyles.monoInput, marginBottom: '6px' }}
              />
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleSendSmsForSetup} style={authStyles.btnSecondary}>
                  Gửi mã
                </button>
                <button type="button" onClick={handleEnableSmsOtp} style={authStyles.btnPrimary}>
                  Bật SMS
                </button>
              </div>
            </div>
          </div>

          {/* 4. Recovery Codes */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleRegenerateRecoveryCodes}
              style={authStyles.btnSecondary}
            >
              <RotateCcw size={14} />
              <span>Cấp lại 8 mã khôi phục (Recovery Codes)</span>
            </button>
            {mfaStatus?.mfaEnabled && (
              <button
                type="button"
                onClick={() => handleDisableMfa('ALL')}
                style={authStyles.btnDanger}
              >
                Tắt toàn bộ MFA
              </button>
            )}
          </div>

          {recoveryCodes.length > 0 && (
            <div style={{ ...authStyles.codeBox, marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <strong style={{ color: 'var(--primary)' }}>
                  Danh sách Recovery Codes (Chỉ hiển thị 1 lần):
                </strong>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
                    notify('ok', 'Đã sao chép Recovery Codes vào bộ nhớ tạm.');
                  }}
                  style={authStyles.btnSecondary}
                >
                  <Copy size={12} /> Copy
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {recoveryCodes.map((c) => (
                  <span
                    key={c}
                    style={{
                      padding: '4px 8px',
                      background: 'var(--bg-primary)',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      textAlign: 'center',
                      fontWeight: 600,
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Cột phải: Step-Up Verification & Admin Reset MFA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <KeyRound size={18} color="var(--accent)" />
              <span>Xác Thực Bước Nâng Cao (Step-Up Verification — Mục 3.5.7)</span>
            </h3>
            <p style={authStyles.sectionDesc}>
              Yêu cầu xác nhận lại mật khẩu hoặc mã MFA trước khi thực hiện thao tác nhạy cảm (cấp
              Step-Up Token ngắn hạn).
            </p>

            <form
              onSubmit={handleVerifyStepUp}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={authStyles.label}>Mật khẩu hiện tại</label>
                  <input
                    type="password"
                    value={stepUpPassword}
                    onChange={(e) => setStepUpPassword(e.target.value)}
                    style={authStyles.input}
                  />
                </div>
                <div>
                  <label style={authStyles.label}>Hoặc Mã MFA (Tùy chọn)</label>
                  <input
                    type="text"
                    value={stepUpCode}
                    onChange={(e) => setStepUpCode(e.target.value)}
                    placeholder="Mã 6 số"
                    style={authStyles.monoInput}
                  />
                </div>
              </div>
              <div>
                <label style={authStyles.label}>Thao tác nhạy cảm (Action Scope)</label>
                <input
                  type="text"
                  value={stepUpAction}
                  onChange={(e) => setStepUpAction(e.target.value)}
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <button type="submit" style={authStyles.btnAccent}>
                  <KeyRound size={14} />
                  <span>Cấp Step-Up Token (/auth/step-up/verify)</span>
                </button>
              </div>
            </form>

            {issuedStepUpToken && (
              <div style={{ ...authStyles.codeBox, marginTop: '10px' }}>
                <strong>Step-Up Token:</strong> {issuedStepUpToken.slice(0, 48)}...
              </div>
            )}
          </div>

          <div style={authStyles.card}>
            <h3 style={authStyles.sectionTitle}>
              <ShieldAlert size={18} color="var(--status-danger)" />
              <span>Admin Đặt Lại MFA Có Kiểm Soát (Mục 3.5.6)</span>
            </h3>
            <p style={authStyles.sectionDesc}>
              Dành cho Quản trị viên khi người dùng mất thiết bị xác thực (bắt buộc ghi nhận lý do
              và mã hồ sơ xác minh danh tính).
            </p>

            <form
              onSubmit={handleAdminResetMfa}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '10px' }}>
                <div>
                  <label style={authStyles.label}>User ID</label>
                  <input
                    type="number"
                    value={adminResetUserId}
                    onChange={(e) => setAdminResetUserId(e.target.value)}
                    style={authStyles.input}
                  />
                </div>
                <div>
                  <label style={authStyles.label}>Mã hồ sơ xác minh (Ticket Ref)</label>
                  <input
                    type="text"
                    value={adminResetRef}
                    onChange={(e) => setAdminResetRef(e.target.value)}
                    style={authStyles.monoInput}
                  />
                </div>
              </div>
              <div>
                <label style={authStyles.label}>Lý do đặt lại MFA (Bắt buộc &ge; 5 ký tự)</label>
                <input
                  type="text"
                  value={adminResetReason}
                  onChange={(e) => setAdminResetReason(e.target.value)}
                  style={authStyles.input}
                />
              </div>
              <div>
                <button type="submit" style={authStyles.btnDanger}>
                  <ShieldAlert size={14} />
                  <span>Thực thi Admin Reset MFA</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Hàng 2: Danh sách Thiết bị tin cậy (Trusted Devices — Mục 3.5.5) */}
      <div style={authStyles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
              <Laptop size={18} color="var(--secondary)" />
              <span>Danh Sách Thiết Bị Tin Cậy (Trusted Devices — {trustedDevices.length})</span>
            </h3>
            <p style={{ ...authStyles.sectionDesc, margin: '4px 0 0' }}>
              Các thiết bị đã được người dùng đánh dấu tin cậy để bỏ qua hỏi lại MFA trong thời hạn
              cho phép.
            </p>
          </div>
          {trustedDevices.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await authApi.revokeAllTrustedDevices(accessToken);
                  notify('ok', `Đã thu hồi toàn bộ ${res.revokedCount} thiết bị tin cậy.`);
                  await onRefresh();
                } catch (err) {
                  notify('err', err instanceof Error ? err.message : 'Lỗi thu hồi thiết bị tin cậy');
                }
              }}
              style={authStyles.btnDanger}
            >
              <Trash2 size={14} />
              <span>Thu hồi tất cả thiết bị tin cậy</span>
            </button>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Device ID</th>
                <th style={authStyles.tableHeaderCell}>Tên thiết bị</th>
                <th style={authStyles.tableHeaderCell}>Địa chỉ IP</th>
                <th style={authStyles.tableHeaderCell}>Sử dụng gần nhất</th>
                <th style={authStyles.tableHeaderCell}>Hiệu lực tới</th>
                <th style={authStyles.tableHeaderCell}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {trustedDevices.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có thiết bị tin cậy nào được lưu cho tài khoản này.
                  </td>
                </tr>
              ) : (
                trustedDevices.map((d) => (
                  <tr key={d.deviceId}>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {d.deviceId.slice(0, 12)}...
                    </td>
                    <td style={{ ...authStyles.tableCell, fontWeight: 600 }}>
                      {d.deviceName ?? 'Trusted Browser'}
                    </td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)' }}>
                      {d.ipAddress ?? '—'}
                    </td>
                    <td style={authStyles.tableCell}>
                      {new Date(d.lastUsedAt).toLocaleString('vi-VN')}
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgeSuccess}>
                        {new Date(d.trustedUntil).toLocaleDateString('vi-VN')}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await authApi.revokeTrustedDevice(accessToken, d.deviceId);
                            notify('ok', `Đã gỡ thiết bị tin cậy ${d.deviceName ?? d.deviceId}`);
                            await onRefresh();
                          } catch (err) {
                            notify('err', err instanceof Error ? err.message : 'Lỗi gỡ thiết bị');
                          }
                        }}
                        style={authStyles.btnDanger}
                      >
                        <Trash2 size={13} /> Gỡ bỏ
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

