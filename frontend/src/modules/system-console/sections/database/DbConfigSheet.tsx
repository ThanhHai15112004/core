import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { ConfigGroups, ConfigSheet, CopyButton, QueryView, StatusBanner } from '@core/ui/blocks';
import type { DbConfig } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { dbKeys } from './database-keys';

type Item = DbConfig['items'][number];

/** Cấu hình kết nối đã nạp lúc khởi động (chỉ đọc) — mật khẩu chỉ hiện "đã cấu hình". */
export function DbConfigSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(dbKeys.config(), () => databaseApi.config(), { tier: 'static', enabled: open });

  const render = (item: Item) => {
    if (item.sensitive) return <Badge tone={item.value ? 'ok' : 'unknown'}>{item.value ? t('db.config.configured') : t('db.config.notConfigured')}</Badge>;
    if (typeof item.value === 'boolean') return item.value ? t('db.config.yes') : t('db.config.no');
    if (item.key.endsWith('Ms') && typeof item.value === 'number') return f.duration(item.value);
    return item.value === null ? NO_VALUE : String(item.value);
  };
  const safeJson = (items: Item[]) => JSON.stringify(Object.fromEntries(items.filter((i) => !i.sensitive).map((i) => [i.key, i.value])), null, 2);

  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('db.config.title')} subtitle={t('db.config.note')}>
      <QueryView query={query}>
        {(d) => (
          <>
            {d.items.some((i) => i.key === 'synchronize' && i.value === true) && <StatusBanner tone="crit" title={t('db.config.syncWarningTitle')} description={t('db.config.syncWarning')} />}
            <div className="mb-3 flex justify-end">
              <CopyButton value={safeJson(d.items)} label={t('db.config.copy')} size="xs" />
            </div>
            <ConfigGroups
              groups={[
                {
                  id: 'connection',
                  title: t('db.config.group'),
                  items: d.items.map((i) => ({ key: i.key, label: t(`db.config.key.${i.key}`), value: render(i), mono: !i.sensitive && typeof i.value !== 'boolean' })),
                },
              ]}
            />
          </>
        )}
      </QueryView>
    </ConfigSheet>
  );
}
