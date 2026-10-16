import React, { useEffect, useState } from 'react';
import { Lock, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLiveQuery } from '@core/data';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@core/ui/primitives';
import { Panel, QueryView } from '@core/ui/blocks';
import {
  fetchSecuritySettings,
  updateSecuritySettings,
  type DbEncryptionAlgo,
  type MfaMethodOption,
  type MfaPolicyMode,
  type PasswordHashAlgo,
  type SecurityPolicySettings,
} from '../../services/governance.api';
import { securityKeys } from './security-keys';

const MFA_METHODS: readonly MfaMethodOption[] = ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'] as const;

export const SecurityPolicyPanel: React.FC = () => {
  const { t } = useLocale();
  const query = useLiveQuery(securityKeys.policy(), fetchSecuritySettings, { tier: 'slow' });

  return (
    <Panel
      title={t('gov.security.policy.title')}
      hint={t('gov.security.policy.hint')}
      className="mb-4"
    >
      <QueryView query={query} compact>
        {(settings) => <SecurityPolicyForm initial={settings} onUpdated={() => void query.refetch()} />}
      </QueryView>
    </Panel>
  );
};

function SecurityPolicyForm({
  initial,
  onUpdated,
}: {
  initial: SecurityPolicySettings;
  onUpdated: () => void;
}) {
  const { t } = useLocale();
  const [passwordHashAlgorithm, setPasswordHashAlgorithm] = useState<PasswordHashAlgo>(
    initial.passwordHashAlgorithm,
  );
  const [dbEncryptionAlgorithm, setDbEncryptionAlgorithm] = useState<DbEncryptionAlgo>(
    initial.dbEncryptionAlgorithm,
  );
  const [encryptFieldsAtRest, setEncryptFieldsAtRest] = useState<boolean>(
    initial.encryptFieldsAtRest,
  );
  const [mfaPolicy, setMfaPolicy] = useState<MfaPolicyMode>(initial.mfaPolicy);
  const [allowedMfaMethods, setAllowedMfaMethods] = useState<MfaMethodOption[]>(
    initial.allowedMfaMethods,
  );
  const [maxFailedLoginAttempts, setMaxFailedLoginAttempts] = useState<number>(
    initial.maxFailedLoginAttempts,
  );
  const [lockoutDurationMinutes, setLockoutDurationMinutes] = useState<number>(
    initial.lockoutDurationMinutes,
  );
  const [passwordMinLength, setPasswordMinLength] = useState<number>(initial.passwordMinLength);
  const [requireUppercase, setRequireUppercase] = useState<boolean>(initial.requireUppercase ?? true);
  const [requireNumbers, setRequireNumbers] = useState<boolean>(initial.requireNumbers ?? true);
  const [requireSpecialChars, setRequireSpecialChars] = useState<boolean>(
    initial.requireSpecialChars ?? false,
  );
  const [requireCurrentPasswordOnChange, setRequireCurrentPasswordOnChange] = useState<boolean>(
    initial.requireCurrentPasswordOnChange ?? true,
  );
  const [disallowUserInfoInPassword, setDisallowUserInfoInPassword] = useState<boolean>(
    initial.disallowUserInfoInPassword ?? true,
  );
  const [preventPasswordReuse, setPreventPasswordReuse] = useState<boolean>(
    initial.preventPasswordReuse ?? true,
  );
  const [passwordHistoryLimit, setPasswordHistoryLimit] = useState<number>(
    initial.passwordHistoryLimit ?? 5,
  );
  const [revokeSessionsOnPasswordChange, setRevokeSessionsOnPasswordChange] = useState<boolean>(
    initial.revokeSessionsOnPasswordChange ?? true,
  );
  const [disallowedPasswordsText, setDisallowedPasswordsText] = useState<string>(
    (initial.disallowedPasswords ?? []).join(', '),
  );

  useEffect(() => {
    setPasswordHashAlgorithm(initial.passwordHashAlgorithm);
    setDbEncryptionAlgorithm(initial.dbEncryptionAlgorithm);
    setEncryptFieldsAtRest(initial.encryptFieldsAtRest);
    setMfaPolicy(initial.mfaPolicy);
    setAllowedMfaMethods(initial.allowedMfaMethods);
    setMaxFailedLoginAttempts(initial.maxFailedLoginAttempts);
    setLockoutDurationMinutes(initial.lockoutDurationMinutes);
    setPasswordMinLength(initial.passwordMinLength);
    setRequireUppercase(initial.requireUppercase ?? true);
    setRequireNumbers(initial.requireNumbers ?? true);
    setRequireSpecialChars(initial.requireSpecialChars ?? false);
    setRequireCurrentPasswordOnChange(initial.requireCurrentPasswordOnChange ?? true);
    setDisallowUserInfoInPassword(initial.disallowUserInfoInPassword ?? true);
    setPreventPasswordReuse(initial.preventPasswordReuse ?? true);
    setPasswordHistoryLimit(initial.passwordHistoryLimit ?? 5);
    setRevokeSessionsOnPasswordChange(initial.revokeSessionsOnPasswordChange ?? true);
    setDisallowedPasswordsText((initial.disallowedPasswords ?? []).join(', '));
  }, [initial]);

  const saveMutation = useAppMutation<void, SecurityPolicySettings>({
    mutationFn: () =>
      updateSecuritySettings({
        passwordHashAlgorithm,
        dbEncryptionAlgorithm,
        encryptFieldsAtRest,
        mfaPolicy,
        allowedMfaMethods,
        maxFailedLoginAttempts,
        lockoutDurationMinutes,
        passwordMinLength,
        requireUppercase,
        requireNumbers,
        requireSpecialChars,
        requireCurrentPasswordOnChange,
        disallowUserInfoInPassword,
        preventPasswordReuse,
        passwordHistoryLimit,
        revokeSessionsOnPasswordChange,
        disallowedPasswords: disallowedPasswordsText
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      }),
    success: false,
    onSuccess: () => {
      toast.success(t('gov.security.policy.saved'));
      onUpdated();
    },
  });

  const toggleMfaMethod = (method: MfaMethodOption) => {
    if (allowedMfaMethods.includes(method)) {
      if (allowedMfaMethods.length <= 1) return;
      setAllowedMfaMethods(allowedMfaMethods.filter((m) => m !== method));
    } else {
      setAllowedMfaMethods([...allowedMfaMethods, method]);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* 1. Password Hash Algorithm */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted">
            {t('gov.security.policy.passwordHashAlgorithm')}
          </label>
          <Select
            value={passwordHashAlgorithm}
            onValueChange={(v) => setPasswordHashAlgorithm(v as PasswordHashAlgo)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SCRYPT">SCRYPT (N=16384, r=8, p=1)</SelectItem>
              <SelectItem value="PBKDF2_SHA512">PBKDF2-SHA512 (100,000 iter)</SelectItem>
              <SelectItem value="PBKDF2_SHA256">PBKDF2-SHA256 (210,000 iter)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 2. Database Field Encryption Algorithm (Encrypt-at-Rest) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted">
            {t('gov.security.policy.dbEncryptionAlgorithm')}
          </label>
          <Select
            value={dbEncryptionAlgorithm}
            onValueChange={(v) => setDbEncryptionAlgorithm(v as DbEncryptionAlgo)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AES_256_GCM">AES-256-GCM (NIST AEAD 256-bit)</SelectItem>
              <SelectItem value="CHACHA20_POLY1305">ChaCha20-Poly1305 (RFC 8439 AEAD)</SelectItem>
              <SelectItem value="AES_256_CBC_HMAC">AES-256-CBC + HMAC-SHA256 (EtM)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 3. MFA Enforcement Policy */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted">
            {t('gov.security.policy.mfaPolicy')}
          </label>
          <Select value={mfaPolicy} onValueChange={(v) => setMfaPolicy(v as MfaPolicyMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPTIONAL">OPTIONAL (Tùy chọn theo người dùng)</SelectItem>
              <SelectItem value="REQUIRED_FOR_ADMINS">
                REQUIRED_FOR_ADMINS (Bắt buộc với Admin)
              </SelectItem>
              <SelectItem value="REQUIRED_FOR_ALL">
                REQUIRED_FOR_ALL (Bắt buộc toàn hệ thống)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Numeric thresholds & switches */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted">
            {t('gov.security.policy.maxFailedLoginAttempts')}
          </label>
          <Input
            type="number"
            min={3}
            max={20}
            value={maxFailedLoginAttempts}
            onChange={(e) => setMaxFailedLoginAttempts(Number(e.target.value) || 5)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted">
            {t('gov.security.policy.lockoutDurationMinutes')}
          </label>
          <Input
            type="number"
            min={1}
            max={1440}
            value={lockoutDurationMinutes}
            onChange={(e) => setLockoutDurationMinutes(Number(e.target.value) || 15)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted">
            {t('gov.security.policy.passwordMinLength')}
          </label>
          <Input
            type="number"
            min={6}
            max={64}
            value={passwordMinLength}
            onChange={(e) => setPasswordMinLength(Number(e.target.value) || 8)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted">
            Giới hạn lịch sử mật khẩu cũ (Password History Limit)
          </label>
          <Input
            type="number"
            min={1}
            max={24}
            value={passwordHistoryLimit}
            onChange={(e) => setPasswordHistoryLimit(Number(e.target.value) || 5)}
          />
        </div>
      </div>

      {/* Section 3.3 Password Policy & Recovery Settings */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted/40 p-3">
        <div className="text-xs font-semibold text-fg">
          Chính sách mật khẩu & Khôi phục tài khoản (Mục 3.3 — Biến Setting)
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
          <label className="flex items-center gap-2 text-xs text-fg">
            <Switch
              checked={requireUppercase}
              onCheckedChange={(c) => setRequireUppercase(Boolean(c))}
            />
            <span>Bắt buộc chữ hoa (A-Z)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg">
            <Switch
              checked={requireNumbers}
              onCheckedChange={(c) => setRequireNumbers(Boolean(c))}
            />
            <span>Bắt buộc chữ số (0-9)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg">
            <Switch
              checked={requireSpecialChars}
              onCheckedChange={(c) => setRequireSpecialChars(Boolean(c))}
            />
            <span>Bắt buộc ký tự đặc biệt (!@#...)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg">
            <Switch
              checked={requireCurrentPasswordOnChange}
              onCheckedChange={(c) => setRequireCurrentPasswordOnChange(Boolean(c))}
            />
            <span>Yêu cầu mật khẩu hiện tại khi đổi MK</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg">
            <Switch
              checked={preventPasswordReuse}
              onCheckedChange={(c) => setPreventPasswordReuse(Boolean(c))}
            />
            <span>Không cho dùng lại mật khẩu cũ</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg">
            <Switch
              checked={disallowUserInfoInPassword}
              onCheckedChange={(c) => setDisallowUserInfoInPassword(Boolean(c))}
            />
            <span>Cấm chứa Username / Email / SĐT</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg">
            <Switch
              checked={revokeSessionsOnPasswordChange}
              onCheckedChange={(c) => setRevokeSessionsOnPasswordChange(Boolean(c))}
            />
            <span>Thu hồi phiên cũ sau khi đổi / reset MK</span>
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">
            Danh sách mật khẩu bị cấm sử dụng (phân cách bằng dấu phẩy)
          </label>
          <Input
            value={disallowedPasswordsText}
            onChange={(e) => setDisallowedPasswordsText(e.target.value)}
            placeholder="password, 12345678, qwerty123, admin123..."
          />
        </div>
      </div>

      {/* Switches & Allowed MFA Methods */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-xs text-fg">
            <Switch
              checked={encryptFieldsAtRest}
              onCheckedChange={(checked) => setEncryptFieldsAtRest(Boolean(checked))}
            />
            <Lock className="size-3.5 text-muted" />
            <span>{t('gov.security.policy.encryptFieldsAtRest')}</span>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{t('gov.security.policy.allowedMfaMethods')}:</span>
            {MFA_METHODS.map((m) => {
              const active = allowedMfaMethods.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMfaMethod(m)}
                  className="cursor-pointer"
                >
                  <Badge tone={active ? 'ok' : undefined} size="xs">
                    {m}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? <ShieldAlert className="size-4" /> : <Save className="size-4" />}
          {saveMutation.isPending
            ? t('gov.security.policy.saving')
            : t('gov.security.policy.save')}
        </Button>
      </div>
    </div>
  );
}
