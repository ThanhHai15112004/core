import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { ConfigGroups, ConfigSheet, CopyButton, QueryView, type ConfigGroup } from '@core/ui/blocks';
import type { JobsConfig, JobsOverview } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { CONFIG_MS_KEYS, CONFIG_SEC_KEYS } from '../../constants/jobs';
import { jobsKeys } from './jobs-keys';

const MS_PER_SEC = 1000;

/** Cấu hình Jobs (chỉ đọc): provider, mặc định job, retention, ngưỡng phát hiện, quyền thao tác — đổi qua biến môi trường. */
export function JobsConfigSheet({ open, onOpenChange, overview }: { open: boolean; onOpenChange: (open: boolean) => void; overview: JobsOverview | undefined }) {
  const { t } = useLocale();
  const query = useLiveQuery(jobsKeys.config(), () => jobsApi.config(), { tier: 'static', enabled: open });
  const p = overview?.provider;
  return (
    <ConfigSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('jobs.config.title')}
      subtitle={p ? `${overview.environment.toUpperCase()} · ${p.product} (${p.backend})` : t('jobs.config.note')}
    >
      <QueryView query={query}>{(d) => <ConfigBody d={d} />}</QueryView>
    </ConfigSheet>
  );
}

function ConfigBody({ d }: { d: JobsConfig }) {
  const { t } = useLocale();
  const f = useFormat();
  const render = (key: string, value: string | number | boolean | null) => {
    if (value === null) return NO_VALUE;
    if (typeof value === 'boolean') return value ? t('jobs.config.yes') : t('jobs.config.no');
    if (CONFIG_MS_KEYS.has(key)) return f.duration(Number(value));
    if (CONFIG_SEC_KEYS.has(key)) return f.duration(Number(value) * MS_PER_SEC);
    if (typeof value === 'number') return f.number(value);
    return value;
  };
  const groups: ConfigGroup[] = [...new Set(d.items.map((i) => i.group))].map((g) => ({
    id: g,
    title: t(`jobs.config.group.${g}`),
    items: d.items.filter((i) => i.group === g).map((i) => ({ key: i.key, label: t(`jobs.config.key.${i.key}`), value: render(i.key, i.value), mono: typeof i.value !== 'boolean' })),
  }));
  const json = JSON.stringify(Object.fromEntries(d.items.map((i) => [i.key, i.value])), null, 2);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span>{t('jobs.config.note')}</span>
        <CopyButton value={json} label={t('jobs.config.copy')} size="xs" />
      </div>
      <ConfigGroups groups={groups} />
    </>
  );
}
