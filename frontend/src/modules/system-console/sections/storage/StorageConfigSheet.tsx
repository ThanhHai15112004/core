import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { ConfigItems, ConfigSheet, QueryView, type ConfigItem } from '@core/ui/blocks';
import { storageApi } from '../../services/storage.api';
import { storageKeys } from './storage-keys';

/** Cấu hình storage đang nạp (chỉ đọc) — credentials chỉ hiện "đã cấu hình". */
export function StorageConfigSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(storageKeys.config(), () => storageApi.config(), { tier: 'static', enabled: open });

  const format = (i: ConfigItem) => {
    if (i.value === null || typeof i.value === 'boolean') return undefined;
    if (i.key === 'signedUrlMaxSec') return f.duration(Number(i.value) * 1000);
    if (i.key === 'timeoutMs') return f.duration(Number(i.value));
    return undefined;
  };

  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('storage.config.title')} subtitle={t('storage.config.note')}>
      <QueryView query={query}>
        {(d) => <ConfigItems items={d.items} groupLabel={(g) => t(`storage.config.group.${g}`)} itemLabel={(k) => t(`storage.config.key.${k}`)} format={format} />}
      </QueryView>
    </ConfigSheet>
  );
}
