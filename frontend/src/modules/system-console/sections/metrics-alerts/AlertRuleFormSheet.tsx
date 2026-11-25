import React, { useEffect, useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { DetailSheet } from '@core/ui/blocks';
import {
  ALERT_METRIC_KEYS,
  ALERT_OPERATORS,
  ALERT_SEVERITIES,
} from '../../constants/metrics-alerts';
import type {
  AlertOperatorDto,
  AlertRuleDto,
  AlertSeverityDto,
  CreateAlertRuleInput,
  UpdateAlertRuleInput,
} from '../../types/metrics-alerts.types';

interface Props {
  open: boolean;
  editing: AlertRuleDto | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateAlertRuleInput | UpdateAlertRuleInput, id?: number) => void;
}

export const AlertRuleFormSheet: React.FC<Props> = ({ open, editing, saving, onOpenChange, onSubmit }) => {
  const { t } = useLocale();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [metricKey, setMetricKey] = useState<string>(ALERT_METRIC_KEYS[1]);
  const [operator, setOperator] = useState<AlertOperatorDto>('gt');
  const [threshold, setThreshold] = useState('5');
  const [windowSeconds, setWindowSeconds] = useState('300');
  const [forSeconds, setForSeconds] = useState('60');
  const [cooldownSeconds, setCooldownSeconds] = useState('300');
  const [severity, setSeverity] = useState<AlertSeverityDto>('WARNING');
  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => {
    if (editing) {
      setCode(editing.code);
      setName(editing.name);
      setDescription(editing.description ?? '');
      setMetricKey(editing.metricKey);
      setOperator(editing.operator);
      setThreshold(String(editing.threshold));
      setWindowSeconds(String(editing.windowSeconds));
      setForSeconds(String(editing.forSeconds));
      setCooldownSeconds(String(editing.cooldownSeconds));
      setSeverity(editing.severity);
      setWebhookUrl(editing.webhookUrl ?? '');
    } else {
      setCode('');
      setName('');
      setDescription('');
      setMetricKey(ALERT_METRIC_KEYS[1]);
      setOperator('gt');
      setThreshold('5');
      setWindowSeconds('300');
      setForSeconds('60');
      setCooldownSeconds('300');
      setSeverity('WARNING');
      setWebhookUrl('');
    }
  }, [editing, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const common = {
      name: name.trim(),
      description: description.trim() || null,
      metricKey,
      operator,
      threshold: Number(threshold) || 0,
      windowSeconds: Math.max(60, Number(windowSeconds) || 300),
      forSeconds: Math.max(0, Number(forSeconds) || 0),
      cooldownSeconds: Math.max(10, Number(cooldownSeconds) || 300),
      severity,
      webhookUrl: webhookUrl.trim() || null,
    };
    if (editing) {
      onSubmit(common, editing.id);
    } else {
      onSubmit({ ...common, code: code.trim().toUpperCase(), isEnabled: true });
    }
  };

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(editing ? 'metricsAlerts.rules.editTitle' : 'metricsAlerts.rules.createTitle')}
      width="md"
    >
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {!editing && (
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
            <span>{t('metricsAlerts.rules.fieldCode')}</span>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('metricsAlerts.rules.codePlaceholder')}
              required
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
          <span>{t('metricsAlerts.rules.fieldName')}</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('metricsAlerts.rules.namePlaceholder')}
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
          <span>{t('metricsAlerts.rules.fieldDesc')}</span>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="flex flex-col gap-1 text-xs font-medium text-fg-2">
          <span>{t('metricsAlerts.rules.fieldMetric')}</span>
          <Select value={metricKey} onValueChange={setMetricKey}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALERT_METRIC_KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`metricsAlerts.metricLabel.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1 text-xs font-medium text-fg-2">
            <span>{t('metricsAlerts.rules.fieldOperator')}</span>
            <Select value={operator} onValueChange={(v) => setOperator(v as AlertOperatorDto)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_OPERATORS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {op}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
            <span>{t('metricsAlerts.rules.fieldThreshold')}</span>
            <Input type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
          </label>
          <div className="flex flex-col gap-1 text-xs font-medium text-fg-2">
            <span>{t('metricsAlerts.rules.fieldSeverity')}</span>
            <Select value={severity} onValueChange={(v) => setSeverity(v as AlertSeverityDto)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_SEVERITIES.map((sev) => (
                  <SelectItem key={sev} value={sev}>
                    {t(`metricsAlerts.severity.${sev}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
            <span>{t('metricsAlerts.rules.fieldWindowSec')}</span>
            <Input type="number" value={windowSeconds} onChange={(e) => setWindowSeconds(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
            <span>{t('metricsAlerts.rules.fieldForSec')}</span>
            <Input type="number" value={forSeconds} onChange={(e) => setForSeconds(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
            <span>{t('metricsAlerts.rules.fieldCooldownSec')}</span>
            <Input type="number" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} required />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
          <span>{t('metricsAlerts.rules.fieldWebhook')}</span>
          <Input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={t('metricsAlerts.rules.webhookPlaceholder')}
          />
        </label>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('metricsAlerts.rules.cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {t('metricsAlerts.rules.submitSave')}
          </Button>
        </div>
      </form>
    </DetailSheet>
  );
};
