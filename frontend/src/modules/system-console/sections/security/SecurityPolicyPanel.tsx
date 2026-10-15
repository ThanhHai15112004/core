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

  useEffect(() => {
    setPasswordHashAlgorithm(initial.passwordHashAlgorithm);
    setDbEncryptionAlgorithm(initial.dbEncryptionAlgorithm);
    setEncryptFieldsAtRest(initial.encryptFieldsAtRest);
    setMfaPolicy(initial.mfaPolicy);
    setAllowedMfaMethods(initial.allowedMfaMethods);
    setMaxFailedLoginAttempts(initial.maxFailedLoginAttempts);
    setLockoutDurationMinutes(initial.lockoutDurationMinutes);
    setPasswordMinLength(initial.passwordMinLength);
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
