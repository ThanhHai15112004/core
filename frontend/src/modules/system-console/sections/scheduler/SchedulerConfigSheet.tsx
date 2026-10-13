import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { formatInterval } from '@core/lib/format';
import { Button } from '@core/ui/primitives';
import { ConfigGroups, ConfigSheet, DetailSection, KeyValueGrid, QueryView, type ConfigGroup } from '@core/ui/blocks';
import type { SchedulerConfig } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { CONFIG_INTERVAL_KEYS } from '../../constants/scheduler';
import { CronInspector } from '../../components/scheduler/CronInspector';
import { schedulerKeys } from './scheduler-keys';

type Value = SchedulerConfig['items'][number]['value'];

/** Cấu hình Scheduler (chỉ đọc): múi giờ, quyền thao tác, lưu lịch sử, ngưỡng cảnh báo; cấu hình từng task; Cron Inspector. */
export function SchedulerConfigSheet({
  open,
  onOpenChange,
  defaultTimezone,
  openTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTimezone: string;
  openTask: (taskId: string) => void;
}) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(schedulerKeys.config(), () => schedulerApi.config(), { tier: 'static', enabled: open });

  /** Nhãn đã dịch; key mới chưa có bản dịch → hiện nguyên key. */
  const label = (key: string) => {
    const path = `sch.config.key.${key}`;
    const v = t(path);
    return v === path ? key : v;
  };
  const render = (key: string, value: Value) => {
    if (value === null) return null;
    if (typeof value === 'boolean') return t(value ? 'sch.config.yes' : 'sch.config.no');
    if (CONFIG_INTERVAL_KEYS.has(key) && typeof value === 'number') return formatInterval(value);
    if (typeof value === 'number') return f.compact(value);
    return String(value);
  };
  const groupsOf = (d: SchedulerConfig): ConfigGroup[] => {
    const ids = [...new Set(d.items.map((i) => i.group))];
    return ids.map((g) => {
      const path = `sch.config.group.${g}`;
      const title = t(path);
      return {
        id: g,
        title: title === path ? g : title,
        items: d.items.filter((i) => i.group === g).map((i) => ({ key: i.key, label: label(i.key), value: render(i.key, i.value), mono: typeof i.value !== 'boolean' })),
      };
    });
  };

  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('sch.config.title')} subtitle={t('sch.config.note')}>
      <QueryView query={query}>
        {(d) => (
          <>
            <ConfigGroups groups={groupsOf(d)} />
            {d.tasks.map((task) => (
              <DetailSection
                key={task.id}
                title={task.name}
                actions={
                  <Button size="xs" variant="ghost" onClick={() => openTask(task.id)}>
                    {t('sch.config.openTask')}
                  </Button>
                }
              >
                <KeyValueGrid items={task.items.map((i) => ({ key: i.key, label: label(i.key), value: render(i.key, i.value), mono: true }))} />
              </DetailSection>
            ))}
          </>
        )}
      </QueryView>
      <DetailSection title={t('sch.cron.title')}>
        <CronInspector defaultTimezone={defaultTimezone} />
      </DetailSection>
    </ConfigSheet>
  );
}
