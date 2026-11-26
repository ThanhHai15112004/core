import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@core/ui/primitives';
import { KeyValueGrid, Panel, PanelGrid, StatusBanner } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { DR_STATUS_TONE, DR_TOPOLOGY_OPTIONS } from '../../constants/dr';
import { drApi } from '../../services/dr.api';
import type { DrOverviewDto, DrTopologyMode } from '../../types/dr.types';

export const DrOverviewTab: React.FC<{ overview: DrOverviewDto | undefined }> = ({ overview }) => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();

  const p = overview?.profile;
  const [isEnabled, setIsEnabled] = useState(p?.isEnabled ?? false);
  const [topologyMode, setTopologyMode] = useState<DrTopologyMode>(
    p?.topologyMode ?? 'WARM_STANDBY',
  );
  const [rpoTargetSeconds, setRpoTargetSeconds] = useState(String(p?.rpoTargetSeconds ?? 900));
  const [rtoTargetSeconds, setRtoTargetSeconds] = useState(String(p?.rtoTargetSeconds ?? 1800));
  const [drillIntervalDays, setDrillIntervalDays] = useState(String(p?.drillIntervalDays ?? 30));

  useEffect(() => {
    if (!p) return;
    setIsEnabled(p.isEnabled);
    setTopologyMode(p.topologyMode);
    setRpoTargetSeconds(String(p.rpoTargetSeconds));
    setRtoTargetSeconds(String(p.rtoTargetSeconds));
    setDrillIntervalDays(String(p.drillIntervalDays));
  }, [p]);

  const saveMut = useMutation({
    mutationFn: () =>
      drApi.updateProfile({
        isEnabled,
        topologyMode,
        rpoTargetSeconds: Math.max(1, Number(rpoTargetSeconds) || 900),
        rtoTargetSeconds: Math.max(1, Number(rtoTargetSeconds) || 1800),
        drillIntervalDays: Math.max(1, Number(drillIntervalDays) || 30),
      }),
    onSuccess: () => {
      addToast({ type: 'success', title: t('dr.toast.profileSaved') });
      void qc.invalidateQueries({ queryKey: ['console', 'dr'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  return (
    <div className="flex flex-col gap-4">
      {overview && !overview.effectiveEnabled && (
        <StatusBanner tone="info" title={t('dr.overview.disabledNotice')} />
      )}

      <Panel title={t('dr.overview.topologyTitle')}>
        <PanelGrid layout={2}>
          <KeyValueGrid
            items={[
              { label: t('dr.overview.primarySite'), value: p ? `${p.primarySite.name} (${p.primarySite.code})` : NO_VALUE },
              { label: t('dr.overview.region'), value: p?.primarySite.region ?? NO_VALUE },
              { label: t('dr.overview.endpoint'), value: p?.primarySite.endpoint ?? NO_VALUE },
              {
                label: t('dr.kpi.activeSite'),
                value: p ? (
                  <Badge tone={DR_STATUS_TONE[p.activeSite] ?? 'unknown'}>{p.activeSite}</Badge>
                ) : (
                  NO_VALUE
                ),
              },
            ]}
          />
          <KeyValueGrid
            items={[
              { label: t('dr.overview.drSite'), value: p ? `${p.drSite.name} (${p.drSite.code})` : NO_VALUE },
              { label: t('dr.overview.region'), value: p?.drSite.region ?? NO_VALUE },
              { label: t('dr.overview.endpoint'), value: p?.drSite.endpoint ?? NO_VALUE },
              {
                label: t('dr.overview.dbDrConfigured'),
                value: overview?.dbDrConfigured
                  ? t('dr.overview.configuredYes')
                  : t('dr.overview.configuredNo'),
              },
              {
                label: t('dr.overview.storageDrConfigured'),
                value: overview?.storageDrConfigured
                  ? t('dr.overview.configuredYes')
                  : t('dr.overview.configuredNo'),
              },
            ]}
          />
        </PanelGrid>
      </Panel>

      <Panel
        title={t('dr.overview.configTitle')}
        actions={
          <Button
            size="xs"
            variant="outline"
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            <Save />
            {t('dr.actions.saveProfile')}
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-5">
          <div>
            <div className="mb-1 text-xs font-medium text-fg-2">{t('dr.overview.enabledLabel')}</div>
            <Button
              size="sm"
              variant={isEnabled ? 'primary' : 'outline'}
              onClick={() => setIsEnabled((v) => !v)}
            >
              {isEnabled ? t('dr.overview.enabledOn') : t('dr.overview.enabledOff')}
            </Button>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-fg-2">
              {t('dr.overview.topologyModeLabel')}
            </div>
            <Select
              value={topologyMode}
              onValueChange={(v) => setTopologyMode(v as DrTopologyMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DR_TOPOLOGY_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-fg-2">
              {t('dr.overview.rpoTargetLabel')}
            </div>
            <Input
              type="number"
              min={1}
              value={rpoTargetSeconds}
              onChange={(e) => setRpoTargetSeconds(e.target.value)}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-fg-2">
              {t('dr.overview.rtoTargetLabel')}
            </div>
            <Input
              type="number"
              min={1}
              value={rtoTargetSeconds}
              onChange={(e) => setRtoTargetSeconds(e.target.value)}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-fg-2">
              {t('dr.overview.drillIntervalLabel')}
            </div>
            <Input
              type="number"
              min={1}
              value={drillIntervalDays}
              onChange={(e) => setDrillIntervalDays(e.target.value)}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
};
