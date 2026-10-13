import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { ConfigGroups, ConfigSheet, CopyButton, QueryView, type ConfigGroup } from '@core/ui/blocks';
import type { WorkerConfig } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { workerKeys } from './worker-keys';

type Item = WorkerConfig['items'][number];
const MS_KEYS = new Set(['backoffDelayMs', 'processingP95Ms']);

/** Cấu hình đang nạp (chỉ đọc): provider, worker, job mặc định, ngưỡng cảnh báo, quyền thao tác queue. */
export function WorkerConfigSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const query = useLiveQuery(workerKeys.config(), () => workerApi.config(), { tier: 'static', enabled: open });
  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('wq.config.title')} subtitle={t('wq.config.note')}>
      <QueryView query={query}>{(d) => <Body d={d} />}</QueryView>
    </ConfigSheet>
  );
}

function Body({ d }: { d: WorkerConfig }) {
  const { t } = useLocale();
  const f = useFormat();
  const render = (item: Item): string => {
    if (typeof item.value === 'boolean') return item.value ? t('wq.config.value.on') : t('wq.config.value.off');
    if (item.value === null) return NO_VALUE;
    if (MS_KEYS.has(item.key)) return f.duration(Number(item.value));
    if (item.key === 'backoff') return t(`wq.config.value.backoff.${item.value}`);
    if (typeof item.value === 'number') return f.compact(item.value);
    return String(item.value);
  };
  const groups: ConfigGroup[] = [...new Set(d.items.map((i) => i.group))].map((g) => ({
    id: g,
    title: t(`wq.config.group.${g}`),
    items: d.items.filter((i) => i.group === g).map((i) => ({ key: i.key, label: t(`wq.config.key.${i.key}`), value: render(i), mono: typeof i.value !== 'boolean' })),
  }));
  const json = JSON.stringify(Object.fromEntries(d.items.map((i) => [i.key, i.value])), null, 2);
  return (
    <>
      <div className="mb-3 flex justify-end">
        <CopyButton value={json} size="xs" />
      </div>
      <ConfigGroups groups={groups} />
    </>
  );
}
