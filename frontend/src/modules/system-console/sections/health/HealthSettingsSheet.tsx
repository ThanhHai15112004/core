import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { errorMessage } from '@core/data';
import { Button, Input, Switch } from '@core/ui/primitives';
import { DetailSheet, StatusBanner } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { healthConsoleApi } from '../../services/health.api';
import type { HealthSystemSettingDto } from '../../types/health.types';

export const HealthSettingsSheet: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const settingsQuery = useQuery({
    queryKey: ['console', 'health', 'settings'],
    queryFn: () => healthConsoleApi.listSettings(),
    enabled: open,
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    const next: Record<string, string> = {};
    for (const item of settingsQuery.data) {
      next[item.key] = String(item.value ?? '');
    }
    setDrafts(next);
  }, [settingsQuery.data]);

  const updateMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      healthConsoleApi.updateSetting(key, value),
    onSuccess: (updated) => {
      addToast({
        type: 'success',
        title: t('health.settingsSheet.saved', { key: updated.key }),
      });
      void qc.invalidateQueries({ queryKey: ['console', 'health'] });
    },
    onError: (err) => {
      addToast({
        type: 'error',
        title: t('console.toast.actionFailed'),
        message: errorMessage(err),
      });
    },
  });

  const handleSaveNumber = (item: HealthSystemSettingDto) => {
    const raw = drafts[item.key] ?? String(item.value ?? '');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    updateMut.mutate({ key: item.key, value: parsed });
  };

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('health.settingsSheet.title')}
      subtitle={t('health.settingsSheet.subtitle')}
      width="lg"
    >
      {settingsQuery.isError && (
        <StatusBanner
          tone="warn"
          title={t('health.settingsSheet.noPermission')}
          description={errorMessage(settingsQuery.error)}
        />
      )}

      <div className="flex flex-col gap-3">
        {(settingsQuery.data ?? []).map((item) => {
          const isBool = item.valueTypeName === 'BOOLEAN';
          const boolChecked = item.value === true || String(item.value).toLowerCase() === 'true';

          return (
            <div
              key={item.key}
              className="flex flex-col gap-2 rounded-lg border border-border bg-panel-2 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg">{item.name}</div>
                  <div className="font-mono text-xs text-muted">{item.key}</div>
                  {item.description && (
                    <p className="mt-1 text-xs text-faint">{item.description}</p>
                  )}
                </div>

                {isBool ? (
                  <Switch
                    checked={boolChecked}
                    disabled={updateMut.isPending}
                    onCheckedChange={(checked) =>
                      updateMut.mutate({ key: item.key, value: checked })
                    }
                  />
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      type="number"
                      className="h-8 w-28 font-mono text-xs"
                      value={drafts[item.key] ?? String(item.value ?? '')}
                      min={item.validationRules?.min}
                      max={item.validationRules?.max}
                      step={item.validationRules?.integerOnly ? 1 : 0.05}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))
                      }
                    />
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={updateMut.isPending}
                      onClick={() => handleSaveNumber(item)}
                    >
                      {t('health.settingsSheet.save')}
                    </Button>
                  </div>
                )}
              </div>
              <div className="text-[11px] text-faint">
                {t('health.settingsSheet.defaultVal', { value: String(item.defaultValue) })}
              </div>
            </div>
          );
        })}
      </div>
    </DetailSheet>
  );
};
